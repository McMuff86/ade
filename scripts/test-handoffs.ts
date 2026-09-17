import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_CONFIG, type Run, type RunTask, type SessionMeta } from '../src/shared/types';
import type { SupervisionAction, SupervisionCommand } from '../src/shared/supervision';
import { SupervisionStore } from '../src/main/supervision/SupervisionStore';
import { SupervisionService } from '../src/main/supervision/SupervisionService';
import { assertIpcPayload } from '../src/main/ipcValidation';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-handoffs-'))); const path = join(root, 'supervision.json');
let passed = 0; let failed = 0; let sequence = 0;
const check = (label: string, ok: boolean) => { if (!ok) throw new Error(label); passed++; console.log(`  ok  ${label}`); };
const rejects = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };
try {
  const config = structuredClone(DEFAULT_CONFIG);
  config.repositories = ['a', 'b', 'c'].map(id => ({ id, name: 'Same name', rootPath: join(root, id), commonGitDir: join(root, id, '.git'), executionBackend: 'native', verified: true, createdAt: 1 }));
  config.runs = [{ id: 'run-a', repositoryId: 'a', name: 'Last task', status: 'completed', updatedAt: 50 } as Run];
  const session = { id: 'session-c', repositoryId: 'c', title: 'Direct CLI', kind: 'interactive', status: 'running' } as SessionMeta;
  const create = () => new SupervisionService(new SupervisionStore(path), { get: () => config }, id => id === session.id ? session : undefined, () => 100 + sequence);
  let service = create();
  const command = (action: SupervisionAction) => service.command({ ...action, revision: service.query().revision, commandId: `test-${++sequence}` });
  check('empty morning overview invents no previous work', service.briefing().projects.length === 0);
  for (const repositoryId of ['a', 'b', 'c']) command({ operation: 'project', repositoryId, mode: repositoryId === 'b' ? 'observe' : 'direct', objective: '' });
  const [a, b, c] = service.query().projects;
  command({ operation: 'link', projectId: a.id, target: { kind: 'run', id: 'run-a' } });
  command({ operation: 'link', projectId: c.id, target: { kind: 'session', id: session.id } });
  const linkId = service.query().projects[0].links[0].id;
  const input: SupervisionCommand = { operation: 'remember', projectId: a.id, text: 'Abend: Architekturentscheidung festgehalten.', nextStep: 'Morgen die Umsetzung besprechen.', linkId,
    commandId: 'remember-a', revision: service.query().revision };
  service.command(input); service = create();
  let briefing = service.briefing(); const handoff = briefing.projects[0].handoffs[0];
  check('handoff survives a new host service with its exact project', handoff.status === 'open' && !briefing.projects[1].handoffs.length);
  check('morning summaries contain only digests and lengths', !JSON.stringify(briefing).includes('Architekturentscheidung') && handoff.text.chars === input.text.length && !JSON.stringify(briefing).includes(root));
  check('explicit detail returns the complete confirmed handoff', service.handoff(a.id, handoff.id).text === input.text && service.handoff(a.id, handoff.id).nextStep === input.nextStep);
  check('same-name project cannot retrieve another handoff', rejects(() => service.handoff(b.id, handoff.id)));
  check('remember replay is durable and appends only once', service.command(input).replayed && service.briefing().projects[0].handoffs.length === 1);
  check('changed remembered text cannot reuse its command ID', rejects(() => service.command({ ...input, text: 'changed' })));
  check('remember does not launch or alter project work', config.runs[0].status === 'completed' && !config.runTasks.length && service.query().projects[0].mode === 'direct');
  check('morning suggestion distinguishes saved next step and observed work', briefing.projects[0].suggestion === 'resume-handoff' && briefing.projects[1].suggestion === 'choose-work'
    && briefing.projects[2].suggestion === 'observe-work' && briefing.projects[0].work[0].updatedAt === 50 && briefing.projects[2].work[0].updatedAt === null);
  check('wrong-project handoff source is rejected', rejects(() => command({ operation: 'remember', projectId: b.id, text: 'Foreign', nextStep: '', linkId })));
  check('wrong-project handoff status is rejected', rejects(() => command({ operation: 'handoff-status', projectId: b.id, handoffId: handoff.id, status: 'done' })));
  command({ operation: 'handoff-status', projectId: a.id, handoffId: handoff.id, status: 'done' });
  check('marking done retains original content and removes resume suggestion', service.handoff(a.id, handoff.id).text === input.text && service.briefing().projects[0].suggestion === 'choose-work');
  command({ operation: 'handoff-status', projectId: a.id, handoffId: handoff.id, status: 'open' });
  config.runTasks = [{ id: 'question-task', runId: 'run-a', status: 'running', questions: [{ id: 'question', status: 'pending', questions: [{ question: 'Private question body' }] }] } as RunTask];
  briefing = service.briefing();
  check('pending runtime question has priority without exposing question text', briefing.projects[0].suggestion === 'answer-question' && briefing.projects[0].work[0].pendingQuestions === 1 && !JSON.stringify(briefing).includes('Private question body'));
  command({ operation: 'unlink', projectId: a.id, linkId }); config.runs = [];
  check('handoff survives unlink and unavailable work', service.handoff(a.id, handoff.id).text === input.text && !service.briefing().projects[0].work.length);
  config.repositories[0].name = 'Renamed';
  check('renaming project retains stable morning identity', service.briefing().projects[0].id === a.id && service.briefing().projects[0].name === 'Renamed');
  check('strict boundary rejects excess fields and oversized notes', rejects(() => assertIpcPayload('supervision:handoff', { projectId: a.id, handoffId: handoff.id, cwd: root }))
    && rejects(() => command({ operation: 'remember', projectId: a.id, text: 'x'.repeat(4001), nextStep: '', linkId: null })));
  const legacyPath = join(root, 'legacy.json'); const current = new SupervisionStore(path).snapshot();
  const { handoffs: _handoffs, ...legacy } = current; writeFileSync(legacyPath, JSON.stringify({ ...legacy, version: 1 })); const before = readFileSync(legacyPath, 'utf8');
  const migrated = new SupervisionStore(legacyPath);
  check('v1 migration preserves assignments and original bytes until an explicit write', migrated.snapshot().version === 2 && migrated.snapshot().projects.length === 3 && readFileSync(legacyPath, 'utf8') === before);
  const state = migrated.snapshot(); state.revision++; migrated.save(state);
  check('v1 positive write saves the complete v2 state', JSON.parse(readFileSync(legacyPath, 'utf8')).version === 2);
  const malformed = join(root, 'broken.json'); writeFileSync(malformed, JSON.stringify({ ...current, handoffs: [{ ...current.handoffs[0], projectId: 'unknown' }] }));
  check('orphaned stored handoffs fail closed instead of being dropped', rejects(() => new SupervisionStore(malformed)));
  command({ operation: 'remember', projectId: b.id, text: 'Brainstorming only', nextStep: 'Discuss options', linkId: null });
  check('final independent project can save its own handoff after negative controls', service.briefing().projects[1].handoffs.length === 1 && service.query().projects[1].mode === 'observe');
} catch (error) { failed++; console.error(error); }
finally { if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root'); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
console.log(`Project handoffs: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
