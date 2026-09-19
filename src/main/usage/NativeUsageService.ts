import { t as translate } from "../../shared/i18n";
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { redactedErrorDetail, redactedErrorMessage } from '../errors';
import type { SessionConsumption } from '../../shared/remote';
import type { TokenCounts } from '../../shared/usage';
import { TOKEN_FIELDS, unknownTokens } from '../../shared/usage';
import { findNativeUsageFile, NativeUsageTail } from './NativeUsageFile';
import { OtlpUsageReceiver, type UsageLog } from './OtlpUsageReceiver';
import { claudeRequest, codexSnapshot, grokTurn } from './normalize';
import { UsageJournal, usageDigest } from './UsageJournal';

type Provider = 'codex' | 'claude' | 'grok';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const quotePs = (value: string) => `'${value.replace(/'/g, "''")}'`;
interface Launch {
  id: string; provider: Provider; home: string; startedAt: number; nativeId?: string; model: string | null;
  tail?: NativeUsageTail; verified: boolean; partial: boolean; stopped: boolean;
  registration?: Awaited<ReturnType<OtlpUsageReceiver['register']>>;
  timer?: ReturnType<typeof setTimeout>; queue: Promise<unknown>; finishing?: Promise<void>;
}
export interface NativeUsageLaunch {
  command: string; env: Record<string, string>; finish(outcome?: 'normal' | 'interrupted'): Promise<void>;
}

/** Native Windows interactive starts only. This service never discovers
 * arbitrary running CLIs, changes provider config files or reads another
 * process's latest conversation. Its private receiver is lazy and local. */
export class NativeUsageService {
  private readonly receiver = new OtlpUsageReceiver();
  private readonly launches = new Map<string, Launch>();
  private closing = false;
  constructor(readonly journal: UsageJournal) {}

  async prepare(input: { provider: Provider; command: string; env: NodeJS.ProcessEnv; terminalSessionId: string; repositoryId?: string | null; agentId?: string; now?: number }): Promise<NativeUsageLaunch> {
    if (this.closing || this.launches.size >= 64) throw new Error(translate("Usage measurement is not available."));
    const provider = input.provider; const startedAt = input.now ?? Date.now();
    const variable = provider === 'codex' ? 'CODEX_HOME' : provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'GROK_HOME';
    const home = input.env[variable] || join(homedir(), `.${provider}`);
    if (!isAbsolute(home)) throw new Error(translate("The native provider folder is not unique for usage recording."));
    const id = await this.journal.openSession({ provider, product: 'coding', backend: 'native', terminalSessionId: input.terminalSessionId,
      ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}), ...(input.agentId ? { agentId: input.agentId } : {}), createdAt: startedAt, coverage: 'waiting' });
    if (this.closing || this.launches.size >= 64) {
      await this.journal.setCoverage(id, 'incomplete', Math.max(Date.now(), startedAt));
      throw new Error(translate("Usage measurement is not available."));
    }
    const launch: Launch = { id, provider, home, startedAt, model: null, nativeId: provider === 'codex' ? undefined : randomUUID(),
      verified: false, partial: false, stopped: false, queue: Promise.resolve() };
    this.launches.set(id, launch);
    const env: Record<string, string> = {}; let command = input.command;
    try {
      if (provider !== 'grok') {
        launch.registration = await this.receiver.register(async logs => { await this.serial(launch, () => this.consumeLogs(launch, logs)); });
        env.OTEL_EXPORTER_OTLP_LOGS_HEADERS = launch.registration.header;
        if (provider === 'codex') {
          // TOML literal strings also survive the Windows PowerShell 5.1
          // native argv marshaller; no embedded double quotes or secrets.
          command += ` -c ${quotePs(`otel.exporter={otlp-http={endpoint='${launch.registration.endpoint}',protocol='json'}}`)} -c ${quotePs('otel.log_user_prompt=false')}`;
        } else {
          Object.assign(env, { CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_LOGS_EXPORTER: 'otlp', OTEL_METRICS_EXPORTER: 'none',
            OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: 'http/json', OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: launch.registration.endpoint,
            OTEL_LOG_USER_PROMPTS: '0', OTEL_LOG_TOOL_DETAILS: '0', OTEL_LOG_RAW_API_BODIES: '0' });
        }
      }
      if (provider !== 'codex') command += ` --session-id ${quotePs(launch.nativeId!)}`;
      this.schedule(launch);
      return { command, env, finish: (outcome = 'interrupted') => this.finish(launch, outcome) };
    } catch (error) {
      await this.finish(launch).catch(() => undefined); throw error;
    }
  }

  /** Used by the timer and deterministic collector tests, never IPC. */
  async poll(): Promise<void> {
    await Promise.all([...this.launches.values()].map(launch => this.serial(launch, () => this.read(launch))));
  }
  async close(): Promise<void> {
    this.closing = true;
    try { await Promise.all([...this.launches.values()].map(launch => this.finish(launch))); }
    finally { try { await this.receiver.close(); } finally { await this.journal.close(); } }
  }

  consumption(terminalSessionId: string): SessionConsumption {
    const view = this.journal.view(); const sessions = view.sessions.filter(session => session.terminalSessionId === terminalSessionId && session.product === 'coding');
    const ids = new Set(sessions.map(session => session.id)); const facts = view.facts.filter(fact => ids.has(fact.sessionId));
    const tokens = unknownTokens(); const missing = {} as Record<keyof TokenCounts, number>;
    for (const field of TOKEN_FIELDS) {
      const values = facts.map(fact => fact.tokens[field]); missing[field] = values.filter(value => value === null).length;
      const known = values.filter((value): value is number => value !== null);
      const sum = known.reduce((total, value) => total + value, 0); tokens[field] = known.length && Number.isSafeInteger(sum) ? sum : null;
    }
    const costs = (['provider-estimate', 'provider-reported', 'configured-estimate'] as const).flatMap(kind => {
      const selected = facts.filter(fact => fact.costKind === kind && fact.costUsd !== null);
      return selected.length ? [{ kind, usd: selected.reduce((sum, fact) => sum + fact.costUsd!, 0), events: selected.length,
        complete: selected.every(fact => fact.costComplete === true) }] : [];
    });
    const speech: NonNullable<SessionConsumption['speech']> = [];
    for (const product of ['dictation', 'speech-test', 'speech-reply'] as const) {
      const speechIds = new Set(view.sessions.filter(session => session.terminalSessionId === terminalSessionId && session.product === product).map(session => session.id));
      const selected = view.facts.filter(fact => speechIds.has(fact.sessionId) && fact.source === 'elevenlabs-request');
      if (!selected.length) continue;
      const unit = product === 'dictation' ? 'audioSeconds' : 'characters';
      const requests = { complete: 0, pending: 0, unconfirmed: 0, 'not-sent': 0 }; const amounts = { ...requests };
      const unknownAmounts = { ...requests };
      for (const fact of selected) {
        const state = fact.requestState ?? 'pending'; requests[state]++; amounts[state] += fact[unit] ?? 0;
        if (fact[unit] === null) unknownAmounts[state]++;
      }
      speech.push({ product, unit, requests, amounts, ...(Object.values(unknownAmounts).some(value => value > 0) ? { unknownAmounts } : {}) });
    }
    return { status: view.error ? 'incomplete' : !sessions.length ? 'unsupported' : sessions.some(session => session.coverage === 'incomplete') ? 'incomplete'
      : facts.length ? 'recording' : 'waiting', ended: sessions.length > 0 && sessions.every(session => session.endedAt !== undefined),
      checkedAt: Date.now(), lastReportedAt: facts.length ? Math.max(...facts.map(fact => fact.at)) : null,
      events: facts.length, tokens, missing, costs, eventsWithoutCost: facts.filter(fact => fact.costUsd === null).length,
      ...(speech.length ? { speech } : {}),
      models: [...new Set(facts.map(fact => fact.model).filter((model): model is string => model !== null))].slice(0, 32),
      notice: view.error ? redactedErrorMessage(view.error, 1000) : (!sessions.length ? translate("Capture applies to new native Windows Codex, Claude Code and Grok sessions.")
        : translate("Native CLI numbers of this ADE session. Continued third-party conversations, forks and separate sub-agents are not yet fully covered.")) };
  }

  private serial<T>(launch: Launch, operation: () => Promise<T>): Promise<T | undefined> {
    const pending = launch.queue.then(async () => { if (!launch.stopped) return operation(); });
    launch.queue = pending.catch(async error => {
      if (!launch.partial) console.warn('[ade] native usage read failed:', redactedErrorDetail(error));
      await this.gap(launch, 'source-read').catch(() => undefined);
    }); return pending;
  }
  private async gap(launch: Launch, reason = 'source-data'): Promise<void> {
    if (launch.partial) return; launch.partial = true;
    console.warn(`[ade] native usage incomplete (${launch.provider}, ${reason}).`);
    await this.journal.setCoverage(launch.id, 'incomplete');
  }
  private schedule(launch: Launch): void {
    if (launch.stopped || launch.finishing || this.closing) return;
    launch.timer = setTimeout(() => {
      void this.serial(launch, () => this.read(launch)).catch(() => undefined).finally(() => this.schedule(launch));
    }, 750); launch.timer.unref();
  }
  private finish(launch: Launch, outcome: 'normal' | 'interrupted' = 'interrupted'): Promise<void> {
    return launch.finishing ??= this.finishOnce(launch, outcome);
  }
  private async finishOnce(launch: Launch, outcome: 'normal' | 'interrupted'): Promise<void> {
    if (launch.timer) clearTimeout(launch.timer);
    // Revoke first, then drain work already accepted into this launch queue.
    launch.registration?.release();
    await this.serial(launch, async () => {
      if (outcome === 'interrupted') await this.gap(launch, 'session-interrupted');
      let more = false;
      for (let attempt = 0; attempt < 16; attempt++) { more = await this.read(launch); if (!more) break; }
      if (more) await this.gap(launch);
    }).catch(() => undefined);
    launch.stopped = true; this.launches.delete(launch.id);
    await launch.queue;
    const session = this.journal.view().sessions.find(item => item.id === launch.id);
    if (session) await this.journal.setCoverage(launch.id, launch.partial || session.coverage === 'waiting' ? 'incomplete' : session.coverage, Math.max(Date.now(), launch.startedAt));
  }
  private async consumeLogs(launch: Launch, logs: UsageLog[]): Promise<void> {
    for (const log of logs) {
      if (launch.provider === 'codex' && log.name === 'codex.conversation_starts') {
        const nativeId = log.attributes['conversation.id'];
        if (typeof nativeId !== 'string' || !UUID.test(nativeId) || launch.nativeId && launch.nativeId !== nativeId) {
          await this.gap(launch, typeof nativeId !== 'string' ? 'conversation-id-missing' : !UUID.test(nativeId) ? 'conversation-id-format' : 'conversation-id-changed'); continue;
        }
        launch.nativeId = nativeId;
        launch.model = typeof log.attributes.model === 'string' ? log.attributes.model : null;
      } else if (launch.provider === 'claude' && log.name === 'claude_code.api_request') {
        if (log.attributes['session.id'] !== launch.nativeId) { await this.gap(launch, 'request-identity'); continue; }
        const requestId = log.attributes.request_id;
        const sample = typeof requestId === 'string' ? claudeRequest(log.attributes, requestId) : null;
        if (!sample) { await this.gap(launch); continue; }
        await this.journal.record(launch.id, 'claude-otel', usageDigest(`claude/${launch.nativeId}`), sample, Date.now());
      }
    }
    await this.read(launch);
  }
  private async read(launch: Launch): Promise<boolean> {
    if (!launch.nativeId || launch.provider === 'claude') return false;
    if (!launch.tail) {
      const file = findNativeUsageFile(launch.home, launch.provider, launch.nativeId); if (!file) return false;
      launch.tail = new NativeUsageTail(launch.home, file);
    }
    // Each pass is bounded independently of a CLI's transcript size.
    const result = launch.tail.read(); if (result.gap) await this.gap(launch);
    for (const line of result.lines) {
      const value = object(line.value);
      if (launch.provider === 'codex') {
        const payload = object(value.payload);
        if (value.type === 'session_meta') {
          const at = typeof payload.timestamp === 'string' ? Date.parse(payload.timestamp) : NaN;
          launch.verified = payload.id === launch.nativeId && payload.source === 'cli' && !payload.forked_from_id
            && at >= launch.startedAt && at <= Date.now() + 10_000;
          if (!launch.verified) await this.gap(launch, 'conversation-history');
        }
        if (value.type === 'turn_context') launch.model = typeof payload.model === 'string' ? payload.model : null;
        if (!launch.verified) continue;
        const sample = codexSnapshot(value, launch.model, `byte-${line.offset}`);
        if (sample) await this.journal.record(launch.id, 'codex-rollout', usageDigest(`codex/${launch.nativeId}`), sample, Date.now());
      } else {
        const params = object(value.params);
        if (params.sessionId !== launch.nativeId) { if (object(params.update).sessionUpdate === 'turn_completed') await this.gap(launch); continue; }
        const sample = grokTurn(value);
        if (sample) await this.journal.record(launch.id, 'grok-session', usageDigest(`grok/${launch.nativeId}`), sample, Date.now());
      }
    }
    return result.more;
  }
}
