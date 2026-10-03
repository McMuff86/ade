# Standing supervisor: continuous oversight, review and re-dispatch

Status: design note, 3 October 2026. Not a decision, not implemented. Written
by the Cursor orchestrator session (`ade-orchestrator`) from two days of manual
operation of this pattern over Claude Code CLI sessions in the Kernel Lab
repository and, since today, over the `ade-27` session in this repository.
Related: [GRAPH_ORCHESTRATOR_DESIGN](GRAPH_ORCHESTRATOR_DESIGN.md) (one-shot
managed runs), [HOST_ARCHITECTURE_DECISION](../../HOST_ARCHITECTURE_DECISION.md)
(Goal 34.6, review item R8), ADE orchestration skill
(`.claude/skills/ade-orchestration/SKILL.md`).

## 1. What was observed

The pattern that worked in practice is not a pipeline above the agents but a
long-lived peer *beside* them:

- A supervisor with its own identity is woken by events, not by a schedule:
  a peer message, a moved `HEAD`, a clean/dirty transition of the working tree,
  a stable status change of a session (working → idle), plus a long heartbeat.
- It reads code and documentation itself and sends review lists with concrete
  locations ("38 fields on `Viewport`, `use super::*`, closure from the app"),
  instead of judging from worker summaries.
- It records file ownership between parallel agents (path patterns → owner,
  "shared only after agreement") and settles conflicts before they reach Git.
- It carries user decisions into the plan and roadmap and re-dispatches when
  an agent stops although the goal continues (Kernel Lab: M6–M8 after the
  worker had declared M5 the end).
- The agents correctly treat its messages as *input, not authority* until the
  user grants delegation inside each session, with explicit limits (own files
  and branches; no push, remote actions, deletion or activation).

The infrastructure was ad hoc: a Python peer client and inbox over Claude
Code's cross-session Unix sockets, a shell watcher emitting wake sentinels, and
chat as the only record of findings. Everything below is about making the
useful part a product contract while keeping "models propose, ADE disposes".

## 2. What ADE has today

Managed runs with roles orchestrator/lead/worker/verifier, `RunCoordinator`
as the phase machine planning → working → approval → integrating →
verifying, path ownership and overlap checks for managed tasks,
`MailboxService`, `StructuredTaskResult`, budgets, journal and `RunReport`.
This is a strong *single-pass* pipeline.

## 3. The gap

| Missing | Consequence today |
|---|---|
| Standing oversight | A planner assigns each participant at most once; there is no review → finding → follow-up loop inside a run and no observation *while* a task runs. |
| Interactive sessions are invisible | The daily practice is Claude Code / Codex CLI sessions in ADE terminals. They have no status events in the journal, no file ownership and no peer channel through ADE. Claude Code brings its own cross-session messaging; Codex does not. |
| Review is untyped | Findings live in chat. There is no journal record "finding with location, severity, owner, status" from which follow-up tasks arise and whose closure is checked. |
| Documentation drift is nobody's task | Roadmap/status against code repeatedly surfaced contradictions in the Kernel Lab; ADE has the `pnpm verify` gate but no standing reviewer. |
| Delegation is a prompt | The authority grant is typed by hand into each CLI session and leaves no record. |

## 4. Proposal: a `supervisor` role bound to sessions

A long-lived participant with role `supervisor`, bound to a set of sessions
(interactive or managed) of one repository. Six components, each a contract
ADE owns:

1. **Observation stream from the host.** Session status from adapter and
   app-server events (never screen scraping), `HEAD` and dirty state per
   worktree, result and failure events, as journal events following the
   existing `orchestration:changed` pattern. The supervisor subscribes; it
   does not poll terminals. This is the Goal 34.6 dependency: the supervisor
   must outlive the desktop, so the stream and the role live in the host.
2. **Peer channel through ADE.** `MailboxService` as the uniform transport
   for every runtime; for Claude Code additionally native delivery as
   `<cross-session-message>` with sender identity and permission mode (which
   Claude Code already requires for immediate delivery to bypass sessions);
   for Codex through the mailbox files it already reads. Messages are
   journaled as digests/lengths in the renderer view, full text stays in main.
3. **Delegation as a contract, not a prompt.** The user grants the supervisor
   authority over named sessions with explicit limits (allowed paths and
   branches; forbidden: push, remote actions, deletion, `pnpm activate`). The
   grant is a journal record with a UI, is revocable, and is what a session
   receives as part of its task context. Without a grant the supervisor's
   messages are input only — exactly what the agents do by themselves today.
4. **File ownership as data.** The ownership table (path patterns → session or
   participant; shared paths flagged) is maintained in ADE and checked when a
   commit is recorded; violations become findings, never silent passes. The
   managed-task overlap check is the existing mechanism; this extends it to
   interactive sessions.
5. **Typed findings and follow-up tasks.** A `review.finding` journal record
   (location, severity, owner, status open/fixed/rejected, rationale) and the
   ability to dispatch a follow-up task to the *same* participant. This lifts
   the one-assignment rule deliberately and boundedly: a per-run round budget
   instead of an open loop. Rejected findings need a reason, like the review
   list sent to `ade-27` today.
6. **Standing documentation verifier.** A read-only verifier task that
   compares roadmap, status, goal registry and handoff with code and commits
   and reports deviations as findings — the job the orchestrator currently
   does by hand.

### Contract sketches

Wire DTOs belong in `src/shared/remote.ts` and journal data reaches devices
only through the `WIRE_EVENT_DATA_KEYS` whitelist; the sketches are shapes,
not names to ship.

```ts
type SessionObservation =
  | { kind: 'session.status'; sessionId: string; status: 'working' | 'idle' | 'blocked' | 'exited'; at: string }
  | { kind: 'worktree.head'; bindingId: string; sha: string; dirty: boolean; at: string };

interface DelegationGrant {
  supervisorParticipantId: string;
  sessionIds: string[];
  allowedPaths: string[];      // glob patterns the supervisor may assign
  forbidden: Array<'push' | 'remote' | 'delete' | 'activate'>;
  grantedAt: string; revokedAt: string | null;
}

interface OwnershipEntry { pattern: string; ownerId: string; shared: boolean; note: string }

interface ReviewFinding {
  id: string; runId: string | null; ownerId: string;
  location: { path: string; line: number | null } | null;
  severity: 'high' | 'medium' | 'low';
  summary: string;             // bounded, redacted; never a prompt
  status: 'open' | 'fixed' | 'rejected'; rationale: string | null;
}
```

## 5. Order of work

1. Components 3 and 5 first: pure journal and contract work, no host needed,
   immediately useful for managed runs (findings and bounded follow-up rounds
   on the existing phase machine).
2. Components 1 and 2 together with Goal 34.6 stages H3/H4, where the host
   gains the event stream and the local transport anyway.
3. Components 4 and 6 afterwards; both depend on reliable observation.

Before any of it: run the manual pattern here and in the Kernel Lab for about
two weeks and count findings, re-dispatches and ownership conflicts, so the
contracts are derived from real cases.

## 6. Non-goals

- No autonomous authority: the supervisor never acts without a grant, never
  pushes, never integrates, never activates.
- No screen analysis for agent status while native adapter events exist.
- No second orchestration engine: findings and follow-ups extend
  `RunCoordinator` and the journal, they do not replace them.
- No replacement for the human approval gate before integration.

## 7. Acceptance evidence to require

- A follow-up round reaches the same participant only within the round budget;
  the budget exhausted fails closed with the open findings listed.
- A session without a grant receives supervisor messages as input and ADE
  records no authority; with a grant the allowed paths are enforced on the
  recorded commit, and a path outside the grant becomes a finding.
- Desktop quit does not end the supervisor or its subscriptions (requires
  34.6 H3+; until then documented as not supported).
- Prompts, message bodies and finding details never appear in the renderer
  view or on the device wire beyond digests and bounded, redacted summaries.

## 8. Open questions

- Should the supervisor be a Codex or Claude identity, or runtime-agnostic
  like other participants? The Kernel Lab operation ran from a Cursor session;
  ADE should not depend on that.
- How much of the ownership table should be derived from the plan (managed
  runs) versus declared by the user (interactive sessions)?
- Whether Claude Code's cross-session protocol is stable enough to build on,
  or whether the mailbox must remain the only contract and native delivery an
  optimization.
