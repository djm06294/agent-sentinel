import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Message = Record<string, any>;
export interface BehaviorEvent {
  timestamp: string; user_id: string; agent_id: string; session_id: string;
  request_id: string; sequence_no: number; tool_name: string; action: string;
  resource: string; status: 'success' | 'failure'; duration_ms: number;
  error_code: string | null;
  metadata: { transport: 'stdio'; resource_type: 'service' };
}
export interface DeliveryOptions {
  url: string; dir: string; timeoutMs?: number; retryMs?: number;
  report?: (message: string) => void;
}

// Disk-backed at-least-once delivery. Retries reuse the same session/sequence/UUID.
// Files contain only normalized events, never SQL, tool arguments or result rows.
export class EventOutbox {
  private timer: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopping = false;
  private deadline = Infinity;
  private timeout: number;
  private report: (message: string) => void;
  constructor(private options: DeliveryOptions) {
    const url = new URL(options.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('GATEWAY_LOG_API_URL must be an HTTP(S) endpoint without credentials, query or fragment');
    }
    mkdirSync(options.dir, { recursive: true });
    this.timeout = options.timeoutMs ?? 2000;
    this.report = options.report ?? (() => {});
    this.timer = setInterval(() => void this.flush(), options.retryMs ?? 5000).unref();
    void this.flush();
  }
  enqueue(event: BehaviorEvent): void {
    const path = join(this.options.dir, `${event.request_id}.pending.json`);
    try {
      writeFileSync(path + '.tmp', JSON.stringify(event), { mode: 0o600 });
      renameSync(path + '.tmp', path);
      void this.flush();
    } catch {
      this.report('outbox_write_failed: event could not be persisted');
    }
  }
  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.deliver().catch(() => {
      this.report('outbox_read_failed: pending events retained');
    }).finally(() => { this.running = undefined; });
    return this.running;
  }
  private async deliver(): Promise<void> {
    // Bound each pass so an unavailable API cannot monopolize a gateway process.
    const files = readdirSync(this.options.dir).filter(f => f.endsWith('.pending.json')).slice(0, 100);
    for (const name of files) {
      if (Date.now() >= this.deadline) break;
      const path = join(this.options.dir, name);
      let payload: string;
      try { payload = readFileSync(path, 'utf8'); } catch { continue; }
      try {
        const response = await fetch(this.options.url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
          signal: AbortSignal.timeout(Math.max(1, Math.min(this.timeout, this.deadline - Date.now()))),
        });
        const body = await response.json().catch(() => null) as any;
        if ((response.status === 201 && typeof body?.data?.log_id === 'string') ||
            (response.status === 409 && body?.error?.code === 'duplicate_log')) {
          // 409 means the unique session sequence already exists; it is not proof of identical contents.
          const event = JSON.parse(payload) as BehaviorEvent;
          appendFileSync(join(this.options.dir, 'receipts.jsonl'), JSON.stringify({
            request_id: event.request_id, session_id: event.session_id, sequence_no: event.sequence_no,
            log_id: body?.data?.log_id ?? null, http_status: response.status,
          }) + '\n');
          try { unlinkSync(path); } catch { /* another gateway may have delivered it */ }
          this.report(`log_delivery=${response.status} sequence=${event.sequence_no}`);
        } else if ([400, 401, 403, 404, 405, 413, 422].includes(response.status)) {
          try { renameSync(path, path.replace('.pending.json', '.rejected.json')); } catch {}
          this.report(`log_rejected=${response.status}: retained for inspection`);
        } else {
          this.report(`log_delivery_retry=${response.status}: pending event retained`);
          break;
        }
      } catch {
        this.report('log_delivery_unavailable: pending event retained');
        break;
      }
    }
  }
  async close(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    clearInterval(this.timer);
    this.deadline = Date.now() + 5000;
    await this.flush();
    // An enqueue can occur while a previous pass is already running.
    if (Date.now() < this.deadline) await this.flush();
  }
}

type Pending = { event: BehaviorEvent; started: number };
export class BehaviorLogger {
  private pending = new Map<string, Pending>();
  private sequence = 0;
  private timer: NodeJS.Timeout;
  constructor(private session: string, private user: string, private agent: string,
              private outbox: EventOutbox, private report: (message: string) => void,
              private responseTimeoutMs = 120000) {
    for (const value of [session, user, agent]) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(value)) throw new Error('Invalid gateway identity');
    }
    this.timer = setInterval(() => {
      for (const [key, call] of this.pending) {
        if (performance.now() - call.started >= this.responseTimeoutMs) this.finish(key, 'MCP_RESPONSE_TIMEOUT');
      }
    }, 1000).unref();
  }
  observe(direction: 'client_to_server' | 'server_to_client', line: string): void {
    let msg: Message;
    try { msg = JSON.parse(line); } catch { return; }
    if (!msg || Array.isArray(msg) || msg.jsonrpc !== '2.0' ||
        !['number', 'string'].includes(typeof msg.id)) return;
    const key = JSON.stringify(msg.id); // Numeric 1 and string "1" are distinct MCP ids.
    if (direction === 'client_to_server') {
      if (msg.method !== 'tools/call') return;
      if (this.pending.has(key)) { this.report('duplicate_inflight_id: not recorded twice'); return; }
      if (this.pending.size >= 1000) { this.report('tracking_limit: tool call not recorded'); return; }
      // Only known public tool names are copied. Never copy arbitrary names/arguments/error messages.
      const tool = ['execute_sql', 'search_objects'].includes(msg.params?.name) ? msg.params.name : 'unknown_tool';
      this.pending.set(key, { started: performance.now(), event: {
        timestamp: new Date().toISOString(), user_id: this.user, agent_id: this.agent,
        session_id: this.session, request_id: randomUUID(), sequence_no: this.sequence++,
        tool_name: tool, action: 'tool_call', resource: 'mcp:dbhub', status: 'success',
        duration_ms: 0, error_code: null, metadata: { transport: 'stdio', resource_type: 'service' },
      }});
    } else if (this.pending.has(key) && !msg.method) {
      let error: string | null = null;
      if (msg.error) error = 'MCP_RPC_ERROR';
      else if (!msg.result || typeof msg.result !== 'object') error = 'MCP_INVALID_RESULT';
      else if (msg.result.isError === true) error = 'MCP_TOOL_ERROR';
      else {
        const parts = [msg.result.structuredContent];
        for (const item of Array.isArray(msg.result.content) ? msg.result.content : []) {
          if (item?.type === 'text') {
            try { parts.push(JSON.parse(item.text)); } catch { /* no raw text retained */ }
          }
        }
        if (parts.some(p => p && p.success === false)) error = 'TOOL_EXECUTION_FAILED';
      }
      this.finish(key, error);
    }
  }
  private finish(key: string, error: string | null): void {
    const call = this.pending.get(key);
    if (!call) return;
    this.pending.delete(key);
    call.event.duration_ms = Math.min(2147483647, Math.max(0, Math.round(performance.now() - call.started)));
    call.event.status = error ? 'failure' : 'success';
    call.event.error_code = error;
    this.outbox.enqueue(call.event);
  }
  async close(): Promise<void> {
    clearInterval(this.timer);
    for (const key of this.pending.keys()) this.finish(key, 'MCP_SESSION_ENDED');
    await this.outbox.close();
  }
}
