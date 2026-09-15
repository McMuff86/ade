import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, write, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TokenCounts, UsageAmounts, UsageProduct, UsageProvider } from '../../shared/usage';
import { TOKEN_FIELDS } from '../../shared/usage';
import { assertNoLinks } from '../repositories/pathDiscipline';
import { tokenDelta, type UsageSample } from './normalize';

export interface UsageSession {
  id: string;
  provider: UsageProvider;
  product: UsageProduct;
  backend: 'native' | 'unsupported';
  terminalSessionId?: string;
  repositoryId?: string;
  agentId?: string;
  createdAt: number;
  endedAt?: number;
  coverage: 'waiting' | 'recording' | 'incomplete' | 'unsupported';
}
export interface UsageFact extends UsageAmounts {
  id: string; sessionId: string; at: number; model: string | null;
  /** Digest of the numeric source sample, for conflicting replay detection. */
  fingerprint: string;
  source: 'codex-rollout' | 'claude-otel' | 'grok-session' | 'elevenlabs-request' | 'elevenlabs-response';
  /** A request attempt is durable before network dispatch. Pending and
   * unconfirmed outcomes do not imply successful processing or zero charges. */
  requestState?: 'pending' | 'complete' | 'unconfirmed' | 'not-sent';
}
interface Counter { key: string; tokens: TokenCounts }
type Event = { type: 'session'; session: UsageSession }
  | { type: 'fact'; fact: UsageFact; counter?: Counter }
  | { type: 'coverage'; sessionId: string; coverage: UsageSession['coverage']; endedAt?: number }
  | { type: 'speech-outcome'; factId: string; state: 'complete' | 'unconfirmed' | 'not-sent' }
  | { type: 'budget'; monthlyUsd: number | null };
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_LINE = 16 * 1024;
const MAX_FACTS = 50_000;
const MAX_SESSIONS = 4096;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const hashId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const optionalNumber = (value: unknown): value is number | null => value === null || nonnegative(value);
const integer = (value: unknown): value is number => nonnegative(value) && Number.isSafeInteger(value);
const time = (value: unknown): value is number => integer(value) && value > 0 && value < 9e15;
const own = (value: object, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const coverage = (value: unknown): value is UsageSession['coverage'] => ['waiting', 'recording', 'incomplete', 'unsupported'].includes(String(value));
export const usageDigest = (value: string): string => createHash('sha256').update(value).digest('hex');
export const validUsageBudget = (value: unknown): value is number | null => value === null || nonnegative(value) && value > 0 && value <= 1_000_000;
const validTokens = (value: TokenCounts): boolean => {
  if (!value || !own(value, [...TOKEN_FIELDS]) || !TOKEN_FIELDS.every(key => value[key] === null || integer(value[key]))) return false;
  if (value.reasoning !== null && value.output !== null && value.reasoning > value.output) return false;
  if (value.input === null) return true;
  if ([value.inputUncached, value.cacheRead, value.cacheWrite].some(part => part !== null && part > value.input!)) return false;
  if (value.cacheRead !== null && value.cacheWrite !== null && value.cacheRead + value.cacheWrite > value.input) return false;
  return value.inputUncached === null || value.cacheRead === null || value.cacheWrite === null
    || value.inputUncached + value.cacheRead + value.cacheWrite === value.input;
};
function validSession(value: UsageSession): boolean {
  return !!value && own(value, ['id', 'provider', 'product', 'backend', 'terminalSessionId', 'repositoryId', 'agentId', 'createdAt', 'endedAt', 'coverage'])
    && id(value.id) && ['codex', 'claude', 'grok', 'elevenlabs'].includes(value.provider)
    && ['coding', 'dictation', 'speech-test'].includes(value.product) && ['native', 'unsupported'].includes(value.backend)
    && ['terminalSessionId', 'repositoryId', 'agentId'].every(key => value[key as keyof UsageSession] === undefined || id(value[key as keyof UsageSession]))
    && time(value.createdAt) && (value.endedAt === undefined || time(value.endedAt) && value.endedAt >= value.createdAt) && coverage(value.coverage);
}
function validFact(value: UsageFact): boolean {
  return !!value && own(value, ['id', 'fingerprint', 'sessionId', 'at', 'model', 'source', 'tokens', 'audioSeconds', 'characters', 'credits', 'costUsd', 'costKind', 'costComplete', 'requestState'])
    && hashId(value.id) && hashId(value.fingerprint) && id(value.sessionId) && time(value.at)
    && (value.model === null || typeof value.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value.model))
    && ['codex-rollout', 'claude-otel', 'grok-session', 'elevenlabs-request', 'elevenlabs-response'].includes(value.source)
    && (value.requestState === undefined || value.source.startsWith('elevenlabs-') && value.requestState === 'pending')
    && validTokens(value.tokens) && [value.audioSeconds, value.characters, value.credits, value.costUsd].every(optionalNumber)
    && (value.characters === null || integer(value.characters)) && (value.costUsd === null || value.costUsd <= 1e9)
    && ['unknown', 'provider-estimate', 'provider-reported', 'configured-estimate'].includes(value.costKind)
    && (value.costComplete === null || typeof value.costComplete === 'boolean')
    && (value.costUsd === null ? value.costKind === 'unknown' && value.costComplete === null : value.costKind !== 'unknown');
}

/** Numeric-only append journal. A torn write, replaced file or exceeded bound
 * stops collection without overwriting the original or presenting a fresh zero.
 * Writes and fsync are asynchronous so ordinary terminal input stays responsive. */
export class UsageJournal {
  private fd: number | undefined;
  private identity?: { dev: number; ino: number };
  private bytes = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private failure: string | null = null;
  private closing = false;
  private stamp?: { mtimeMs: number; ctimeMs: number };
  private readonly sessions = new Map<string, UsageSession>();
  private readonly facts = new Map<string, UsageFact>();
  private readonly counters = new Map<string, TokenCounts>();
  private monthlyUsd: number | null = null;
  constructor(private readonly file: string) {
    try {
      assertNoLinks(file); mkdirSync(dirname(file), { recursive: true, mode: 0o700 }); assertNoLinks(file);
      const marker = `${file}.initialized`; assertNoLinks(marker);
      if (existsSync(marker) && !existsSync(file)) throw new Error('initialized journal missing');
      this.fd = openSync(file, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
      const stat = fstatSync(this.fd); if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('bounds');
      this.identity = { dev: stat.dev, ino: stat.ino }; this.stamp = { mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs }; this.checkFile(); this.bytes = stat.size;
      const data = readFileSync(this.fd, 'utf8');
      if (data && !data.endsWith('\n')) throw new Error('torn journal');
      for (const line of data.split('\n').filter(Boolean)) {
        if (Buffer.byteLength(line) > MAX_LINE) throw new Error('line bounds');
        const event = JSON.parse(line) as Event; this.validate(event); this.apply(event);
      }
      this.checkFile(); this.checkStamp();
      if (!existsSync(marker)) {
        const markerFd = openSync(marker, 'wx', 0o600);
        try { writeFileSync(markerFd, 'ADE usage journal v1\n'); fsyncSync(markerFd); } finally { closeSync(markerFd); }
      }
    } catch { this.fail(); if (this.fd !== undefined) closeSync(this.fd); this.fd = undefined; }
  }

  view(): { sessions: UsageSession[]; facts: UsageFact[]; monthlyBudgetUsd: number | null; error: string | null } {
    return structuredClone({ sessions: [...this.sessions.values()], facts: [...this.facts.values()], monthlyBudgetUsd: this.monthlyUsd, error: this.failure });
  }
  async flush(): Promise<void> { await this.queue; }
  async close(): Promise<void> { this.closing = true; await this.queue; if (this.fd !== undefined) closeSync(this.fd); this.fd = undefined; }
  async openSession(input: Omit<UsageSession, 'id'>): Promise<string> {
    const session = { ...input, id: randomUUID() }; await this.enqueue(() => this.append({ type: 'session', session })); return session.id;
  }
  setCoverage(sessionId: string, state: UsageSession['coverage'], endedAt?: number): Promise<void> {
    return this.enqueue(() => this.append({ type: 'coverage', sessionId, coverage: state, ...(endedAt === undefined ? {} : { endedAt }) }));
  }
  setBudget(monthlyUsd: number | null): Promise<void> { return this.enqueue(() => this.append({ type: 'budget', monthlyUsd })); }

  /** sourceKey identifies a real native conversation; sample.key identifies
   * the native event, not the receiving HTTP request or polling iteration. */
  record(sessionId: string, source: UsageFact['source'], sourceKey: string, sample: UsageSample, at: number): Promise<'recorded' | 'duplicate' | 'gap'> {
    sample = structuredClone(sample);
    return this.enqueue(async () => {
      if (!hashId(sourceKey) || !id(sample.key)) throw new Error('Ungültige Verbrauchsquelle.');
      const key = usageDigest(`${source}/${sourceKey}/${sample.key}`);
      const fingerprint = usageDigest(JSON.stringify([source, sourceKey, sample.kind, sample.model, sample.tokens, sample.costUsd, sample.costKind, sample.costComplete]));
      const previousFact = this.facts.get(key);
      if (previousFact) {
        if (previousFact.fingerprint === fingerprint) return 'duplicate';
        await this.append({ type: 'coverage', sessionId, coverage: 'incomplete' }); return 'gap';
      }
      let tokens = sample.tokens; let counter: Counter | undefined;
      if (sample.kind === 'cumulative') {
        const previous = this.counters.get(sourceKey);
        if (previous) {
          if (JSON.stringify(previous) === JSON.stringify(tokens)) return 'duplicate';
          const delta = tokenDelta(tokens, previous);
          if (!delta) { await this.append({ type: 'coverage', sessionId, coverage: 'incomplete' }); return 'gap'; }
          tokens = delta;
        }
        counter = { key: sourceKey, tokens: sample.tokens };
      }
      const fact: UsageFact = { id: key, fingerprint, sessionId, source, at, model: sample.model, tokens, audioSeconds: null, characters: null, credits: null,
        costUsd: sample.costUsd, costKind: sample.costKind, costComplete: sample.costComplete };
      await this.append({ type: 'fact', fact, ...(counter ? { counter } : {}) }); return 'recorded';
    });
  }
  recordAmounts(fact: UsageFact): Promise<'recorded' | 'duplicate'> {
    fact = structuredClone(fact);
    return this.enqueue(async () => {
      const prior = this.facts.get(fact.id);
      if (prior) {
        if (JSON.stringify(prior) !== JSON.stringify(fact)) throw new Error('Verbrauchsereignis wurde mit anderen Daten wiederholt.');
        return 'duplicate';
      }
      await this.append({ type: 'fact', fact }); return 'recorded';
    });
  }

  speechOutcome(factId: string, state: 'complete' | 'unconfirmed' | 'not-sent'): Promise<void> {
    return this.enqueue(async () => {
      if (this.facts.get(factId)?.requestState === state) return;
      await this.append({ type: 'speech-outcome', factId, state });
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Verbrauchsjournal ist geschlossen.'));
    const pending = this.queue.then(async () => { if (this.failure || this.fd === undefined) throw new Error(this.failure ?? 'Verbrauchsjournal ist geschlossen.'); return operation(); });
    this.queue = pending.catch(() => undefined); return pending;
  }
  private validate(event: Event): void {
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('invalid event');
    if (event.type === 'session') {
      if (!own(event, ['type', 'session']) || !validSession(event.session) || this.sessions.has(event.session.id) || this.sessions.size >= MAX_SESSIONS) throw new Error('invalid session');
    } else if (event.type === 'fact') {
      const provider = this.sessions.get(event.fact?.sessionId)?.provider;
      const expected = event.fact?.source === 'codex-rollout' ? 'codex' : event.fact?.source === 'claude-otel' ? 'claude'
        : event.fact?.source === 'grok-session' ? 'grok' : 'elevenlabs';
      if (!own(event, ['type', 'fact', 'counter']) || !validFact(event.fact) || !this.sessions.has(event.fact.sessionId)
        || provider !== expected || this.facts.has(event.fact.id) || this.facts.size >= MAX_FACTS
        || event.counter && (!own(event.counter, ['key', 'tokens']) || !hashId(event.counter.key) || !validTokens(event.counter.tokens))) throw new Error('invalid fact');
    } else if (event.type === 'speech-outcome') {
      const fact = this.facts.get(event.factId);
      if (!own(event, ['type', 'factId', 'state']) || !hashId(event.factId) || !fact || !fact.source.startsWith('elevenlabs-')
        || fact.requestState !== 'pending' || !['complete', 'unconfirmed', 'not-sent'].includes(event.state)) throw new Error('invalid speech outcome');
    } else if (event.type === 'coverage') {
      const session = this.sessions.get(event.sessionId);
      if (!own(event, ['type', 'sessionId', 'coverage', 'endedAt']) || !session || !coverage(event.coverage)
        || event.endedAt !== undefined && (!time(event.endedAt) || event.endedAt < session.createdAt)) throw new Error('invalid coverage');
    } else if (event.type === 'budget') {
      if (!own(event, ['type', 'monthlyUsd']) || !validUsageBudget(event.monthlyUsd)) throw new Error('invalid budget');
    } else throw new Error('unknown event');
  }
  private apply(event: Event): void {
    if (event.type === 'session') this.sessions.set(event.session.id, event.session);
    else if (event.type === 'fact') {
      this.facts.set(event.fact.id, event.fact); if (event.counter) this.counters.set(event.counter.key, event.counter.tokens);
      const session = this.sessions.get(event.fact.sessionId)!; if (session.coverage === 'waiting') session.coverage = 'recording';
    } else if (event.type === 'speech-outcome') this.facts.get(event.factId)!.requestState = event.state;
    else if (event.type === 'coverage') Object.assign(this.sessions.get(event.sessionId)!, { coverage: event.coverage }, event.endedAt === undefined ? {} : { endedAt: event.endedAt });
    else this.monthlyUsd = event.monthlyUsd;
  }
  private checkFile(): void {
    assertNoLinks(this.file); const current = lstatSync(this.file); const open = fstatSync(this.fd!);
    if (!current.isFile() || current.dev !== this.identity!.dev || current.ino !== this.identity!.ino
      || open.dev !== current.dev || open.ino !== current.ino || current.size !== open.size) throw new Error('journal replaced');
  }
  private checkStamp(): void {
    const current = fstatSync(this.fd!);
    if (current.mtimeMs !== this.stamp?.mtimeMs || current.ctimeMs !== this.stamp?.ctimeMs) throw new Error('journal modified');
  }
  private async append(event: Event): Promise<void> {
    if (event.type === 'fact' && this.facts.size >= MAX_FACTS || event.type === 'session' && this.sessions.size >= MAX_SESSIONS) { this.fail(); throw new Error(this.failure!); }
    this.validate(event); const snapshot = structuredClone(event); const bytes = Buffer.from(`${JSON.stringify(snapshot)}\n`, 'utf8');
    if (bytes.length > MAX_LINE || this.bytes + bytes.length > MAX_BYTES) { this.fail(); throw new Error(this.failure!); }
    try {
      this.checkFile(); this.checkStamp(); if (fstatSync(this.fd!).size !== this.bytes) throw new Error('journal changed');
      let offset = 0;
      while (offset < bytes.length) {
        const written = await new Promise<number>((resolve, reject) => write(this.fd!, bytes, offset, bytes.length - offset, null, (error, size) => error ? reject(error) : resolve(size)));
        if (!written) throw new Error('short write'); offset += written;
      }
      await new Promise<void>((resolve, reject) => fsync(this.fd!, error => error ? reject(error) : resolve()));
      this.checkFile(); if (fstatSync(this.fd!).size !== this.bytes + bytes.length) throw new Error('journal changed');
      const current = fstatSync(this.fd!); this.stamp = { mtimeMs: current.mtimeMs, ctimeMs: current.ctimeMs };
      this.bytes += bytes.length; this.apply(snapshot);
    } catch { this.fail(); throw new Error(this.failure!); }
  }
  private fail(): void { this.failure = 'Verbrauchserfassung ist unvollständig: Journal nicht verfügbar, verändert oder voll. Bestehende Daten bleiben erhalten.'; }
}
