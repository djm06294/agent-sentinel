// Policy Gate (T-06): tools/call을 DBHub에 넘기기 전에 관리자 백엔드의 정책 확인 API를 호출한다.
//
// - 허용(ALLOW)이면 원래 메시지를 그대로 DBHub에 전달한다.
// - 차단(DENY)이면 DBHub에 넘기지 않고, Claude Code에 도구 오류(isError) 응답을 직접 돌려준다.
// - 정책 서버가 응답하지 않거나 이상한 응답을 주면 차단한다 (fail-closed).
// - 정책 확인은 비동기라서, 확인을 기다리는 동안 뒤 메시지가 앞질러 가지 않도록 한 줄씩 순서대로 처리한다.

type Message = Record<string, any>;
export type JsonRpcId = string | number;

export interface PolicyDecision {
  decision: 'ALLOW' | 'DENY';
  policy_id: string | null;
  reason: string | null;
}

export interface PolicyContext {
  user_id: string;
  agent_id: string;
  session_id: string;
  database: string;
  server_id?: string;
}

export interface PolicyClientOptions {
  url: string;
  timeoutMs?: number;
}

const REASON = /^[A-Z][A-Z0-9_]{0,63}$/;

function deny(reason: string): PolicyDecision {
  return { decision: 'DENY', policy_id: null, reason };
}

/** POST /api/policy/check 호출. 어떤 실패도 예외 대신 DENY로 돌려준다. */
export class PolicyClient {
  private readonly timeoutMs: number;

  constructor(private readonly options: PolicyClientOptions) {
    const url = new URL(options.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('GATEWAY_POLICY_API_URL must be an HTTP(S) URL without credentials');
    }
    this.timeoutMs = options.timeoutMs ?? 2000;
  }

  async check(ctx: PolicyContext, toolName: string): Promise<PolicyDecision> {
    let response: Response;
    try {
      response = await fetch(this.options.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...ctx, tool_name: toolName }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return deny('POLICY_UNAVAILABLE');
    }
    if (!response.ok) return deny('POLICY_API_ERROR');
    const body = (await response.json().catch(() => null)) as Partial<PolicyDecision> | null;
    if (body?.decision !== 'ALLOW' && body?.decision !== 'DENY') return deny('POLICY_INVALID_RESPONSE');
    return {
      decision: body.decision,
      policy_id: typeof body.policy_id === 'string' ? body.policy_id : null,
      // 행동 로그 error_code로도 쓰므로 정해진 형식만 받는다
      reason: typeof body.reason === 'string' && REASON.test(body.reason) ? body.reason : body.decision === 'DENY' ? 'POLICY_DENY' : null,
    };
  }
}

/** 차단된 tools/call에 대한 응답. JSON-RPC 오류 대신 도구 오류로 돌려줘서 에이전트가 사유를 읽을 수 있게 한다. */
export function deniedResponse(id: JsonRpcId, decision: PolicyDecision): string {
  const text =
    `[Agent Sentinel] 접근 정책에 의해 이 요청이 차단되었습니다 (사유: ${decision.reason ?? 'POLICY_DENY'}). ` +
    '다른 방법으로 우회하지 말고, 필요하면 사용자에게 관리자에게 권한을 요청하도록 안내하세요.';
  return JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } });
}

export interface GateHooks {
  /** DBHub로 그대로 전달 */
  forward(line: string): void;
  /** 차단: DBHub로 보내지 않음 */
  deny(id: JsonRpcId, toolName: string, decision: PolicyDecision): void;
  /** 허용·차단 결정 기록 (감사용) */
  decided?(id: JsonRpcId, toolName: string, decision: PolicyDecision): void;
}

export class PolicyGate {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly client: PolicyClient,
    private readonly ctx: PolicyContext,
    private readonly hooks: GateHooks,
  ) {}

  /** 클라이언트 → DBHub 메시지 한 줄. 받은 순서대로 처리한다. */
  submit(line: string): void {
    this.queue = this.queue.then(() => this.handle(line)).catch(() => {
      // handle은 예외를 던지지 않지만, 혹시 던져도 다음 메시지 처리가 멈추지 않게 한다
    });
  }

  /** 지금까지 받은 메시지 처리가 끝날 때까지 기다린다 (종료 전 호출). */
  drain(): Promise<void> {
    return this.queue;
  }

  private async handle(line: string): Promise<void> {
    let msg: Message | undefined;
    try {
      msg = JSON.parse(line);
    } catch {
      /* JSON이 아니면 DBHub가 판단하도록 그대로 넘긴다 */
    }
    const id = msg?.id;
    const isToolCall =
      msg?.jsonrpc === '2.0' && msg.method === 'tools/call' && (typeof id === 'number' || typeof id === 'string');
    if (!isToolCall) {
      this.hooks.forward(line);
      return;
    }
    const toolName = typeof msg!.params?.name === 'string' ? msg!.params.name.slice(0, 128) : 'unknown_tool';
    const decision = await this.client.check(this.ctx, toolName);
    this.hooks.decided?.(id, toolName, decision);
    if (decision.decision === 'ALLOW') this.hooks.forward(line);
    else this.hooks.deny(id, toolName, decision);
  }
}

/** DBHub 인자(--dsn) 또는 DSN 환경변수에서 데이터베이스 이름을 꺼낸다. 비밀번호는 다루지 않는다. */
export function databaseFromDbhubArgs(args: string[], env: NodeJS.ProcessEnv): string | undefined {
  let dsn = env.DSN;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dsn') dsn = args[i + 1];
    else if (args[i].startsWith('--dsn=')) dsn = args[i].slice('--dsn='.length);
  }
  if (!dsn) return undefined;
  try {
    const name = decodeURIComponent(new URL(dsn).pathname.replace(/^\/+/, ''));
    return name || undefined;
  } catch {
    return undefined;
  }
}
