import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BehaviorLogger, EventOutbox } from '../dist/behavior-logger.js';

const rpc = (id, name = 'execute_sql') => JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:{sql:'SELECT secret FROM private_data'}}});
const reply = (id, result) => JSON.stringify({jsonrpc:'2.0',id,result});
test('correlates reordered numeric/string ids; never forwards arguments or result text', async () => {
  const events = [];
  const logger = new BehaviorLogger('test-session','test-user','test-agent', {enqueue:e=>events.push(e),close:async()=>{}}, ()=>{});
  logger.observe('client_to_server', rpc(1));
  logger.observe('client_to_server', rpc('1'));
  logger.observe('server_to_client', reply('1',{content:[{type:'text',text:'{"success":false,"error":"secret"}'}]}));
  logger.observe('server_to_client', reply(1,{content:[{type:'text',text:'{"success":true,"data":{"password":"secret"}}'}]}));
  logger.observe('server_to_client', reply(1,{}));
  logger.observe('client_to_server', JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/list'}));
  await logger.close();
  assert.equal(events.length,2);
  assert.deepEqual(events.map(e=>e.sequence_no),[1,0]);
  assert.deepEqual(events.map(e=>e.status),['failure','success']);
  assert.equal(events[0].error_code,'TOOL_EXECUTION_FAILED');
  assert.notEqual(events[0].request_id,events[1].request_id);
  assert(!JSON.stringify(events).includes('secret'));
  assert(!JSON.stringify(events).includes('SELECT'));
});
test('RPC/tool errors and interrupted calls cannot be recorded as success', async () => {
  const events=[];
  const logger=new BehaviorLogger('s','u','a',{enqueue:e=>events.push(e),close:async()=>{}},()=>{});
  logger.observe('client_to_server',rpc(1));
  logger.observe('server_to_client',JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-1,message:'secret'}}));
  logger.observe('client_to_server',rpc(2));
  logger.observe('server_to_client',reply(2,{isError:true}));
  logger.observe('client_to_server',rpc(3,'secret-tool?password=abc'));
  await logger.close();
  assert.deepEqual(events.map(e=>e.error_code),['MCP_RPC_ERROR','MCP_TOOL_ERROR','MCP_SESSION_ENDED']);
  assert.equal(events[2].tool_name,'unknown_tool');
  assert(events.every(e=>e.status==='failure'));
});
test('disk outbox survives outage, retries unchanged, handles duplicate and rejected responses', async () => {
  const dir=mkdtempSync(join(tmpdir(),'gateway-outbox-'));
  let status=503;const received=[];
  const server=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    received.push(JSON.parse(text));
    res.writeHead(status,{'Content-Type':'application/json'});
    res.end(JSON.stringify(status===201?{data:{log_id:randomUUID()}}:status===409?{error:{code:'duplicate_log'}}:{error:{code:'test'}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const options={url:`http://127.0.0.1:${server.address().port}/api/v1/logs`,dir,retryMs:60000,timeoutMs:200};
  const makeEvent=()=>({request_id:randomUUID(),session_id:'s',sequence_no:0});
  let outbox;
  try {
    outbox=new EventOutbox(options);await outbox.flush();
    const event=makeEvent();outbox.enqueue(event);await outbox.flush();await outbox.close();
    assert(readdirSync(dir).some(f=>f.endsWith('.pending.json')));
    status=201;outbox=new EventOutbox(options);await outbox.flush();await outbox.close();
    assert(!readdirSync(dir).some(f=>f.endsWith('.pending.json')));
    assert(received.every(e=>e.request_id===event.request_id && e.sequence_no===0));
    assert.equal(JSON.parse(readFileSync(join(dir,'receipts.jsonl'),'utf8').trim()).http_status,201);
    status=409;writeFileSync(join(dir,'duplicate.pending.json'),JSON.stringify(makeEvent()));
    outbox=new EventOutbox(options);await outbox.flush();await outbox.close();
    assert(!readdirSync(dir).some(f=>f.endsWith('.pending.json')));
    status=422;writeFileSync(join(dir,'bad.pending.json'),JSON.stringify(makeEvent()));
    outbox=new EventOutbox(options);await outbox.flush();await outbox.close();
    assert(readdirSync(dir).includes('bad.rejected.json'));
  } finally {
    await outbox?.close();
    await new Promise(resolve=>server.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
});
