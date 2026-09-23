# ADE — Architecture (binding decisions)

## Language and conversation modes (20 September 2026)

Desktop and mobile use typed German/English i18next catalogs, an extensible locale
registry, device-local language selection and locale-aware presentation tables.
Only the desktop saves `settings.language` through the existing strict config
IPC. Switching does not remount editors/terminals or change personal content.
Legacy app-owned host notices are translated after redaction at the UI boundary.

The Conversations entry separates project supervision from casual chat. The
optional create mode selects a main-owned tool contract; casual bindings inherit
model/reasoning only, expose no project tools and fail project action authority.
Voice studio extends the existing strict speech-test payload with bounded text,
allowlisted models and per-request tuning; remote permissions and the durable
speech ledger stay in place. No generic command channel was added.
[Contracts, limits and validation status](LANGUAGES_AND_CONVERSATIONS.md).

## Tablet project context visibility

`ProjectDirectoryPage` owns a local presentation preference for the collapsible
project context. It hides mounted context controls rather than unmounting the
terminal or branch preview. Pending branch receipts override the preference;
workspace errors, loading and offline notices remain outside the hidden region.
The existing terminal focus/keyboard modes still take precedence. This introduces
no host command or device-authentication change. [Contract and evidence](TABLET_PROJECT_LAYOUT.md).

## Cross-project ADE supervision: implementation underway (17 September 2026)

The Codex tablet pilot adds five bounded domain tools to the five reads:
`ade_codex_profiles`, `ade_prepare_handoff`, `ade_prepare_task`, `ade_actions`
and `ade_action_result`. Preparing only persists a proposal. A user confirms its
exact action ID in the shared desktop/tablet dialog. Task prompts stay in main;
handoff bodies require explicit detail. Task results use the existing RunReport
fields and task-owned questions, not model claims or summary teasers.

`CoordinatorActionStore` holds the immutable conversation/turn/binding, payload,
native-call digest and stable dispatch key in `ade/conversation-actions.json`.
Atomic link-safe writes are bounded to 4 MiB, 256 actions and 1,024 command
receipts; capacity refuses new work instead of pruning parent evidence. These
records are separate from the orchestration journal. Confirmation persists
`dispatching` before any side effect. `RunCoordinator.submitSingleTask` atomically
creates the child; its reservation callback persists the exact child IDs before
queue admission. A failed parent save prevents launch and marks that child failed.
The graph derives the relation from this ledger, without a fallible later link.
Recovery reads an existing child/command receipt and never dispatches again;
missing, pruned or conflicting evidence remains explicitly uncertain/unavailable.
Ordinary run archive/retention continues to own the child's journal and results.

Project tasks require available native repositories, mode `coordinate`, an
explicit native Codex profile with model/reasoning and unchanged authority.
The caller, project and worker are revalidated on admission, after the queue wait
and immediately before native spawn. The separate single-task contract applies;
this is not an automatically integrated managed multi-agent run. Ending the
central conversation does not cancel an already accepted project task.

Question-enabled native Codex single-task launches capture bounded profile and
optional memory through `buildInteractiveProfileSnapshot` and pass that read-only
context in the main-owned task prompt. They do not use legacy instruction-file
injection: repository `AGENTS.md` must remain untouched before file tracking and
execution. Repository instructions and the actual task take precedence over the
snapshot, which does not authorize writes to external memory files. Main rechecks
the snapshot immediately before spawn and refuses changed/unreadable context.
Managed phase launches retain their existing external task context. The native
tablet driver exercises real Codex, the signed browser, production queue, lost
receipts, pending questions, file results and a restart after completed work;
physical Android input remains a separate acceptance step.

Desktop `conversation:actionsQuery` and audited launch
`conversation:actionsCommand` remain desktop-only. Signed host POST routes
`/api/v1/conversation/actions/query` and `/command` use only
`AdeApplicationService`, active-device proof, `read`, `workspace:read`, full
resource access and, for decisions, `runs:write`, durable idempotency and audit.
Payloads name the ADE conversation/action only. No client run, workspace, PTY or
main command ID is accepted; the generic remote IPC allowlist is unchanged.
Wire names, errors, handoff details, results and questions are redacted. Device
epochs invalidate stale reads; loss of access removes action/result details.
The reload-stable decision key uses the HTTP key alphabet (letters/digits/hyphens).

Conversation dictation has a separate main-owned target. The audited desktop-only
`conversation:dictationPrepare` takes exactly one ADE conversation UUID; existing
dictation ticket channels transport PCM and read the result. `recordingTarget`
rechecks conversation existence, open state, exact profile/project binding and
unconfirmed-turn state on every packet/result. Usage records the actual profile
without inventing a terminal or project. Signed `POST /api/v1/conversation/dictation`
goes only through `AdeApplicationService`, requiring `read`, `workspace:read`,
`dictation:transcribe`, an active device and all-resource access. Its separate
`device:<id>:conversation` owner prevents terminal-ticket reuse. Commands use
the durable ledger, packets use bounded job receipts; device revocation aborts
both owner namespaces. No terminal scope or generic remote IPC expansion.

The shared conversation recorder asks for microphone access before opening the
paid stream, persists the host ticket before provider start, and never retries
an uncertain paid start. Live PCM remains ephemeral. Up to 16 local text previews
share the existing 1-MiB draft bound; exact version-one recovery migrates to v2.
Switching or closing cancels capture and preserves the partial preview on its
original conversation. Applying is explicit and atomically consumes that preview
into the latest 64-Ki-character message, refusing overflow or changed storage.
No model message is sent by dictation. Transcript output is redacted before wire
delivery; existing terminal dictation keeps its own authorization requirements.

Desktop and tablet **ADE-Betreuung → Mit ADE sprechen** now share a separate persistent
conversation. `conversation:get` returns digests/counts only; `conversation:detail`
returns complete input, output and questions without native thread/turn IDs.
`conversation:command` is an audited desktop-only launch channel; no generic
remote allowlist expansion. Change notifications contain only `null` and use
`rendererWindows`. Host routes `/api/v1/conversation/query` and `/command` go only
through `AdeApplicationService`, requiring an active signed device, `read`,
`workspace:read` and all-resource access. Commands additionally require
`runs:write`, a durable remote ledger, a main-derived command ID and audit.
The global history is withheld from selected-project grants and after changes
to the conversation authority. Grants are rechecked after asynchronous admission.
Overview returns digest summaries plus the actual device write capability.
Explicit detail omits user text and carries input/output digests and question
counts. Answers are redacted in full before 2,000-character Unicode-safe pages;
question detail loads one item at a time. No native IDs or host paths reach wire DTOs.
The shared UI loads the current answer automatically and earlier answers on demand.
Its device-epoch cache is memory-only and is cleared on access failure or close.

Origin-local conversation drafts and pending create/send keys are saved before
dispatch, bounded to 1 MiB and 64 conversation drafts. Closing/reloading recovers
the same key; acknowledgement clears only the matching text and request. Device
forget removes this local recovery data. Question answers and audio are never
stored there. A confirmed main admission refusal releases the retry key without
erasing the draft; storage faults and uncertain transport retain it. Admission
checks a durable receipt after a synchronous exception, so failures after acceptance
cannot be mistaken for a safe opportunity to send a new message.

`userData/ade/conversations.json` has atomic revisioned writes, an 8 MiB limit,
64 conversations, 128 turns each and 8,192 command receipts. No silent pruning
or replacement of corrupt/linked/drifted originals. A turn reserves 1 MiB before
dispatch for its bounded complete result and questions. Durable receipts precede
native dispatch; ambiguous delivery remains `uncertain` after process/app exit
and cannot be replayed into that thread. Question answers retain digests and
require exact native acknowledgement. Closing the dialog differs from interrupting
the current turn and ending the conversation. Each conversation binds profile
instructions/model/reasoning, supervised repository identity/backend/mode and tool
contract. Changed authority requires a fresh native context; old detail stays
readable on the desktop. Native workspace directories live outside project repos.

The production coordinator uses the pinned Codex policy and ten domain tools
for supervised projects, handoffs and user-confirmed Codex tasks. Every
call revalidates authority and exact arguments. Long Unicode texts are chunked;
they are not silently truncated. Contract `ade-project-actions-v1` requires a new
conversation instead of expanding a resumed read-only context. Event-driven
wakeups, other providers and spoken replies remain subsequent contracts.

Implementation is underway; [implemented contracts and evidence](MAIN_AGENT_IMPLEMENTATION.md)
cover the shared session switcher, native Codex continuation and durable supervision metadata.
`supervision:get`/`detail`/`briefing`/`handoff` are desktop reads; `supervision:command` is an audited
desktop metadata mutation. No generic remote allowlist expansion. Signed host
`/api/v1/supervision/query` and `/command` routes use `AdeApplicationService`, the
existing remote ledger, `runs:write` for mutation, current resource grants and
redacted wire DTOs. Remote session relations are mapped by the authorized terminal
inventory, never by names or internal PTY IDs. The separate bounded
store keeps user objectives outside orchestration summaries and project workspaces;
only digests/lengths reach its summary DTO. It neither launches nor cancels work.
Store version 2 adds up to 1,024 explicit project handoffs with immutable text,
next step and original work target; open/done is a separate status change. Version
1 migrates in memory and writes only on an explicit command. The existing 2 MiB
store limit still applies; capacity refuses new writes instead of pruning notes.
The morning view projects linked work states, pending-question counts and note
digests. Full handoff text uses a scoped detail query. Suggestions are deterministic
next-action hints, never evidence of a completed task or a launch authorization.

Codex conversation mode supports bounded dynamic ADE tools via native
`item/tool/call`. Thread/turn/call identities are checked, duplicates share one
operation, changed identities fail closed, and abort signals expire with the turn.
Each result is at most 16 KiB; result reservations cap the process cache at 2 MiB.
Domain handlers must still validate exact arguments, current authority and durable
idempotency before side effects. This transport alone does not restrict native
Codex's other tools or implement the central coordinator. Codex 0.154 restores
tool specifications from its rollout on resume; the conversation owner must pin
its tool contract instead of assuming that resume replaces definitions.
The explicit coordinator mode adds `CoordinatorCodexPolicy`: constant native-Windows
launch overrides, a stable CLI identity of at least 0.154.0, effective config inspection before
the first turn, and a read-only/no-network thread even when the selected coding
profile allows bypass. Native execution, browser/computer, MCP, plugins and native
subagents are disabled. `code_mode_host` remains enabled because this CLI also
uses it to mediate dynamic ADE tools. Policy and native negative/positive probes
are separate from authorization in future domain handlers. Unexpected native
tool events close the connection; this does not promise rollback of prior effects.
Policy `ade-coordinator-policy-v3` uses the PC's installed `codex` for both desktop
and tablet conversations, including casual mode. A newer CLI version alone does
not reject a connection: each fresh process must confirm the effective config
and read-only/no-network thread before any prompt is sent. The first user-agent
product supplies the bounded CLI version; OS/terminal versions cannot satisfy
the minimum. Missing/malformed, older and prerelease identities are refused.
This is conditional protocol compatibility, not native evidence for every future
release. Existing live processes stay on their launched version; explicit resume
rechecks policy with the then-installed CLI. The ADE policy identity stays stable
across CLI-only updates; the one-time v2-to-v3 change requires a new conversation.
[Native evidence and operator instructions](CODEX_VERSION_COMPATIBILITY.md).
The policy first inventories configured MCP names with the local
CLI, without connecting, and adds process-local `enabled=false` overrides. Codex
0.154 merges `mcp_servers={}` with global entries instead of deleting them.
Names are bounded and restricted to safe TOML bare keys; malformed inventories
fail closed. Effective config must confirm every inherited entry explicitly
disabled. New/changed active entries still refuse the start. No global config
is changed. The policy is not inherited by ordinary project task mode.
The [goal plan](MAIN_AGENT_GOALS.md) extends Goals 26/27/33: an ADE supervisor
links separate project conversations and runs, with explicit session identity,
observed capabilities, event correlation and per-project control ownership.
Managed runs retain their single common-Git-directory boundary. An interactive
conversation is not represented as a synthetic coding run; single-task launch,
managed integration and persistent conversation are separate execution contracts.

The desktop/tablet graph projects host-owned project/work relationships and
navigates to the exact linked session/result. Native subagent relationships remain open.
View selection, terminal input ownership and supervision authorization remain
separate. Current managed leases can block interactive project launch, so direct
takeover needs a validated handoff instead of relaxing workspace protections.
Global conversation dictation uses its own recording contract described above.
Handoffs use the separate bounded supervision
store, not an orchestration journal extension. New journal records must participate in archive
and retention together with their owning records; renderer/wire redaction and
the application-service/IPC boundaries continue to apply.

[Source audit and focused evidence](MAIN_AGENT_BASELINE.md) distinguish existing
session navigation, adapters and result inspection from the unimplemented
automatic supervisor and global conversation from the implemented metadata/UI.

## Reviewed terminal reply speech (16 September 2026)

`ReplySpeechService` owns bounded, expiring, window/device-bound speech receipts.
The shared dialog captures a selected or visible terminal excerpt, permits editing,
and displays the redacted preview before explicit synthesis. Desktop `speech:reply`
is a host-effect desktop channel; signed tablet `POST /api/v1/terminal/speech`
routes only through `AdeApplicationService`, with speech/terminal scopes, workspace
revalidation and mutation idempotency/audit. No generic remote allowlist expansion.
One provider attempt per receipt; source/audio are memory-only and usage records
only measurements. Shutdown drains cancelled requests before closing usage.
[Full contracts and executable evidence](REPLY_SPEECH.md).

## Passive WSL discovery / Hermes (16 September 2026)

WSL discovery (`wsl:list`) only enumerates registered names through `wsl.exe --list --quiet`. It must never execute a guest health probe: even `true` boots systemd services and can trigger shutdown notifications when WSL later idles. `available` means registered for selection. Explicit backend operations retain runtime validation. [Diagnose und Nachweise](HERMES_WSL_DIAGNOSIS.md).

## Explicit Computer voice test (Goal 33.0)

`ComputerVoiceTest` shares the existing target-bound `PromptComposerPort` on
desktop/mobile. An explicit button arms up to 20 seconds of live dictation;
only an isolated Computer/Hey Computer call in the live transcript triggers one
greeting. Main still finalizes the audio, but a revised or empty final segment
does not discard an already recognized call. This allowance applies only to the
fixed greeting, never task submission or consequential actions.
Capture ends before synthesis/playback. Closing, hiding,
disconnecting or cancelling invalidates pending replies and releases microphone
and output. The component never changes drafts or dispatches CLI input.
`speech:test` and the existing signed, idempotent remote speech command accept
an optional strict `SpeechPreset`: `voice-check` or `computer-greeting`.
Main chooses bounded German text from host time. Arbitrary text is rejected.
Speech delivery uses optional validated `Settings.speechTuning`, with default
stability 0.9. The legacy speed/similarity/style/boost fields remain validated
and stored for compatibility, but the v3 dialogue WebSocket supports only stability.
`speech:configure` may save all five bounded parameters only for the default
target. `speech:test` accepts a validated unsaved preview only for voice-check;
the Computer greeting always uses persisted delivery. Main snapshots values and
explicitly maps stability to request-local `voice_settings`. The shared voice
settings show only supported controls, the v3 model and the short-A name rule. No provider-account
settings are changed. The shared Settings/Stimme tab uses the existing signed,
idempotent speech command, global-target authorization and recovery drafts;
IPC policy and generic remote allowlists stay unchanged. [Current contract](ELEVEN_V3_RESULTS.md).
The greeting welcomes Adi and explains explicitly choosing Diktieren, reviewing
the draft and sending it to the selected session. It claims neither an active
microphone nor knowledge of previous work. Greeting clients cannot override delivery.
Existing speech:control/default-target access and owner-bound expiring audio
receipts remain enforced; no new channel or generic remote-write permission.
Usage remains speech-test with actual text length. Both clients select the
global effective voice; restricted devices without default-target access cannot
use this first preview. AudioContext is unlocked in the activating gesture,
the visible reply can be replayed without another synthesis. This is an explicit
foreground preview, not an always-on recognizer or work-history summarizer.

## Desktop/mobile Work navigation

Desktop `CliWorkPanel` adds an interactive session inventory to Work and
Overview. `shared/cliWork.ts` projects existing `pty:list` metadata; credential
login and managed-task PTYs are excluded. No synthetic runs or launches.
`SessionMeta` captures runtime, optional actual launch model and workspace kind;
`lastOutputAt`/`outputSequence` describe observed output, never model readiness.
`openCliSession` reconciles live identities and verifies the project branch
before selecting the same session. Missing/changed targets produce an error.
Titles and seen-output markers are local, bounded to 256 entries under
`ade:cli-work`. No output bodies enter the list or orchestration history.
Active, visible foreground terminals mark output seen only at the live bottom.
Existing original-workspace cards navigate directly, independently of profiles.

## Runtime profile images

Desktop and mobile use bundled SVG marks for Codex/OpenAI, Claude, Grok and Ollama when
an agent has no personal photo. Selection is by `RuntimeId`, never the profile
name. `renderer/rail/runtimeLogos.ts` is shared by both builds; the public mobile
shell includes the assets for offline access. Custom photos keep priority and
their existing storage, import and wire bounds. Logos do not pass through that
raster thumbnail pipeline or change stored profiles. Profile previews, cards and
agent lists use the same marks. Tablet enlargement uses the existing focus-managed
dialog. Asset provenance is recorded in `renderer/assets/runtime-logos/README.md`.

## Native session usage (Goal 24, implementation in progress)

`main/usage/normalize` normalizes inclusive input/cache/reasoning semantics;
`UsageJournal` stores only
numeric facts and attribution IDs. The append journal serializes writes and
fsync asynchronously, retains cumulative baselines and native-event digests,
and detects conflicting replay, torn writes and changed/missing initialized files.
Limits are 32 MiB, 16 KiB per event, 50,000 facts and 4,096 sessions; reaching a
bound reports incomplete collection and preserves the file.

`NativeUsageService` is connected to new protected native Windows interactive
Codex/Claude/Grok starts in `PtyManager`. The private lazy loopback OTLP/JSON
receiver requires a per-launch header supplied only through the process env,
rejects browser origins, and bounds request size, connections and batches.
Codex's telemetry identifies one fresh CLI conversation; its exact, link-free
rollout provides cumulative counters. Pre-existing/forked conversations are
refused rather than imported as new usage. Claude receives a generated session
ID; matching API events include auxiliary models. Grok receives a generated ID
and is read through its exact `turn_completed` file. Provider config files and
personal login state are not modified. Transcript readers bound every read and
discard bodies after projecting known numeric fields; no transcript is copied.

The existing `terminal:usage` / authorized mobile terminal query returns a
`SessionConsumption` DTO from `shared/remote.ts`, scoped to the selected PTY.
It exposes numbers, field coverage, safe model labels and distinctly typed costs,
never native session IDs, provider paths, collector tokens or raw facts.
Remote model labels and notices pass `redactForWire`; existing selection/device
revalidation still runs after awaited reads. No invoke channel, scope or generic
remote command allowlist is widened. The shared terminal view refreshes only
while opened. Electron waits for numeric-journal shutdown after stopping PTYs.
Forced stops, nonzero process exits and host shutdown preserve known totals but
mark coverage incomplete because the final provider usage may not have arrived.

`SpeechUsageService` shares the same journal. Dictation and fixed-text voice tests
durably record a pending numeric attempt before the paid request. Dictation uses
validated WAV duration; TTS uses the submitted character count. `DictationJobs`
captures main-resolved terminal/project/profile attribution at preparation,
including remote control/resource checks. Outcomes append separately and never
add the duration twice: complete, unconfirmed or not-sent. A crash or finalization
failure keeps pending usage; network uncertainty is never free usage. An unavailable
journal prevents a new paid dispatch, while failure to save an outcome does not
discard an already received transcript. Audio/text/key/request bodies are absent
from the journal. The selected terminal's DTO exposes separate speech units by
outcome; these never increase LLM-token totals or CLI-cost sums. Voice tests without
a terminal retain project/profile or global attribution in main. Per-request
credits and USD remain unknown. Read-only ElevenLabs account analytics were
probed separately and are not yet an integrated account view or exact request bill.

This first path does not yet provide project/month totals,
budgets or complete resume/fork/subagent coverage. WSL/custom/managed terminals
are not covered by this collector. First integrated real-provider probes are
documented in `USAGE_SOURCE_RESULTS.md`; Codex additionally emits an unmatched
conversation event and remains explicitly incomplete. Its extra source identity
is unresolved. The new full verification is pending.

## Interactive terminal latency boundary

Native project terminal query/input/attachment revalidate the recorded process
scope through `ProjectWorkspaceService.resolveTerminal`. This checks directory
and Git-pointer identities plus ordinary `.git`, `commondir`, `gitdir` backlink
and HEAD topology on every access, with bounded, link-free metadata reads.
It does not reinterpret a running PTY's directory using subsequent Git config
changes. Uncommon layouts and HEAD symbolic-ref chains fall back to the full
Git resolver. No TTL authorization cache. `terminalValidation` is main-only and
never accepted from a device payload. Project opening, new CLI launch and all
workspace file/Git operations continue through the full Git resolver. Existing
agent-bound worktrees and WSL homes keep their separate validation paths.

The full resolver runs its three independent read-only Git probes concurrently,
then checks recorded identities. A terminal display request revalidates after
awaited display/usage reads, before returning output. Revocation, managed leases,
device resources, control ownership and input idempotency still apply.

`MobileTerminalQuery.knownDisplayRevision` is an optional 64-character digest
with a selected terminal. The response digest covers the opaque terminal ID,
safe ANSI-frame revision and safe scrollback. Matching replies carry
`displayUnchanged: true` and omit both bodies; current status/control metadata
is always returned. The browser retains bodies only for the same terminal and
matching revision. Polling stays serial with stale-response protection, using
16 ms waits briefly while typing, then 40/100 ms for changing/idle output.
Hidden pages slow down; disconnected views stop. Equal-size PTY resize calls
are suppressed centrally, including desktop/mobile handoff. The bounded input
queue coalesces for 8 ms and keeps ordered single-flight delivery. No speculative
terminal characters are rendered; the composer is local text.

Explicit mobile terminal form submission can overlap a resize/lease heartbeat
before React disables its button. It waits at most five seconds for local
backpressure, rechecks session/lease/connectivity before dispatch and never
retries a failed or unacknowledged transmission. Its acknowledgement clears
only the submitted draft version. Special-key buttons use `TerminalInputQueue`
so a heartbeat cannot silently discard the click. The native `--input-race-only`
driver holds a heartbeat to exercise this interleaving and disconnect recovery.
Lifecycle commands reserve their turn before waiting up to five seconds for an
existing input request. The reservation prevents later heartbeats from overtaking
the action; duplicate clicks are ignored. A changed connection, selection or active
workspace cancels an unsent action. A dispatched command retains its durable
idempotency receipt and is never automatically replayed. Profile launch follows
the same pre-dispatch wait before its query/open transaction. The same native
driver covers queued release, duplicate taps, disconnect cancellation and deliberate
takeover/release afterwards.

## Managed Work navigation

`shared/appViews.ts` owns navigation identities and order. Desktop `WorkView`
uses `useRuns`/`OrchestrationView` and the existing catalog, never main snapshots.
The existing `RunReportPanel` and `NewRunModal` supply report and run creation;
`SingleTaskModal` invokes the existing validated `runTask:submit` contract.
Retries retain an immutable payload and command ID. No new IPC or remote
permission is introduced. Mobile retains its host-backed Work implementation.
The normal desktop agent settings embed the same `DesktopAgentBehavior` and
`TargetSpeechSettings` as the profile card; profile storage and launch contracts
are unchanged. New Run takes focus, traps Tab and restores its opener on close.

## Speech tests, project membership and compact terminal status

Desktop speech uses `speech:voices`, `speech:select` and `speech:test`; all are
desktop-only IPC. Network calls are classified `host`, selection is `mutate`.
`SpeechService` obtains the scoped ElevenLabs credential in main, uses a fixed
HTTPS voice catalog with redirects refused. Synthesis uses the fixed
`wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input` endpoint and explicit
`eleven_v3`, German, MP3 output. The first frame registers the voice and supplies
the credential; `inputs` carries the reviewed utterance, followed by `close_socket`.
Only `is_final` completes the bounded 2-MiB/30-second stream. A turn-end marker,
close, error or timeout cannot return partial audio or retry a paid request.
Abort and repeated authorization checks close the provider socket. Frames and
base64 are validated; errors contain no upstream payloads. Received chunks are
assembled for existing owner-bound playback rather than streamed over the host API.
The provider-only pronunciation pass replaces the whole word Adi with quoted
IPA `/ˈadi/`; previews retain Adi. Usage records `eleven_v3` and provider-text
characters; historical v2 records remain valid. Only validated voice metadata
and MP3 base64 reach the renderer; provider error bodies and keys never do.
Test text/model are fixed in main.
One generation may run at a time. `settings.speechVoiceId` stores only the voice
identifier; older profiles suggest an available female voice. Renderer CSP
allows `media-src data:` for this playback, with sandbox/context isolation
unchanged. Speech playback does not request microphone access; the separate
dictation contract below owns microphone recording and transcription.

`SpeechPreferences` resolves optional agent → project → global voice IDs, then
the available female default. Missing saved voices remain visible rather than
silently changing. Desktop target preferences use desktop-only
`speech:preferences` (host/read) and `speech:configure` (mutate).
Dedicated signed POST `/api/v1/speech/query` and `/api/v1/speech/command` routes
delegate only to `AdeApplicationService`. They require the explicit
`speech:control` grant; resource selection is rechecked after asynchronous work.
Selected-resource devices cannot change global preferences. The generic remote
IPC allowlist is unchanged. Commands use payload-bound idempotency and audit.
Test receipts retain only a random ID; audio is owner-bound, limited to eight
in-memory entries and expires after ten minutes. Retry cannot generate again
after expiry or restart. Mobile stores pending command keys per device/target
and offers explicit recovery after connection loss; no audio or provider key
is stored in browser drafts or durable command receipts. Mobile CSP permits
only data media for the returned bounded MP3.

Terminal queries have a separate bounded 1,800/minute request budget, so normal
PTY polling does not consume the general 600/minute command/read budget.
Pairing/session POST limits remain 30/minute; proof checks remain mandatory.
This prevents budget interference, not a demonstrated input-latency improvement.

Project resolution still revalidates its workspace, filesystem and Git identity
after asynchronous probes. Concurrent voice/membership preference changes alone
do not invalidate that identity; all other repository record changes do.

`Repository.inMyProjects` is optional for migration: absent means included.
False is a presentation membership flag, not deletion or revocation. Main and
mobile overview project cards/shortcuts filter it; workspaces, active sessions,
run history and device resource grants retain their identities. A discovered
checkout opened without membership is registered with false. Explicit native
folder import includes/reactivates membership. The shared project directory
offers All/My filters and explicit inclusion/removal, including unreachable
registered entries. Fresh discovery/Git validation is required to adopt a new
checkout; membership changes to an existing record need no filesystem writes.
The initial directory filter is My Projects. An explicit All/My choice is saved
as a bounded enum under `ade:project-directory-filter` in the local browser profile;
invalid or unavailable storage defaults to My and never prevents filtering.
Authorized terminal summaries carry a redacted `projectName` from the resolved
workspace, so the mobile prompt editor identifies profile-free projects too.

Desktop `project:membership` stays desktop-only `mutate`. The explicit host
route `POST /api/v1/projects/membership` delegates only to
`AdeApplicationService.projectMembership`, requiring device proof,
`workspace:read`, `catalog:write`, full resource selection and a durable
payload-bound idempotency receipt/audit. The DTO accepts only an opaque
directory entry id and boolean. No generic remote IPC allowlist is widened.
The tablet saves its pending receipt before submission and offers explicit retry.

Mobile terminal status is portaled into its owning dialog header; other terminal
surfaces render it inline. Session controls have a device-local disclosure
preference, with controls always available before any session is selected.
Usage is a compact disclosure with keyboard/Escape behavior and bounded content.
Provider credentials are detected only for the chosen CLI. Native Codex account
quotas can be shown even when an API key was supplied, explicitly as local
account data, not as proof of the existing TUI's billing/authentication mode.
Account-aware usage collectors remain planned. Implemented dictation and
latency contracts have their own sections in this document; remaining provider
and device acceptance is tracked in [the expansion plan](VOICE_USAGE_TERMINAL_PLAN.md).

## Desktop project registration and mobile shell layout

The desktop Projects view offers native folder selection plus the existing
`repository:import` boundary. Registration outside the configured project root
reuses catalog discovery; no remote import channel or new device grant is added.
Mobile terminal panel widths are local appearance preferences, bounded to
14–32 percent with touch capture and keyboard separators. They never resize a
host terminal directly; its existing terminal viewport measurement applies.
Public GET entry documents (`/`, `/index.html`) allow external top-level
navigation (`Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document`). Every API
and subresource retains origin checks; host/Funnel checks precede the exception.
The shell worker reissues public navigations from its own origin without
credentials and uses cached public assets after HTTP failure. No API caching.
[Behavior and evidence](TABLET_POLISH_RESULTS.md).

## Mobile workspace commit history

The existing read-only workspace query supports `commit` (full SHA) and
`commit-file` (full SHA plus safe relative path). It stays behind
`AdeApplicationService.queryWorkspace`, signed-device/resource authorization and
`workspace:read`; no new invoke or remote mutation channel. `RemoteCommitDetails`
reads immutable, HEAD-reachable objects, compares merges to first parent and
root commits to the empty tree, filters protected/link paths, and redacts all
text sent to the wire. Metadata and per-file patches are separate bounded reads;
DTOs live in `src/shared/remote.ts`. [Full contract and evidence](MOBILE_COMMIT_DETAILS.md).

## Desktop navigation ordering

The rail exposes an explicit ordering mode alongside existing drag/drop. Root
rows (loose categories or whole navigation groups), group members and category
agents move using focusable up/down buttons. `shiftNavigationItem` preserves
membership and moves whole root groups, even when their persisted members were
interleaved. The existing full-permutation `category:reorder` and indexed
`agent:move` IPC contracts persist order; no new channel or schema is introduced.
The renderer serializes its moves, announces saving/errors and reloads the
catalog after a mutation. Ordering is unavailable while search filters rows.
Escape closes ordering with focus restored to its toggle. See
[validation and operator state](RAIL_ORDERING_RESULTS.md).

## Completed run deletion from mobile

The dedicated `POST /api/v1/runs/:id/delete` route accepts no body and calls
`AdeApplicationService.deleteRun`. It requires an active signed device with
`runs:write`, full resource access and a required idempotency key. The existing
desktop `run:delete` channel stays desktop-only; the generic remote IPC allowlist
is unchanged. `RemoteCommandLedger` also accepts `runs:write` for this operation;
its durable receipt contains only the deleted ID and confirmation, survives the
run, rejects key reuse, and fails closed after interrupted or missing receipts.
`RunCoordinator.deleteRun(id, true)` checks terminal run status inside its
per-run serialization. Existing lease and external-publication guards remain.
Owned journal rows are removed together and `journalRetention.prunedSeq` advances;
project files and workspaces are preserved. Mobile keeps unconfirmed requests in
the existing device-bound recovery journal, removes confirmed runs from all views,
and restores focus to the active navigation tab when the opener disappears.
Evidence: 23 focused deletion checks and seven real Electron/mobile UI checks,
including lost response, reload, phone width, tablet landscape and focus recovery.

## Reviewed workspace integration

Desktop `integration:query`/`integration:command` are strict desktop-only
read/launch channels. Dedicated signed mobile `/api/v1/integration/query` and
`/command` routes call only `AdeApplicationService`; all queries require
`workspace:read` and complete resource access, commands additionally require
`repositories:write`, idempotency and durable audit, tests additionally require
`terminal:control`. No generic remote IPC privilege is added.
`IntegrationService` pins native source/target/workspace identity, snapshots only
selected changes through a separate index, prepares a three-way merge in a
registered independent worktree, stores bounded durable reports and binds fixed
recipe results to the reviewed file state. Explicit final approval rechecks
source, clean target, leases, PTYs and test proof before commit and fast-forward.
All wire text passes the error/wire redaction funnel. Test jobs fence Git
mutations and graceful restart; interrupted jobs lose proof on reload.
[Full contract and operator workflow](WORKSPACE_INTEGRATION.md).

## Single-level navigation groups

`Category.navigationGroup` is an optional 1–80 character display heading. Equal
names group categories at their first catalog position; category and agent IDs,
membership, Graph roles and repository defaults retain their existing semantics.
Desktop and mobile preserve collapse state locally and search through collapsed
parents. Portable workspace bundles retain the optional heading. The mobile
catalog includes each authorized agent's category ID and only permitted categories.
The dedicated administration operation `category-group` requires full resource
access, `catalog:write`, signed device proof, idempotency and audit. It never
widens the generic IPC remote command allowlist. Catalog updates use the existing
main-to-renderer catalog event through `rendererWindows`.
Delivery progress: [integration/navigation goals](INTEGRATION_NAVIGATION_GOALS.md).

## Mobile project discovery and interactive workspace assignment

`workspaceAssignments` maps each agent/repository pair to a validated native
`ProjectWorkspace` for mobile files and terminal navigation. Managed worktree
bindings and historical execution snapshots remain unchanged. Dedicated signed
assignment queries build read-only previews from host-discovered directories or
registered Git worktrees; confirmation revalidates identity, Git state, active
work and resource grants under the exclusive workspace gate. A bounded,
device-owned preview plus the durable command ledger separates inspection from
mutation and preserves at-most-once confirmation across lost replies.
No path-bearing payload or generic remote IPC capability is added.
Contracts and evidence: [Workspace assignment](WORKSPACE_ASSIGNMENT.md).

## Agent-free terminal workspace

The desktop independent launch dialog can also select a discovered project.
It resolves the opaque entry with `project:command/open`, displays the returned
branch and probes `session:options` for that workspace. Launch uses the existing
`projectWorkspaceId`/`expectedBranch` contract; only explicit profile mode adds a
`profileId`. Changing the selection discards stale probes and profile selection.
Quick project actions for Codex, Claude Code and shell share the same main-owned
launcher. Reuse requires matching workspace, branch, mode, Ollama model and
profile plus a live program (or live shell). Explicit additional sessions always
create a new PTY. Renderer-local active project selection survives view changes.

Desktop terminal controls operate on the mounted xterm instance: bounded
5,000-line scrollback search, selection copy, clipboard paste, history navigation
and a validated local font preference. Search uses the xterm search addon and
resynchronizes the Copy button with the actual selection after each search;
reselecting the same match can emit only the intermediate clear event in xterm.
Clipboard uses the existing desktop IPC. Input ownership still gates paste and
PTY writes; no new IPC channel, remote permission or provider option is added.
Behavior and validation: [Workspace terminals](WORKSPACE_TERMINALS_RESULTS.md).

`MobileTerminalSelection` adds `{ terminalHome: true }` only to the dedicated
terminal APIs and existing desktop session channels. Main resolves the native
host home with no-follow directory identity checks; the client supplies no path.
PTYs have `scopeSource: terminal-home` and no agent, repository or binding.
They share the existing interactive launch, replay, CLI lifecycle and remote
input-lease contracts. Home sessions require terminal control and an unrestricted
resource grant, rechecked before replay and around asynchronous work. Workspace
file APIs do not accept this scope. There is no generic remote allowlist widening.
Desktop groups these sessions independently; Mobile has a dedicated Terminals
view with the same sessions, CLI launcher and device-local display preferences.
Contract, UI and executable evidence: [Terminal workspace](TERMINAL_WORKSPACE.md).

## Guided desktop setup

The always-reachable Einrichtung dialog and the empty first-run card route to
projects without creating an agent/category. Four freely navigable steps compose
the existing project-defaults, native harness diagnostics, mobile pairing and
device-grant UI. All mutations keep their existing explicit controls and IPC
validation. There is no persisted cosmetic completion flag, automatic install,
CLI launch, pairing or grant. Diagnostics clear stale data during retry and
preserve unknown/failed authentication states. Authentication remains CLI-owned
in the selected project. Step changes focus the heading; close restores the
opener with the stable Einrichtung button as fallback, project navigation focuses
its tab. Native Windows acceptance: scripts/test-setup-electron.ts.

Device permission presets are draft-only additive sets from `src/shared/setup.ts`.
They preserve existing explicit grants; project work does not imply publishing or
host restart. Only the existing desktop save command changes the device vault.
Mobile Settings reads the paired device's signed `/api/v1/host` capabilities and
catalog project-default status. Missing rights use the same labels as desktop.
Offline, failed and legacy/unknown responses cannot prove current readiness;
CLI authentication is explicitly a separate native diagnostic.

`MobileHostState.build` is optional `MobileBuildInfo` (sourceId and builtAt only).
The existing AdeApplicationService host-state path supplies this read-only data;
no IPC channel or generic remote-command permission is added. Build injection
uses SHA-256 truncated to 20 lowercase hex characters over sorted source paths,
source bytes, package/lockfile and relevant build configuration. Main, desktop
and Mobile share this source/dependency identity; build timestamps may differ.
It is not a binary checksum, Git commit ID, API version or authentication proof.
Direct source execution and legacy hosts can omit it. Comparison requires valid
bounded descriptors on both sides; absence is unknown, not outdated. Mobile
shows mismatches without automatic reload and keeps cached data explicitly
unconfirmed when offline or when the host-state request fails. App builds must
finish from stable inputs before a host restart serves their frozen Mobile assets.
Tests: test-setup-state.ts and test-setup-electron.ts (real signed browser flow).

## Run file evidence and downloads

Native task PTYs capture file digests before spawn and after exit, before reporting
completion. `RunTask.fileTracking` holds both snapshots; `RunReportTask.files`
projects their delta. OrchestrationView omits snapshots. RunArchive and retention
carry/prune them with the task. Capture failure must not suppress task completion.
Missing/incomplete snapshots do not prove new/deleted files; legacy agent claims
remain explicitly reported, not observed. The interval may include parallel writes.

Bounds per snapshot: 1,000 files, 5,000 entries, depth 8, 64 MiB total and a
three-second work budget; 16 MiB per file. Existing workspace metadata/secret/link
guards and descriptor checks apply. Lists prioritize changes, at most 100 files;
aggregation visits at most 32 tasks with an eight-second between-task budget
(one bounded scan may finish after it). Omitted/unavailable results are explicit.
Original task/binding/repository identity remains mandatory. Deleted files retain
evidence without download. Downloads are current files, not an immutable archive;
`changedSinceRun` marks later modifications. File IDs bind scope, metadata and the
current digest when captured. Reads validate identity/digest again. Files outside
the digest budget keep metadata validation and an explicit limited listing.
Stale download IDs return `409 command_rejected` with a refresh instruction.
The dedicated download route includes useful 409/422 error details only after
`redactedWireMessage`; authorization/not-found failures retain the normal boundary.

Dedicated signed GET `/api/v1/runs/:runId/files` aggregates existing task file
routes; live `workspace:read` authorization goes through AdeApplicationService.
Project query `run-results` validates the independent workspace and returns the
last 20 repository runs with matching task IDs. This does not imply integration
into the selected branch. Desktop-only read IPC `run:files` and `run:fileRead`
share the service; the generic remote command allowlist is unchanged.

PNG/JPEG/WebP use authenticated blob previews and magic checks; other regular
formats download as attachments. Text/source/HTML/SVG is redacted text, never
active content; binary downloads preserve bytes. Blob URLs are released on scope,
identity, offline, close and unmount. Graph and project result views show change
labels, missing files, bounds, loading/errors and restore keyboard focus.

## Independent branch publication

`ProjectPublishService` shares the native Git gate and exact clean-checkout /
active-PTY / common-lease checks. Dedicated typed `publish-status`,
`publish-preview` and `publish-apply` project operations pass through
`AdeApplicationService`. Status is read-only (`workspace:read`); preview/apply
also require `projects:write` and the new explicit `projectGit:publish` grant.
The existing local Git grant cannot publish. Authorization is rechecked before
mutation and response; device results are durable idempotency receipts with the
observed branch/SHA/target/confirmation time, not a permanently current sync claim.
The generic remote IPC allowlist and shell IPC classification stay unchanged.

Previews bind owner, workspace revision, current HEAD, actual single push URL,
remote branch SHA and PR base SHA for five minutes. Push uses the exact reviewed
SHA and branch, explicit non-force refspec, no tags/submodules/hooks, and checks
the remote SHA afterwards. Divergence requires fetch/merge first. Actual target
display follows the resolved push destination; mismatching GitHub fetch/push or
URL-rewrite identities cannot create a PR under the wrong provider identity.

GitHub PRs require an already-pushed exact HEAD and a readable existing base.
`gh pr create` pins `--repo github.com/owner/repository`, `--head`, `--base`, title
and draft choice; the full body uses `--body-file -` and stdin. No automatic push,
fork, reviewers or PR merge. Provider reads validate same-repository head/base/SHA
and safe GitHub URLs. An existing matching PR is returned without another create.
Missing CLI/auth/provider, changed targets or uncertain results fail visibly;
explicit status reads find an existing PR after a lost response. Pending mobile
publication receipts survive reload and ordinary draft eviction. No auto retry
with a new key. Native gh commands have bounded output/time and redacted errors.

## Independent project Git workbench

`ProjectGitService` provides bounded status/diff and single-use, owner-bound,
five-minute previews for selective commit, fetch, fast-forward, merge, resolution,
continue and abort. The shared workspace gate fences launches/reads from mutation.
Resolve the exact native checkout and link-safe metadata; refuse active PTYs,
managed common-repository leases, agent bindings, detached HEAD and other ongoing
Git operations. Preview/apply compares HEAD, index, changed file contents, refs and
local configuration. Fixed argv disables hooks, external diff/text conversion,
submodule recursion and inherited Git environment overrides. No reset/stash or
implicit merge commit. Selective commit preserves other staged files. Fetch writes
only remote-tracking refs; pull uses a reviewed cached SHA and fast-forward only.

The read-only Git overview includes `recentCommits`: at most five commits reachable
from its pinned HEAD, newest first, with SHA, bounded/redacted subject and author,
and an ISO author date. Unborn branches return an empty list. The shared PC/tablet
Git panel exposes it in a keyboard-operable disclosure under the status; reads
remain available while a live shell blocks Git mutations. Refresh and successful
Git actions read the history again. No new IPC channel or permission is needed.

Typed `project:query` / `project:command` desktop dispatch and dedicated signed
project routes call this service through `AdeApplicationService`. Queries require
`workspace:read`; mutations require `projects:write` and `projectGit:write` again
at execution and response. Durable device receipts retain only workspace identity;
replay reads fresh Git state without repeating mutation. Generic remote IPC stays
unchanged. Git wire data and diffs are bounded/redacted and contain no host paths.
Desktop-only `project:fileRead` / `project:fileSave` use the same workbench path,
descriptor, size, secret and optimistic-version rules as signed mobile file I/O.
Mobile pending Git/file receipts survive reload; ordinary unsaved editor text is
page-local. Desktop pending requests are separated by workspace, held in memory.

Limits: 500 changed files, 200 refs, 8 MiB per changed file / 64 MiB inspection,
64 KiB diff and existing 24 KiB text editor limit. Unsupported files are visible
but unselectable. Native Windows fixtures establish support; no new WSL promise.

## Task activity, final answers and protected result files

Run inspection is a separate read-only application boundary. Signed paired devices
need the existing `workspace:read` grant. `GET /api/v1/runs/:run/activity` returns
bounded process observations; `/tasks/:task/activity` additionally returns full
`RunReport` result detail. No raw PTY, tool arguments, user prompt, host path or
terminal id is exposed. It cannot control a process. The generic remote command
allowlist is unchanged. Graph polls independently every two seconds while active;
older snapshots cannot replace a more recently confirmed run state.

Native standard task launches use Codex JSONL, Claude stream-json or Grok
streaming-json. Only structured assistant completion text is persisted as optional
`RunTask.output` (65,536 characters maximum, explicit truncation/source). It is
excluded from `RunTaskView` and summary/event projections, included in `RunReport`,
and travels with tasks through existing archive/retention. `recovered-cli` denotes
an explicitly recovered older response, never fabricated live output. Custom CLIs
have no raw-text fallback. Managed structured result contracts remain unchanged.

`GET /api/v1/runs/:run/tasks/:task/files[/:opaqueFileId]` goes through
`AdeApplicationService` and `RunInspectionService`. Resolve the original task's
agent/repository binding, exact workspace id/path, native backend and link-safe
workbench scope under the shared workspace gate. Recheck authorization and identity
before returning bytes. List at most 100 files, 1,500 entries, depth eight;
read at most 16 MiB/file with descriptor identity/size/mtime and raster signatures.
Secret/metadata paths, links and hardlinks are excluded. Raster preview supports PNG,
JPEG and WebP; regular bounded files can download. IDs bind task, workspace version, relative path
and file identity; changed/deleted files require relisting. Text is wire-redacted;
binary files remain byte-for-byte original. Responses are no-store attachments
with fixed MIME and nosniff. Authenticated browser fetch creates temporary blob
previews/downloads, revoked on close or identity change. The listing explicitly
distinguishes observed, reported and unknown provenance (see Run file evidence above). Missing or
rebound historical workspaces fail closed. No public file URLs or SVG/HTML preview.

## Independent project workspaces and discovery

`projectWorkspaces` is a main-owned config collection separate from agent/repo
bindings. Each record pins a native checkout directory, actual Git directory,
Git pointer identity and common metadata identity, plus its repository id. It
contains no agent, memory, role, default CLI, or branch override. The actual branch
is queried from Git and can also be unborn or detached. Old configs gain an empty
collection; malformed present values fail validation. Workspace-bundle replacement
must preserve the unrelated collection, which is not a new portable bundle item.

`ProjectWorkspaceService` discovers direct children of the locally configured
project root and merges matching catalog entries. It checks root/directory/link
identities before and after reads, refuses junction targets and excludes `.git`,
`.ade-worktrees`, and `node_modules`. The scan is bounded to 2,000 examined entries
and 500 returned projects; truncation and an unavailable root are explicit. No
discovery read initializes Git or changes config. DTOs in `shared/remote.ts`
contain opaque identities/names rather than absolute host paths.

An explicit open validates the exact checkout, actual/main worktree and common
Git metadata, then persists repository registration and the independent workspace
in one config save. It never creates an agent, worktree, branch, instruction file,
or CLI process. Existing worktrees keep their actual folder while their repository
retains the canonical main checkout. Repeated opens reuse the identity; replaced
directories or Git pointer drift fail closed. Fixed native Git queries are bounded
and ignore inherited Git location overrides. The workspace operation gate excludes
concurrent Git mutations.

Desktop `project:query` (read) and `project:command` (mutate) are desktop-only
IPC, with exact payload validation. The host exposes separate signed
`POST /api/v1/projects/query` and `/api/v1/projects/command` routes through
`AdeApplicationService`. Queries require `workspace:read`; open additionally
requires the new explicit `projects:write` desktop grant. Existing catalog/Git
grants do not confer it. Open uses the durable command ledger (`project:open`),
idempotency bound to device/channel/payload, audit and the restart admission gate.
Read authorization is checked after asynchronous work, and mutation authorization
immediately before persistence as well as before returning its receipt. Missing
ledger data with prior project audit history fails closed. The generic remote
IPC allowlist remains unchanged.

Desktop and mobile share the bounded/searchable directory presentation. Mobile
persists `project-opening` before sending and protects this recovery record from
TTL/ordinary eviction; reload never automatically resends a mutation. Explicit
retry uses the original key. `project-selected` restores the workspace by read.
Storage failure blocks a new command; discarding an opening leaves host files and
registered metadata intact. Dialog and page focus have explicit fallback targets.
The previous agent-worktree entry remains explicitly accessible. Independent
workspaces host their own branch controls and interactive sessions.

T3a: `shared/projectBranches.ts` defines bounded, exact branch-action shapes
(local/remote refs, new branch, opaque worktree selection). `ProjectBranchService`
binds single-use five-minute previews to an owner and a revision of refs, HEAD,
status, worktrees and pinned identities. Apply takes the exclusive workspace gate
and checks drift, running PTYs, agent-owned checkouts, managed common-repository
leases and incomplete Git operations again. Local switching refuses dirty or
ignored-file overwrites; it never stashes, resets or steals another worktree's
branch. An explicitly separate worktree starts at the selected committed SHA in
a generated directory under `.ade-worktrees/projects` beside the canonical repo.
It may coexist with an interactive source session, but not a managed lease or
unfinished Git operation. A partially created worktree survives failures and is
available for explicit adoption. Git uses fixed argv, disables hooks and external
protocol helpers, ignores inherited Git environment overrides and bounds output.
Inventory caps are 200 refs and 100 worktrees; remote refs are locally cached.
`ProjectWorkspaceService.registerCheckout` is a main-only helper for a caller
holding the workspace operation gate. It validates the exact Git identity against
the expected repository and rechecks authorization before adoption.

T3b exposes branch reads/previews through `project:query` and signed project query;
`branch-apply` uses `project:command` and the dedicated host command route. Mobile
requires `workspace:read`, `projects:write` and the new explicit `projectGit:write`
grant, rechecked after preview and before/after apply. A protected per-workspace
branch receipt survives reload; a lost response replays the same ledger entry.

Interactive selection is an exact XOR: agent/repository selection or the opaque
`projectWorkspaceId`. Project launches require `expectedBranch`; only explicit
`mode: agent` accepts and requires `profileId`. Main revalidates checkout, branch,
profile fingerprint, managed leases and current device grant around CLI discovery
and immediately before PTY creation. `SessionMeta` and bookends carry the project
owner, branch and optional launch-profile identity instead of inventing an agent
or binding. Project sessions skip agent-memory injection, preserve repository
instructions, and remain discoverable on desktop and in mobile Continue Work.

Desktop-only `project:create` is classified mutate with exact name-only payload.
It shares `RemoteWorkspaceService` project creation with existing signed admin
commands: configured parent, fixed Git initialization on main, no profile or CLI.
Git initialization uses the same stripped Git environment, disabled hooks and
bounded execution as branch actions. Creation refuses inherited Git location or
config overrides before creating a directory because the legacy identity importer
inherits its environment; import rechecks the parent and authorization before save.
Mobile records creation/open checkpoints
before each command and keeps older pending project starts recoverable without
repeating their old automatic CLI launch. The project parent setting no longer
selects an implicit Codex profile. Actual CLI choice happens in the opened project.

## Interactive foreground lifecycle

`SessionMeta.status` continues to describe the PTY process. Optional `program`
metadata describes only the original ADE-started interactive invocation:
`starting`, `running`, `exited` (with its own exit code), or `unknown`.
Main prepares a private temporary PowerShell/bash wrapper. Its per-launch random
OSC framing reports entry/return; `ProgramSignalReader` removes matching framing
before ring-buffer replay, screen interpretation, or renderer output. The parser
handles split frames, bounded incomplete candidates and duplicate signals. These
markers are observational and never grant permission or relax workspace locks.

New native Windows Codex/Claude/Grok invocations use `prepareProtectedProgram`:
PowerShell reads the local wrapper without `-NoExit`, with `-NoProfile`, and exits
with the CLI. This prevents a delayed structured prompt from reaching a surviving
command-reading shell. Custom, WSL, assistant and other legacy launches retain
their earlier shell lifecycle: PowerShell uses `-NoExit`; bash sources the wrapper
around a foreground subshell. CLI commands/credentials are not moved
into process argv. WSL receives a translated local script path; credential
environment still uses WSLENV. Cleanup removes the known script and empty
temporary directory without recursive deletion. Login and managed task transport
are unchanged. Missing entry after 15 seconds is unknown; PTY cancellation never
invents a child exit code. Later commands typed manually into the surviving shell
are outside this invocation's telemetry.

The registered-window event `pty:program` carries only session id and program
state. The renderer reconciles it with create/list races. Existing scoped remote
terminal queries/inventory include the same path-free program state; no new
invoke channel or remote command authorization is added. Launch actions reuse
only a matching starting/running program (or an explicitly requested shell).
Exit/reload/reopen evidence is recorded in [the active goal](PROJECT_WORKFLOW_GOALS.md).

## Dictation and explicit CLI prompts

Desktop and mobile share `PromptComposer`, `DictationRecorder` and an origin-local
bounded `PromptDraftStore` (16 drafts; 12,000 characters each). The target is bound
before recording; text stays editable until explicit insert/submit. Saving the
pending command locally precedes delivery. Lost replies never trigger automatic
resubmission. Accepted PTY writes are transport receipts, not model completion.

The desktop composer is a non-modal dock within `TerminalPane`: to the right
above 760 px of pane width, below at narrower widths. The terminal stays mounted,
refits through its existing ResizeObserver and remains interactive. Opening
focuses the draft; Tab may leave the dock, “Zum Terminal” focuses xterm, and
Escape inside the dock closes it. Closing restores the opener or a visible
terminal/tab fallback without stealing focus from a navigation action.

Desktop and tablet dictation stream through `LiveDictationRecorder` and a bundled
AudioWorklet (16 kHz mono PCM, 256 ms packets, hard 300-second sample cap).
`shared/liveDictation.ts` owns the live duration, worklet packet size, sequence
budget, 30-second first-audio window and 305-second recording deadline; the latter
starts on the first valid PCM packet and is never renewed by later packets.
The recorder prepares microphone permission and the local audio module before
opening a provider stream, then connects capture only after provider readiness.
Cancellation releases even microphone tracks returned after a delayed permission.
The recorder passes the sample cap into the worklet. These are ADE limits, independent of provider quotas. Batch compatibility
keeps its separate 60-second WAV/upload bound.
Main owns the ElevenLabs single-use token and WebSocket; renderer CSP and the
remote command allowlist are unchanged. `dictation:streamStart/streamChunk/streamFinish`
are desktop-only host operations; every chunk is target/owner checked, bounded
to 16,000 bytes and accepted only in sequence. `DictationJobs` exposes private
partial text through its existing query. Committed segments accumulate; partials
replace only the current segment. Main requests a commit every 20 seconds of PCM,
before ElevenLabs' documented automatic commit at approximately 36 seconds.
Stop commits the remaining audio and waits for all outstanding acknowledgements;
an already confirmed segment boundary needs no empty commit. The complete text,
including the current partial, remains bounded to 12,000 characters. `scribe_v2_realtime`
shares the transcription concurrency gate with batch `scribe_v2`. There is no
automatic reconnection or batch resubmission. Closing/cancelling releases the
microphone and aborts the stream; connection loss preserves the last received
preview with an explicit incomplete-text notice, including when the mobile host
connection reports offline. The tablet uses the same preview/finalization UI
inside its existing accessible modal with focus restoration.

Tablet `POST /api/v1/dictation/command` adds `stream-start`, `stream-chunk` and
`stream-finish` DTOs in `shared/remote.ts`. These call `AdeApplicationService`,
not desktop IPC. Start and finish use durable, channel-bound command receipts.
Chunks retain the ordinary 64 KiB HTTP limit and the stricter 16,000-byte PCM
limit, canonical base64 and even byte counts. Every request checks device
signature, dictation/terminal grants and the ticket's resource/control lease.
Chunk keys must equal `jobId:sequence`; job-local in-memory digest receipts
acknowledge identical duplicates without forwarding audio and reject changed
payloads, sequence gaps and uncertain sends. Receipts are bounded to 1,172 per
ticket, disappear with the ticket and cannot restart after host restart. Audio
packets do not consume the 500-entry durable administration ledger. Audit records
contain metadata only. Both partial and final text pass through wire redaction;
neither enters SSE, summaries or durable command receipts.
After a connection failure, the open mobile composer retains failed cancellation
tickets and retries cancellation before preparing another recording. Cancellation
acknowledges only after the live provider result settles and releases its slot.

Live speech usage is journalled before connecting, with unknown audio duration
until the stream settles. The optional numeric `speech-outcome.audioSeconds`
updates that same fact once; replay includes the measured PCM duration. Unfinished
stream quantities stay explicitly unknown in `SessionConsumption.speech.unknownAmounts`
and its desktop/mobile view. Tokens, credits and provider prices are not inferred.
The accounting measures transmitted PCM, not provider-billed connection time.

Main grants microphone access for 30 seconds only to the requesting trusted ADE
renderer window's audio-only main frame. Camera, subframes, dashboards and other
permissions remain denied. Mobile's HTTPS document permits `microphone=(self)`;
browser consent and the independent `dictation:transcribe` device grant are both
required. Existing devices and project-work presets do not gain that grant.

`DictationJobs` issues private, owner-bound tickets before recording (maximum 16;
five-minute preparation, ten-minute result lifetime). Live start renews the ticket
for the first-audio window and recording deadline plus 40 seconds for token/socket
setup and finalization, so preparation
time does not consume the recording lifetime. Canonical batch mono PCM/WAV at
16 kHz is checked from actual bytes: 0.1–60 seconds, at most 1,920,044 bytes.
Only main sends batch multipart audio to the fixed ElevenLabs Scribe-v2 endpoint.
One provider request runs at a time with a 60-second deadline; no automatic
provider retries. Raw audio is not persisted. Device revocation/target changes
abort or invalidate jobs; final transcripts are returned only by explicit detail
reads, never journal/view teasers, logs or command receipts.

Desktop channels `terminal:promptQuery`, `terminal:promptSend` and `dictation:*`
are classified in `ipcPolicy.ts`; `REMOTE_COMMAND_CHANNELS` is unchanged.
Dedicated host routes call only `AdeApplicationService`: `POST /api/v1/terminal/prompt`
uses the existing terminal lease/sequence discipline; `/api/v1/dictation/command`
prepares, queries, cancels or streams a ticket; `/api/v1/dictation/upload` retains
batch compatibility.
Mutations require device signatures, current scopes/resources, idempotency and
audit. Only the audio route accepts up to 2,561,084 JSON bytes (two concurrent
uploads); all ordinary JSON commands retain 64 KiB. The durable ledger holds
ticket/receipt data and hashes, never audio or transcribed text. Wire text is
additionally redacted. A lost/expired ticket cannot become a new paid request.

Prompt delivery requires a still-running protected invocation, valid workspace,
input ownership and parsed bracketed-paste mode with no pending output. Main
normalizes line breaks and writes one bracketed paste. Explicit submit waits
500 ms before its separate Enter because native Codex suppresses immediate
Enter during a paste burst. `ProtectedPromptWriter` serializes input per PTY
and rechecks authorization and the protected invocation before Enter; partial
or ambiguous delivery remains unconfirmed and is never repeated automatically.
Native Windows is the implemented protected launch path;
WSL/custom/assistant sessions explain that structured delivery is unavailable.
Those sessions retain their existing direct terminal and dashboard access.
CLI login/trust dialogs must be completed directly in the terminal first; paste
support alone does not identify a ready composer. Current evidence:
[dictation implementation results](DICTATION_IMPLEMENTATION_RESULTS.md).

## Mobile project entry

`Projects`/`ProjectWorkspace` reuse the existing application-service catalog,
workbench, administrative and terminal endpoints. Preparation is explicitly
triggered, checkpoints idempotency keys in protected device drafts, and reuses a
ready binding before considering a mutation. Project Open does not launch a CLI.
`SessionLaunchChoice` now includes fixed `claude` and `grok` modes; discovery and
launch revalidation remain main-owned. No IPC or remote command allowlist was
widened. Scope, profile selection and UI behavior: `PROJECT_ENTRY.md`.

Mobile's root viewport hook publishes keyboard geometry through a React context
alongside the existing visible-height/top CSS properties. `AgentWorkspace`
owns the temporary controls override; `RemoteTerminalPane` only changes layout,
preserving its mounted xterm, draft and session. ResizeObserver fits the existing
terminal through the unchanged signed resize/input path. No new wire contract
or permission is involved. Geometry and focus evidence: `TERMINAL_KEYBOARD_RESULTS.md`.

Mobile keyboard activation uses a completed click/tap on `TerminalScreen` or
the explicit keyboard button. `terminalKeyboard.ts` checks editable textarea
state, requests the optional browser VirtualKeyboard API and falls back to
refocusing when needed. It does not change viewport overlay policy, input leases
or host channels. Touch pointerdown no longer supplies the keyboard activation;
frame/resize effects only update the existing terminal. Follow-up evidence:
`TERMINAL_KEYBOARD_ACTIVATION_RESULTS.md`.

## Interactive assistant access and Overview

Terminal subscription observations use desktop `terminal:usage` (launch effect)
and the existing device-authorized terminal query with an explicit `usage: true`
and terminal ID. The main-owned session fixes provider/backend/API-key mode;
the remote service revalidates device resources and workspace after the probe.
Only native default Codex launches query the local account, with bounded stdio,
no model turn, a 12-second timeout and a shared 60-second observation cache.
Claude/Grok expose their provider CLI command with unknown numeric quota.
No host paths, credentials, raw server errors or account identity reach the DTO.
See [subscription contract and limits](WORKSPACE_IMPROVEMENTS.md).

`RemoteTerminalDisplay` maintains a headless screen for each interactive PTY.
Its normal buffer retains 1,000 scrollback lines; the existing redacted `screen`
projection remains bounded to the final 65,536 UTF-16 code units. Mobile history
uses this projection, never raw PTY bytes. Opening history freezes a local text
snapshot and scroll position while live frame polling continues. Reopening takes
a fresh snapshot. Alternate-screen repainting is not an archived conversation.
`RemoteTerminalService` returns a redacted `MobileTerminalFrame` through the
existing device-authorized application service. Raw terminal control sequences
are never forwarded. `mobileDashboard` projects fixed credential-free private
HTTPS links only; dashboard commands remain desktop-only. Catalog changes refresh
Overview; historical records retain identities and detached-context markers.
Successful catalog-mutating IPC handlers emit the existing `catalog:changed`
event through `rendererWindows`. The event contains only a revision; consumers
re-read their authorized projection. Failed mutations emit no success event.

Redacted terminal lines are laid out with the same headless xterm cell widths as
the client. The caret is mapped onto the complete redacted text, preserving the
prompt's input space, wrapped command text, wide/combining characters and the
visible part of a scrolled prompt. A marker is inserted only into already-safe
text in a temporary main-only projection, never into raw text before redaction.
Contextual credentials spanning hard newlines rebuild the safe viewport as well
as its caret. Untouched lines retain their styled cells. Projection caches use
the captured output version so output arriving during layout is not lost.
The mobile IME preview uses that projected caret; it remains unsubmitted until
xterm commits composition. After a dimension change the browser clears xterm's
reflowed local buffer before writing the authoritative frame. This removes a
retained base/viewport offset even with scrollback disabled, while preserving
keyboard modes and an active composition. Absolute host paths remain masked on
the wire; history stays in the separate transcript view.
The terminal footer exposes an end-session action even while the keyboard hides
the workspace controls. It shares the collapsed text-editor row without a
keyboard, and stays fixed beside the scrollable special-key row with one,
uses the existing ownership/online checks and confirmation, and restores focus to
its opener on cancellation or to a visible launcher/fallback after actual close.
Closing the containing workspace view continues to leave the PTY running.
Connection loss and failed display reads leave the last frame visible but pause
direct keys, special keys and submitted text. Reconnection must complete a fresh
display read before input resumes; delayed prompt submission also checks current
connection/display readiness after waiting for the input queue. A failed read
clears unsent queued keys. Empty resize/lease heartbeats and explicit session
close remain independent of display readiness. No unacknowledged input is replayed.
A recovery strip remains visible above the terminal with the software keyboard
open: explicit reconnect, display reload, or desktop-to-tablet input takeover.
Reconnection never implicitly takes ownership from the desktop or another device.
Successful explicit recovery restores terminal focus if the user has not moved it.
Display readiness blocks prompt delivery without unmounting the voice composer
or its editor. Local drafts remain editable and the existing connection-loss
handler can preserve a live dictation preview with its recovery notice.
The mobile project header exposes a keyboard-accessible Workspace-Info dialog
using only the existing safe workspace DTO. The trusted desktop alone can expand
the exact workspace root from its local config catalog, matched by workspace ID
(including linked worktrees, never substituted with the repository root).
This root is not presented as the shell's current directory; wire masking remains.
Mobile shell responses inject a fresh style-only CSP nonce. xterm's scoped
document override nonces its generated style elements; script policy stays
`script-src 'self'`, with no unsafe-inline/eval exception.

Tablet terminal media uses visible, already-redacted HTTP(S) link detection;
OSC links stay stripped. Touch and history links open a separate noopener tab;
loopback URLs require an explicitly reachable project address. Image input uses
the signed, leased `POST /api/v1/terminal/images` application-service endpoint
and opaque IDs in `MobileTerminalPrompt.imageIds`, never client paths. Main
normalizes bounded PNG input, stages it outside repositories in the selected
execution backend, and revalidates ownership/workspace/hash/link discipline
before a protected, serialized sequence of image pastes, text and delayed Enter.
The verified adapter is Codex. The durable command ledger retains fingerprints
and safe receipts, not image bodies. No generic remote IPC scope is widened.
See [limits, lifecycle and executable evidence](TERMINAL_MEDIA.md).
WSL home checks use `WslRootProbe`: a bounded, read-only worker per active distro
reopens root components for every validation. Identity results are never cached;
all existing pre/post-operation checks and grants remain in place. Its fixed
Python program receives paths via stdin, never shell argv, and terminates on
idle, failure or application shutdown. Keyboard packets coalesce for 16 ms;
visible display queries run singly with a 100 ms idle interval and input-triggered
refresh. `PC-Antwort` includes network plus host processing, not just network RTT.
Transport bounds, keyboard acknowledgement and launch semantics are specified in
`ASSISTANT_ACCESS.md`; measurements are in `ASSISTANT_ACCESS_RESULTS.md` and
`TERMINAL_LATENCY_RESULTS.md`.

## Runtime model catalogs

Ollama identities persist `ollamaMode: 'chat' | 'coding'` and
`ollamaHarness?: 'codex' | 'qwen-code'` across agent/template/bundle contracts.
Absent/chat preserves `ollama run`; coding defaults to Codex when the harness
field is absent. Codex uses `--oss --local-provider ollama --model`; Qwen Code
uses explicit OpenAI-compatible auth, `http://127.0.0.1:11434/v1`, the selected
model, and the public placeholder key `ollama`. No global authentication is
rewritten. Permission modes map to Qwen `default` / `auto-edit` / `yolo`; this
does not claim Codex's sandbox semantics for Qwen. Main rechecks the selected
CLI and model before spawning; no silent fallback to another harness.
`ollama-codex-jsonl-v1` and `ollama-qwen-stream-json-v1` remain distinct from
native Codex and ineligible for Goal 6. Qwen receives the task on stdin and the
schema by `--json-schema @file`; main validates the terminal success envelope
and result schema before writing the bounded result file. CLI token counters
override model-authored usage; Qwen prompt totals already include cached tokens,
and costs stay unknown. Live Qwen events use their own format identity.
Native Windows interactive coding uses protected program transport. Saved
behavior uses the Codex instruction transport or Qwen's append-system-prompt
argument with immutable external snapshots and tested PowerShell marshalling.
Qwen receives identity and enabled memory this way even without an edited
behavior profile, because it does not auto-read ADE's AGENTS.md injection;
ADE never creates a project-owned QWEN.md. This interactive Qwen snapshot
transport currently requires native Windows.
Ollama sessions remain runtime `ollama` and never enter the OpenAI subscription
collector. Interactive token collection is not implemented. Direct session
choice `ollama` remains chat; saved-profile choice preserves mode and harness
on PC/tablet. No remote command allowlist or host path exposure is added.
[Goal 31 and evidence](OLLAMA_HARNESS_GOALS.md), [earlier evidence](OLLAMA_RESULTS.md).

`harness:models` is a desktop-only audited launch channel with strict runtime/
backend inputs. `RuntimeModelService` runs bounded CLI metadata probes in that
backend's user home and returns validated model IDs and redacted display fields.
Codex uses its app-server model catalog, Grok its models command, Claude its
authenticated initialization catalog and Ollama its installed-model list. No
prompt or model inference is submitted. Stored credentials remain in the main
process/child environment; WSL uses `WSLENV`. The remote allowlist is unchanged.
`claudeModel` now accompanies profile/template/bundle model pins and every Claude
launch path. Full bounds and version-sensitive contracts: `RUNTIME_MODEL_SELECTION.md`.

## Tablet project start and continuation

`TABLET_PROJECT_START.md` defines the new project-start contract. Desktop-only
`projectDefaults:get` / `projectDefaults:save` store a canonical native parent,
its filesystem identity and an optional native Codex profile. Mobile sees only
setup availability and the agent id. Existing project administration creates
named child repositories under a configured parent, refusing links, replaced
roots and collisions. The wizard composes existing independently signed/audited,
idempotent provisioning and terminal commands with durable per-stage retry keys.

The read-only `GET /api/v1/terminal/sessions` adapter calls only
`AdeApplicationService.remoteSessionInventory`. It requires device-signature
proof plus `terminal:control`; the service validates each immutable session scope
and emits at most 32 opaque summaries without raw PTY ids, host paths, output or
lease secrets. This does not add any desktop IPC channel to the remote command
allowlist. Managed tasks and credential-login sessions remain excluded.

The tablet workspace uses a focus-managed full-screen dialog and Chrome visual
viewport measurements. Device-scoped browser records retain drafts, navigation
and pending command keys across reload. Output, files and profile drafts are not
persisted by this store. Disconnect or observed device revocation clears records;
storage failure blocks new command submission. A durable uncertain-input marker
blocks resending after reload until output has been explicitly checked.

## Projectless workspaces and session launch (Goals 20–21)

`MobileWorkspaceSelection.repositoryId` is a required string or explicit `null`.
Null selects the configured agent home (`homeWorkspaceDir`, `homeExecutionBackend`),
independently of the default repository; missing/empty ids do not select a scope.
No synthetic Git binding is persisted. Home overview/tree/file/search reads never
create a directory or invoke Git. Only an explicit terminal open may prepare the
configured home. Git diff requires a catalog project; remote repository tools
retain their native-only boundary. Desktop scope descriptions also preserve an
explicit plain-home session when its agent has a default project.

Home scope versions include directory device/inode identity plus agent, backend
and path. Replaced roots and changed configuration invalidate old file drafts
and remote terminal handles. Session and lease matching checks backend and actual
directory; absent binding ids must never equate unrelated homes. Native reads
retain verified-path discipline (not descriptor-anchored ancestor race protection).
Windows→WSL homes use a fixed Python 3 helper via argv and JSON stdin: no-follow
descriptor traversal from `/`, regular single-link files, bounded actual reads,
bounded tree/search and revision-checked same-directory atomic replacement.
Writes share the workspace operation gate, refuse running sessions/managed leases,
and preserve the existing grant, conflict, redaction and UTF-8/BOM/newline contracts.
The WSL helper has no memory-file fallback and accepts no user program text.

`SessionLaunchChoice` and `SessionLaunchOptions` live in `shared/remote.ts` and are
shared by desktop and tablet. The fixed choices are shell, saved agent profile,
fresh Codex, fresh Hermes and Ollama with a validated model id. Main owns the
launch command. Fresh choices use default permissions and clear foreign command,
model and reasoning settings; the saved-profile choice retains all configured
settings, including wrappers. Saved agent records are unchanged. Effective runtime
controls credential injection and bookend telemetry. Shell starts do not inject
agent memory files. `SessionMeta.launchChoice` preserves the choice across renderer
reload and session restart; an app restart still ends its PTYs.

Desktop-only `session:options` and `session:launch` are exact-validated, audited
`launch` channels.
The desktop launch request may retain an existing `workspaceBindingId` from a
session being restarted, validated against its agent and repository. The remote
request never accepts a caller-owned binding. Remote options use the existing
signed terminal query with `options: true`; they require `terminal:control` and
are reauthorized after probing.
Remote open extends the existing durable command union with fixed modes and an
Ollama-only `model`; current device grants, CSRF, idempotency and audit remain
mandatory. `REMOTE_COMMAND_CHANNELS` is unchanged. Options use bounded fixed CLI
probes (4 seconds; at most 200 models). Windows probes PATH; POSIX/WSL probes use
constant commands in the login shell used for launch. Raw probe output/paths are
not exposed. Availability is installation/model discovery, not an authentication
or model-health promise. Main rechecks the chosen CLI/model before spawning;
the launcher never requests an install or pull. Existing Ollama configuration may
point at a different daemon. A model removed concurrently after that check is
subject to the external CLI's behavior.

The desktop `+` and Ctrl+Shift+T open a focus-trapped scope/launch dialog; shared
fields appear in the tablet terminal. Missing CLI/model, loading, failure and
retry states are explicit. Git and managed task submission require a project;
home files and interactive sessions do not. Validation and platform boundaries:
`SESSION_WORKSPACE_RESULTS.md`; usage: `REMOTE_TERMINAL_GUIDE.md`.

## Remote workspace tools (Goals 16–19)

`POST /api/v1/workspace/query` is a dedicated AdeApplicationService method,
not mirrored desktop IPC. The desktop-granted `workspace:read` capability,
device signature and browser session/CSRF are required. Existing devices do
not gain access to source files automatically. Query operations select an
agent/catalog repository and strictly relative path; read-only discovery never
creates a binding. RemoteWorkbenchService rechecks native root/common-Git
identity and link discipline around bounded reads. Metadata, common credential
files and hardlinks are excluded. Wire text passes through redactForWire;
redacted, binary, unsupported-encoding and oversized previews are not editable.
The mobile workspace opens independently of a terminal and separates index
diffs from working-file changes. Executable evidence for all four goals is in
REMOTE_WORKBENCH_RESULTS.md.

`POST /api/v1/workspace/save` additionally requires `workspace:write`, a durable
idempotency receipt, the opaque binding version and the original content hash.
RemoteWorkbenchService uses the shared WorkspaceOperationGate for atomic
same-directory replacement, rechecks revision/authorization/link discipline
before replacement and refuses active leases or live workspace sessions.
Only existing UTF-8 text files up to 24 KiB are editable; BOM and uniform
LF/CRLF are preserved. Conflicts return a revision without overwriting. This
uses native verified paths, not descriptor-anchored ancestor race protection.
Browser drafts and pending save keys survive dialog/project changes in bounded
memory, are cleared on identity changes and are not restored after page reload.

The dedicated `/api/v1/terminal/{query,command,input}` application methods
require `terminal:control`, a current desktop-granted device identity, signed
requests and browser session/CSRF. Commands use the durable ledger; input uses
a required key plus monotonically ordered sequence within an ephemeral live
lease. It reserves an input receipt synchronously before PTY write and marks
it accepted only after that write returns; duplicate and concurrent requests
cannot type twice. A failed write fences subsequent input until a new lease;
the client checks acceptance without automatically replaying uncertain input.
Old leases are invalid after host
restart, desktop reclaim, scope withdrawal or 30 seconds without a heartbeat.
The mobile close confirmation remains open and disabled while terminal transport
is busy; a synchronous lock guard also covers a heartbeat starting before the
button rerenders. Confirming cannot silently disappear without sending a command.
No input text is logged or persisted in receipts. Only one device owns input;
desktop `terminal:reclaim` is audited and `terminal:control` is read-only. Both
remain desktop IPC. `pty:write` and resize respect ownership; control events use
rendererWindows. Browser clients receive opaque terminal handles, never PTY ids.
Managed task and credential-login sessions are excluded. The configured agent
or shell runs under the host user's authority, not a workspace sandbox.

Terminal bytes stay in main: `@xterm/headless` interprets the bounded replay,
joins wrapped lines and sends only text through redactForWire. The mobile
interface offers text submission and explicit control keys with a polling
snapshot. It does not claim raw ANSI, mouse, colors or unrestricted transcript
fidelity. See REMOTE_TERMINAL_GUIDE.md for activation and reconnect behavior.

`POST /api/v1/profile/query` requires an active signed device with `read`;
`POST /api/v1/profile/update` additionally requires `profiles:write`, a durable
idempotency key and the original profile revision. Only agent name, role and
photo are accepted. Browser image selection is normalized to PNG, at most
256×256 and 32 KiB. Main validates PNG structure, CRCs, bounded inflation and
dimensions before Electron decoding, then normalizes again to remove metadata.
Photo filenames stay in main; queries return bounded PNG bytes. Local stored
images use the same link discipline. Updates refuse identities with active
managed leases and synchronize the durable ADE role block in AGENTS.md while
preserving operator content; linked, hardlinked or oversized instruction files
are refused. Profile updates notify registered desktop
windows through `catalog:changed`; no runtime, permission or general config
fields are exposed. The mobile CSP permits blob images for authenticated
avatars, while script and navigation rules remain unchanged.

Agent behavior is a separate bounded contract: `agent:behaviorGet/Set` on the
desktop and `POST /api/v1/profile/behavior/query` / `update` remotely. The
read-only preview composes identity guidance, explicit instructions and ordered
Markdown copies without writing AGENTS.md. A full-context SHA guards updates.
Remote writes require active device-signature proof, `profiles:write`, selected
resource authorization and the existing durable idempotency ledger. Only the
result revision is journaled; profile bodies are never receipt results. Wire
redaction prevents host paths from escaping and marks altered editable copies
read-only, avoiding accidental loss when round-tripping a redacted profile.

Saving behavior opts interactive agent-profile starts into an external immutable
snapshot. Native Windows Codex appends to developer instructions obtained by a
bounded read-only `config/read` probe with matching cwd/environment; unknown
configuration blocks the launch. Native Claude uses its additional prompt-file
option. Custom commands and other backends are explicitly rejected for this
transport. Plain CLI, shell and login launches do not inject new ADE guidance.
Previously injected repository blocks are not automatically removed.
PTY metadata carries only profile ID/name, snapshot SHA, timestamp and source
digests. Desktop/mobile can compare this captured revision with the saved
profile; editing a profile does not mutate a running session. The metadata
proves the selected launch transport, not model compliance or resumed-thread
prompt replacement. Captured text remains in the private main Session record
until that session is removed. Desktop `terminal:profileContext` and an explicit
remote terminal query with `profileContext: true` can read it; normal polling,
inventory and events never contain it. The remote path reuses the terminal's
current device/resource authorization and applies bounded wire redaction.
Native Windows end-to-end acceptance passed; evidence and platform limits are
recorded in `AGENT_PROFILE_RESULTS.md`.

Interactive profile snapshots preserve enabled MEMORY/USER content and the
existing maintenance guidance without injecting files into the project.
Bounded descriptor-checked reads reject links, hardlinks and malformed UTF-8;
disabled sources are not read. The full snapshot digest includes captured
memory; a separate profile digest is used for comparison with the saved profile.
Previewing/saving the behavior itself still performs no memory writes.

All new scopes are granted only in desktop Settings per device; pairing and
existing identities gain none automatically. New wire contracts live in
`shared/remote.ts` and use AdeApplicationService, signatures, browser CSRF,
current device authorization and audit. `REMOTE_COMMAND_CHANNELS` remains
limited to the four existing run/task commands. New runtime evidence is native
Windows only, with disposable Git/Electron fixtures and a configured test
command; it does not certify a model, WSL backend or physical tablet.

Status: v8, updated 2026-08-19 with the read-only Overview home
(`src/main/overview`, `src/renderer/overview`), implemented repository
scopes/reusable agents (`docs/REPOSITORY_SCOPES_PLAN.md`), the read-only
repository inspector (`docs/REPOSITORY_INSPECTOR_PLAN.md`), verified Draft-PR
publishing (`docs/VERIFIED_PUBLISHING_PLAN.md`) and planned remote
control/mobile companion (`docs/REMOTE_CONTROL_PLAN.md`). Terminal,
orchestration, repository-scope and publication implementation details
supersede v5 (`docs/reports/superset.md`, `docs/reports/hermes-memory.md`).
Product requirements live in `docs/SPEC.md`. When this doc and SPEC conflict,
SPEC wins.

## Decision: fresh app, Superset patterns copied selectively

We do NOT fork Superset (Elastic-2.0 monorepo with two parallel terminal
generations + cloud/auth woven through the entry path). We build a fresh
Electron app and port the load-bearing pieces:

- xterm setup + write-coalescer + attach/replay patterns
  (`reference/superset/apps/desktop/src/renderer/lib/terminal/*`)
- xterm theming (`…/stores/theme/utils/terminal-theme.ts`, `src/shared/themes/**`)
- git diff/status engine patterns (`…/src/lib/trpc/routers/changes/**`)
- worktree lifecycle (`…/routers/workspaces/utils/{worktree,git}.ts`)
- agent launch commands (`packages/shared/src/builtin-terminal-agents.ts`,
  `agent-command.ts`, renderer `agent-launch-command.ts`/`argv.ts`)
- pty-daemon's session model (ring buffer, detach/replay) — but NOT its
  POSIX-only process (fd-handoff/stty). We are Windows-first: node-pty with
  ConPTY lives in the Electron main process.

Hermes memory design is ported per `docs/reports/hermes-memory.md`.

## Decision: identity, repository and execution scope are separate

Category-owned `repoPath` and a fixed agent `workspaceDir` are compatibility
storage, not the active ownership model. Goal 5 introduced first-class
`Repository` records, optional agent defaults and one `WorkspaceBinding` per
agent/repository pair. A session, task or run snapshots an immutable execution
scope resolved from an explicit repository, the agent default or its plain home
workspace.

Categories remain presentation/organization. A portable agent can use multiple
repositories without sharing a worktree between them. A live PTY cannot change
scope; selecting a different repository creates a new session. A repo-backed
managed run chooses one repository and leases one exclusive binding per
participant, preserving Goal 4's common-Git-dir and integration guarantees.

`AgentTemplate` is immutable spawn configuration. Spawning creates a normal
agent with independent identity, memory and workspace bindings; templates and
sibling instances never share mutable state. Existing category paths and agent
workspaces migrate non-destructively. Full rules live in
`docs/REPOSITORY_SCOPES_PLAN.md`.

## Decision: execution backend is part of repository identity

Platform selection is explicit data, never path inference. Every repository and
workspace binding stores `native` or a validated `wsl:<distribution>` id; new
session/task/run scope snapshots copy that value immutably. Migration assigns
legacy records to `native` and makes a binding inherit its repository backend.

`main/execution/ExecutionBackendService.ts` is the sole process/path boundary.
Native calls retain the existing services. On a Windows host, WSL calls use
argv-only `wsl.exe --distribution <name> [--cd <linux-path>] --exec ...`, with
bounded output/time and no prompt, repository path or distribution interpolated
into a shell string. Backend environment fields (TERM, translated `ADE_*`
paths, stored harness/service keys) never enter that argv: `wslHostEnvironment`
places them in the Windows environment of the `wsl.exe` client and lists them
in `WSLENV` as `NAME/u`, so a credential is visible neither on the long-lived
relay's command line nor in ADE's argv log. Fields may not override `WSLENV`
itself, collide by case, or contain NUL; inherited `WSLENV` entries survive
unless ADE owns the name. `wslpath` is used only for Windows-owned control
files or an OS integration boundary. Linux identity remains case-sensitive.

Backend Git, workspace and filesystem facades guarantee that one binding uses
one platform's Git and filesystem for its entire lifetime. The WSL filesystem
helper receives JSON over stdin, enforces containment/no-symlink traversal and
uses `renameat2(RENAME_NOREPLACE)` for atomic no-clobber rename. A missing
distribution fails closed instead of falling back to Windows execution.

## Decision: mobile is a control adapter, not an execution plane

The desktop remains authoritative for agents, runtime credentials, PTYs, files,
Git worktrees, integration and persisted run state. The planned mobile PWA
submits a deliberately small set of commands and observes authoritative events;
it never executes an agent locally and is not a streamed Electron renderer.

Electron IPC and remote HTTP now share the first transport-neutral ADE
application boundary for sanitized run summaries. The bounded Goal-7 foundation
also projects health and a path-free repository/agent catalog for HTTP. The
remote host must not expose arbitrary IPC names,
`AdeConfig`, raw PTY methods or desktop filesystem methods. This keeps the
existing sender-validated IPC boundary intact while giving both clients the
same command semantics.

The personal alpha uses a loopback-only host behind Tailscale Serve. Tailscale
is the private ingress and outer identity boundary; ADE still owns per-device
pairing, endpoint authorization, sessions, audit and revocation. Public ingress,
accounts and hosted relays are deferred until after personal-alpha validation.

## Toolchain

- pnpm, TypeScript strict, Electron (latest stable), electron-vite, React 19.
- State: Zustand. Styling: plain CSS with design tokens (custom properties)
  taken from `mockup/index.html` — no Tailwind.
- Panels: `react-resizable-panels` (rail / center / right panel).
- Terminal: `@xterm/xterm` + `@xterm/addon-fit` (+ unicode11; webgl optional
  behind a capability check).
- Workflow verification: Playwright launches both the compiled Electron entry
  and the packaged executable against an isolated user-data directory.
- Windows distribution: electron-builder + assisted x64 NSIS. The node-pty
  Node-API prebuild is retained rather than rebuilt with a machine toolchain.
- Linux distribution: electron-builder unpacked x64, AppImage and Debian
  targets from a Linux-native dependency install. `node-pty` is compiled with
  Python 3, make and g++.
- Git: `simple-git`. Config persistence: hand-rolled atomic JSON store in
  `app.getPath('userData')`.
- Icons: text glyphs or lucide-react sparingly. No emojis anywhere (SPEC).
- Remote transport foundation: a disabled-by-default Node HTTP server fixed to
  `127.0.0.1`, with exact Bearer authorization and read-only versioned JSON for
  health, catalog and runs. Mutating commands, server-sent events, device
  pairing and the separate React/Vite PWA are implemented in Goal 8; measured
  deployment coverage is recorded in `goal8/MOBILE_CONNECT_RESULTS.md`.
  WebSocket is deferred because Goals 7-10 have no bidirectional terminal stream.

## Repo layout (this repo, root = the app)

```
package.json               # the app; one-command: pnpm i && pnpm dev
electron.vite.config.ts
src/
  main/                    # Electron main
    index.ts               # window, app lifecycle (small; no updater/cloud)
    ipc.ts                 # channel registration
    ipcValidation.ts       # exact runtime request validation for every invoke
    overview/              # path-free catalog/run/PTY projection for Overview
    security.ts            # renderer/navigation URL allowlists
    diagnostics/           # read-only CLI/version/auth checks
    notifications.ts       # background native exit/completion notifications
    platform.ts            # host path identity, null device, deterministic shell
    execution/             # native/WSL command, Git, workspace and filesystem boundary
    pty/PtyManager.ts      # node-pty sessions, ring buffers, launch profiles
    git/                   # status/diff/worktree (simple-git)
    config/store.ts        # atomic catalog/run/settings JSON + migration
    application/           # transport-neutral mobile-safe ADE boundary
    remote/                # loopback-only authenticated host API adapter
    orchestration/         # run/task/event service and legacy Graph migration
    publishing/            # verified branch + GitHub Draft-PR boundary
    repositories/          # catalog, bindings, scope resolution + read inspector
    memory/                # MemoryStore.ts port + managed-block injection
    photos.ts              # profile photo import/store (PNG/JPG, alpha kept)
  preload/index.ts         # contextBridge: typed invoke/on wrappers only
  renderer/
    App.tsx                # layout shell (Overview | rail+tabs+terminal | Graph; inspector side optional)
    theme/                 # tokens.css, themes.ts (incl. xterm ITheme), provider
    rail/                  # categories + agents, avatars, presence
    tabs/                  # session tab strip
    terminal/              # TerminalPane (xterm runtime, coalescer, attach)
    diagnostics/           # CLI/auth readiness modal
    keyboard/              # view/session shortcut routing
    overview/              # read-only home over catalog, bindings and runs
    rightpanel/            # catalog Overview + binding-aware Changes/Files
    onboarding/            # first-run + new category/agent modals
    graph/                 # run-scoped control-plane canvas and dispatch
    stores/                # Zustand catalog, session, run, and UI mirrors
  shared/
    types.ts               # catalog, session, run/task/event, runtime contracts
    remote.ts              # mobile-safe health/catalog/run DTOs
    ipc.ts                 # IPC channel names + payload types (contract)
    runtimes.ts            # launch profiles incl. permission-mode flags
docs/                      # SPEC, this file, reports/
mock/  mockup/             # references (kept)
reference/                 # cloned Superset/Hermes — git-ignored
```

Remaining planned additions for Goals 7-10 (names may be refined without
changing the boundaries):

```
src/
  main/
    application/           # add authorized commands/events shared by adapters
    remote/                # add pairing, sessions, audit and SSE
  mobile/                  # responsive PWA; no Electron or Node assumptions
```

## Current core types through the platform backend slice (shared/types.ts)

```ts
type PermissionMode = 'default' | 'accept-edits' | 'bypass';
type RuntimeId = 'claude' | 'codex' | 'opencode' | 'grok' | 'gemini'
               | 'ollama' | 'shell' | 'custom';
type ExecutionBackendId = 'native' | `wsl:${string}`;

interface Repository { id: string; name: string; rootPath: string;
                       commonGitDir: string;
                       executionBackend: ExecutionBackendId;
                       verified: boolean }
interface WorkspaceBinding { id: string; agentId: string; repositoryId: string;
                             workspaceDir: string; branch: string;
                             executionBackend: ExecutionBackendId;
                             status: 'ready' | 'legacy-unverified' | 'invalid' }
interface Category { id: string; name: string; photo?: string;
                     repoPath?: string;                          // compatibility
                     defaultRepositoryId?: string; agents: string[] }
interface Agent    { id: string; categoryId: string; name: string; role?: string;
                     photo?: string; runtime: RuntimeId;
                     permissionMode: PermissionMode;
                     codexModel?: string; codexReasoningEffort?: CodexReasoningEffort;
                     grokModel?: string; grokReasoningEffort?: GrokReasoningEffort;
                     defaultRepositoryId?: string;
                     workspaceDir: string;                       // compatibility alias
                     homeWorkspaceDir?: string;
                     memoryDir: string }
interface SessionMeta { id: string; agentId: string; title: string;
                        kind: 'interactive' | 'task';
                        status: 'running' | 'exited'; createdAt: number;
                        repositoryId?: string; workspaceBindingId?: string;
                        workspaceDir?: string;
                        executionBackend?: ExecutionBackendId;
                        scopeSource?: 'explicit' | 'agent-default' | 'plain-home' }
interface Run { id: string; name: string; goal: string; status: RunStatus;
                mode: 'manual' | 'managed'; phase: RunPhase;
                repositoryId?: string | null; budget: RunBudget }
interface RunParticipant { id: string; runId: string; agentId: string;
                           agentName: string; runtime: RuntimeId;
                           role: 'orchestrator' | 'lead' | 'worker';
                           teamId?: string; teamName?: string;
                           repositoryId?: string | null }
interface RunTask { id: string; runId: string; participantId: string;
                    title: string; prompt: string; phase: RunTaskPhase;
                    managed: boolean; dependsOn: string[];
                    status: RunTaskStatus; sessionId?: string;
                    repositoryId?: string | null; workspaceBindingId?: string;
                    workspaceDir?: string; preparedBaseSha?: string }
interface AgentTemplate { id: string; name: string; runtime: RuntimeId;
                          permissionMode: PermissionMode;
                          codexModel?: string;
                          codexReasoningEffort?: CodexReasoningEffort;
                          memorySeed: { memory: string; user: string } }
interface RunEvent { id: string; runId: string; type: RunEventType;
                     taskId?: string; participantId?: string; createdAt: number }
```

Goal 5 migration moves active repository ownership out of `Category.repoPath`
and `Agent.workspaceDir` while retaining both compatibility fields. The
platform migration also persists a backend on repositories/bindings. Repository,
binding and template records persist in the atomic config; sessions, tasks,
runs and leases retain resolved ids/paths/backend so later default changes or
migration cannot rewrite an execution's meaning.

The remote contract will not serialize these storage/domain objects directly.
It uses versioned, mobile-safe projections plus target records such as
`RemoteDevice`, `RemoteSession`, `RemoteAuditEvent` and
`RemoteIdempotencyEntry`. Device/session secrets are stored separately from the
catalog snapshot and are never returned after issuance.

## Config store durability (main/config/store.ts)

`userData/ade/config.json` is the single atomic store for the catalog, the
repository bindings, the run journal, structured results, approvals, leases,
the command log and the publication audit. It is therefore also the only
record whose loss is unrecoverable, so load and write are separate contracts.

Writes are atomic **and durable**: temp file in the same directory →
`fsyncSync` → `renameSync`. Without the fsync a hard power loss can publish a
renamed but truncated file, which the next launch would classify as malformed.

Loading never destroys an existing file:

| Situation | Behavior |
|---|---|
| File missing (`ENOENT`) | First run: seed `DEFAULT_CONFIG` and write it |
| File unreadable | Preserve, then seed — `reason: 'unreadable'` |
| Invalid JSON | Preserve, then seed — `reason: 'malformed'` |
| `normalizeConfig` throws | Preserve, then seed — `reason: 'incompatible'` |
| Preservation itself fails | Keep the original untouched; store turns read-only |

Preservation moves the file to `userData/ade/corrupt/config-<ISO>.json` and
never overwrites an earlier quarantine. Only after that succeeds may defaults
reach disk. When the move fails, `ConfigStore.readOnly` is true and every
`save()` throws before mutating the in-memory snapshot, so a caller that
ignores the error cannot observe a divergent catalog either.

The failure is a first-class product state, not just a log line: `config:health`
returns a `ConfigLoadFailure` whose `detail` has the config path replaced by
placeholders and whose `quarantinedTo` is config-directory-relative. The
renderer shows it as a banner above the shell — blocking and non-dismissible in
the read-only case — because an empty catalog is otherwise indistinguishable
from a fresh install. Focused coverage: `scripts/test-config-store.ts`;
user-visible coverage: the truncated-config restart at the end of the Electron
workflow.

## Launch profiles (shared/runtimes.ts)

Command per runtime × permission mode (adapted from Superset's
builtin-terminal-agents; every profile user-overridable via `customCommand`):

| runtime | default | accept-edits | bypass |
|---|---|---|---|
| claude | `claude` | `claude --permission-mode acceptEdits` | `claude --dangerously-skip-permissions` |
| codex | `codex` | `codex --sandbox workspace-write --ask-for-approval on-request` | `codex --dangerously-bypass-approvals-and-sandbox` |
| opencode | `opencode` | — | — |
| grok | `grok` | `grok --permission-mode acceptEdits` | `grok --always-approve` |
| gemini | `gemini` | `gemini --approval-mode=auto_edit` | `gemini --yolo` |
| ollama | `ollama run <model>` | — | — |
| shell | user's default shell (PowerShell on Windows) | — | — |

Interactive sessions spawn a shell in a main-resolved execution scope and type
the configured CLI command, so leaving the CLI returns to a usable shell. Task
sessions use a one-shot non-interactive command and exit with the CLI. Launch
callers pass a repository/binding selector; main snapshots the resolved working
directory before spawn. Renderer-provided absolute paths and later default
changes never retarget a process.

Native Codex identities additionally persist a validated model id and reasoning
effort. ADE defaults them to `gpt-5.6-sol` and `high`; the saved role policy can
raise the main orchestrator to `xhigh`. Interactive and managed launch commands
append `--model <id> -c model_reasoning_effort=<effort>`, and task provenance
records both values. Native Grok Build identities persist the same kind of pin
(`grok-4.6` / `high` by default, `xhigh` for orchestrators). Interactive launch
commands append `--model <id> --reasoning-effort <effort>` and translate ADE
permission modes onto `--permission-mode acceptEdits` or `--always-approve`.
Grok auth diagnostics treat `grok login` (via `grok models`) and a stored
`XAI_API_KEY` as first-class; Settings can open `grok login`. Managed Grok
tasks use the native `grok-json-v1` adapter: `--prompt-file` (never stdin),
`--output-format streaming-json`, the identity's permission/model/reasoning
pins, and `--no-auto-update`. ADE never passes `--worktree`. The CLI's
`--json-schema` flag accepts only inline JSON, which ADE will not interpolate
into a shell; the structured result is taken from streamed `text` / `end`
events (the older single JSON envelope remains readable) and usage/cost
overlay the model-authored fields, fail-closed when absent or partial. The
stream also drives the Graph activity feed (`grok-streaming-json`). Custom
commands deliberately opt out of the native adapter and its reproducibility
guarantees. Model ids accept only a conservative CLI-safe character set.

## PTY layer (main/pty/PtyManager.ts)

- `node-pty` spawn with ConPTY on Windows (`useConpty: true` default), shell
  fallback for POSIX.
- `main/platform.ts` centralizes host semantics: Windows path keys fold case,
  POSIX keys preserve it, null-device selection is explicit, and desktop
  POSIX launches choose an executable absolute `$SHELL` or a standard
  `/bin/*` fallback instead of assuming a terminal-inherited PATH.
- Per session: 256 KB ring buffer of raw output for replay on (re)attach —
  Superset pty-daemon pattern. Output events carry a sequence number so replay
  and the live stream meet without a race.
- Main owns sessions across renderer reloads. `pty:list` reconstructs renderer
  tabs; full app quit still stops all PTYs.
- Interactive sessions spawn immediately. One-shot task sessions acquire a
  FIFO lease with a global limit of four active task CLIs. The lease is held
  until exit/cancellation, not merely until process spawn.
- Task prompts are passed through `ADE_TASK_PROMPT` over stdin into supported
  non-interactive CLI forms (`claude -p`, `codex exec … -`, etc.), never typed
  after a fixed delay or expanded as a native PowerShell argument. This keeps
  quote-laden multiline prompts byte-stable under Windows PowerShell 5.1 and
  POSIX shells.
- WSL task sessions translate only the five managed control-plane path fields,
  write the prompt to a bounded Windows scratch file and let the Linux shell
  read that file through its translated `/mnt/...` path. Interactive and task
  PTYs execute with `wsl.exe --exec` in the immutable Linux worktree cwd;
  prompt scratch is removed on exit, launch failure or cancellation.
- Claude stream-json and Codex JSONL are parsed incrementally into the same
  bounded, sanitized activity model. Raw output retains its byte-exact replay;
  human-readable activity is also appended to task-local `ACTIVITY.jsonl` and
  survives session teardown.
- Tab close and identity deletion stop and remove owned PTYs. Naturally exited
  sessions keep replay for 30 minutes and are then reaped.
- Task sessions carry a `runTaskId`; normal shutdown journals cancellation and
  the next startup fails any work left active by an unclean exit.
- Exit reason lives on retained session metadata. Renderer hydration buffers
  exit/removal events while `pty:list` is in flight, so an event cannot be
  overwritten by an older list snapshot.
- Exited output remains attachable until close/reap. Interactive sessions may
  be restarted explicitly; run tasks are never silently re-run.

## Repository scope layer (implemented Goal 5)

- `RepositoryScopeService` owns repository import/deduplication, agent defaults,
  binding/worktree resolution and non-destructive legacy migration.
- Repository identity includes its execution backend. Native paths use the
  existing host services; WSL repositories persist canonical absolute Linux
  paths and all Git/worktree/file operations run in the selected distribution.
  WSL worktrees live in a sibling `.ade-worktrees` root rather than reusing a
  Windows worktree-base setting.
- Repository identity is validated from normalized real paths plus Git common
  directory. Importing a repo through another casing, separator or linked
  worktree cannot create a second root record.
- Resolution order is explicit repository → optional agent default → plain home
  workspace. The result is stored on the new session/task/run before launch.
- Each agent/repository pair has a distinct binding and worktree. A binding is
  immutable while a PTY is live and exclusively leased while a managed run
  owns it. Defaults affect future resolution only.
- A repo-backed run stores one repository scope and gives each participant its
  own binding under the same Git common directory. Multi-repository integration
  inside one run stays unsupported.
- Files/Changes receives the selected execution's binding id and resolves it in
  main. Its new scope header shows repo, source, branch/worktree and lease state;
  choosing another repo opens a new session instead of retargeting a process.
- Portable agent memory remains explicitly global. A binding-local overlay is
  reserved for repository-specific context, and repository content is never
  silently promoted into global memory.
- Templates store spawn defaults and a memory seed only. Spawned agents receive
  independent ids, memory directories and bindings.
- Migration deduplicates category `repoPath` entries, assigns corresponding
  agent defaults and adopts only provably matching existing worktrees. Ambiguous
  paths remain usable legacy plain workspaces and are reported for repair.
- Default changes, detach and catalog cleanup never move/delete a worktree,
  branch or user file implicitly. Active references block destructive cleanup.

## Overview home projection

- `overview:get` is a void invoke. Main projects `AdeConfig` plus
  `PtyManager.list()` into a path-free `OverviewSnapshot`. The renderer never
  receives host paths, prompts, mailbox bodies or inspector Git data.
- Live sessions count `status === 'running'` PTYs only. Open runs are
  `status === 'running'` or `phase === 'approval'`. Token and cost rollups
  increment `tasksWith*` / `tasksWithout*` separately; a null token field does
  not become zero in the hero number (`tokens` stays `null` until at least one
  task reported input or output).
- Agent order follows category membership, then leftover identities. Agent
  and project `lastActivityAt` are the max of binding `lastUsedAt`, run
  `updatedAt` and interactive session bookends.
- Work is the 20 newest closed interactive bookends plus runs. Open bookends
  and live PTYs are not listed there. Session rows carry `kind: 'session'`
  and an empty usage rollup.
- Interactive spawn/exit writes `AdeConfig.sessionBookends` (FIFO 100,
  path-free). Task PTYs do not. On PtyManager construct, open bookends whose
  session is gone close as `interrupted`.
- The view is event-driven (`orchestration:changed`, `pty:exit`,
  `pty:removed`). It does not poll `repository:overview`. Clicks set existing
  selection/run/session stores and switch to Terminals or Graph.

## Repository inspector read boundary

- The scope selector and the active session are intentionally different
  identities. `Overview` resolves the selected catalog repository;
  `Changes`/`Files` continue to resolve the immutable active session binding.
  Only a user-initiated selection moves the tab to Overview.
- `RepositoryInspectorService` accepts an exact catalog id, reloads the record
  and re-proves root/common-Git identity before every read. Renderer paths,
  remotes, refs and commands are never accepted.
- Local overview uses bounded argv-only Git calls for branch, upstream,
  ahead/behind, dirty counts and at most 12 commits. It never fetches. A commit
  detail additionally requires a full lowercase SHA that resolves as a commit;
  diff bytes and file counts are capped before reaching the renderer.
- Optional PR discovery parses one unambiguous GitHub origin and invokes `gh pr
  list` with an explicit `github.com/owner/repo`, timeout and output ceiling in
  the repository's persisted native/WSL backend. Provider failure is returned
  as a separate redacted state, so local history stays available.
- Main and renderer independently constrain PR URLs to the same HTTPS GitHub
  repository and numeric PR. The inspector's read endpoints expose no Git or
  PR mutations. Its **Git-Abgleich** action opens the separate explicit workflow
  below; ordinary refresh still never fetches.
- The three views are semantic roving tabs. One shared resizable detail pane
  stays mounted with the list, preserving scroll/data state; Escape closes a
  commit patch and restores focus to its trigger.

## Explicit repository Git updates

`RepositorySyncService` owns `repository:syncOverview`, `repository:fetch`,
`repository:syncPreview` and `repository:syncApply`. All four are desktop-only;
fetch/apply are audited mutations, overview/preview are reads. Strict DTOs in
`shared/gitSync.ts` contain ids, refs, SHAs and counts, never host paths or commands.
The complete contract is `REPOSITORY_SYNC_PLAN.md`.

The service compares main and existing agent worktrees with an enumerated local
or origin branch. Explicit fetch refreshes only remote-tracking branches and
records session-local freshness. A bounded, expiring, single-use preview pins
one target's from/to SHA; apply revalidates identity, branch, cleanliness, Git
operation markers, live PTYs and active leases before an exact-SHA fast-forward.
It never stashes, resets, creates merge commits, pushes or overwrites ignored files.
Failed target reads are unknown/blocked, not zero/clean.

`WorkspaceOperationGate` excludes these mutations from ADE's asynchronous scope
resolution/removal, PTY/login creation and managed-run start. Launch refusal
still reaches the task lifecycle sink. This is an in-process gate, not a lock
against external Git commands. Git's own locking and fast-forward guards apply.
New worktree creation and managed-run basis selection retain their existing
main-HEAD/orchestrator-HEAD contracts. No host API allowlist is widened.

## Run and task control plane (main/orchestration/)

- Categories and agents are the persistent catalog. A `RunParticipant`
  references a catalog agent and snapshots display/runtime fields so history
  remains readable if that agent is later removed.
- Orchestrator/lead/worker roles and team ids belong to a run. Creating a run
  never creates a category, agent, workspace, or worktree.
- Every task transition appends a normalized event. Cached task/run status is
  convenient for storage inspection, but renderer snapshots reconstruct status
  from the journal so stale cached values cannot change history.
- Pre-run Graph topology is imported once into `legacy-graph-run-v1`; legacy
  categories and agents remain untouched.
- The renderer receives the authoritative **view** through
  `orchestration:changed`; Graph transient state is limited to layout, selection,
  and pause controls. Real task status replaces the old completion timer.

### Renderer view, run report and history retention (Thema 3 / Thema 5)

- **Two projections of one journal.** `OrchestrationService.snapshot()` is the
  full-fidelity internal state for main (coordinator, publication, host API).
  `view()` (`OrchestrationView` in `src/shared/types.ts`) is what renderers
  get from `run:get` and `orchestration:changed`: identical runs, participants,
  events, results, approvals, leases, publications and usage, but tasks carry
  `promptDigest`/`promptChars` plus their parsed `provenance` instead of the
  prompt, artifacts carry `contentChars` instead of `content`, and mailbox
  messages carry `textChars` instead of `text`. Prompts, artifact bodies and
  message texts never reach a renderer window. `onChange` carries no payload;
  `ipc.ts` coalesces broadcasts to one `view()` per event-loop tick, so a save
  burst costs one projection, not one per save.
- **`run:report({runId})`** returns a `RunReport`: per task the complete
  `filesChanged`, every test with status and bounded output (16 KiB each,
  redacted), risks, commit SHA, participant name/role, timing and error; per
  run the failure (terminal detail plus the failed test commands of this run),
  integration range (`commitCount`, `fromSha`, `toSha`), verification
  attestation, approvals and publication. Text is bounded, not teased (4 KiB
  summaries/errors). Desktop-only `read` channel until the host adapter routes
  it through `redactForWire`.
- **`integration.applied`** journals `{commitCount, fromSha, toSha}`: the
  coordinator inspects the integrator worktree HEAD before and after
  `integrateCommits`, so a post-integration failure leaves a pointer to the
  composed, unverified state. Both SHAs are validated as Git object ids.
- **Approval notice.** `beginApprovalPhase` triggers a native notification
  (`runApprovalNotice`: run name, worker-task and validated-commit counts, no
  prompt or path) so the human gate that holds exclusive leases is visible
  outside the Graph. It follows the same foreground suppression as
  session-exit notices.
- **History retention (`applyRetention`).** Terminal runs beyond the newest
  `HISTORY_RETENTION.keepTerminalRuns` (40) that are also older than
  `keepTerminalDays` (30) are archived and pruned; if the serialized config
  would still exceed `maxConfigBytes` (4 MiB), the oldest remaining terminal
  runs go too. Never touched: open runs, runs with a publication audit, runs
  holding an active lease. Each `RunArchive` (`ade-run-archive` v1: run,
  participants, tasks, events, artifacts, results, approvals, leases,
  messages) is written by `RunArchiveStore` to
  `userData/ade/archive/runs/<runId>.json` (UUID-checked name, atomic
  temp+rename) **before** the single save that removes the records; without an
  archive port retention refuses to prune. `AdeConfig.journalRetention =
  {prunedSeq, archivedRuns, lastPrunedAt}` records the floor: `nextSeq()` and
  `journalCursor()` never fall below `prunedSeq`, so SSE and `run:events`
  cursors stay monotonic across pruning and `deleteRun`. Retention runs at
  startup and hourly (`ipc.ts`); the config itself is now serialized compact
  (`JSON.stringify(config)`), roughly halving the bytes stringified, hashed,
  written and fsynced on every save.
- **Main log.** `MainLogSink` (`src/main/logging/mainLog.ts`) tees
  `console.log/info/warn/error` into `userData/ade/logs/main.log` (2 MiB per
  file, 5 files, 8 KiB per line), one timestamped, levelled line per call,
  every line through the credential redactor with secret-named object fields
  replaced by `[credential]`. A sink that cannot write disables itself once
  instead of throwing into the caller. Installed first thing in `index.ts`.
- **Graph readability and keyboard path.** The run selector groups open and
  finished runs with their status; selecting a finished run older than the two
  newest pins it onto the canvas (`buildClusters(..., pinnedRunId)`) instead of
  leaving an empty canvas. The failure alert lists the failed test commands
  and opens the report. Cards, cluster bars and team bars are `role="button"`
  with `tabIndex`, `aria-pressed`/`aria-label`, Enter/Space to select, Enter
  on a selected card to activate, Escape to clear the selection or close the
  report; `.gteam-actions` also appears on `:focus-within`. The inspector
  renders `ResultDetails` (full summary, files, tests with expandable output,
  risks, SHA) instead of a 220-character teaser. `RunReportPanel` is a
  `role="dialog"` that takes focus on open, closes on Escape and returns focus
  to its opener or, when the opener unmounted, to the toolbar report button.

### Managed-run coordinator

- `RunCoordinator` owns the state machine: planning → working → approval →
  integrating → verifying → terminal. Only the coordinator creates managed
  tasks; direct Graph dispatch remains available for manual runs.
- A planner may assign each non-orchestrator participant at most once. ADE
  validates participant ids and an acyclic dependency graph, then starts only
  the worker tasks whose dependencies are complete and whose run concurrency
  slot is available. The global four-PTY queue remains an independent ceiling.
- A dependency transfers Git state, not just result/context data. All
  repo-backed leases share one Git common directory and base HEAD, so upstream
  ADE-authored commits are already reachable objects in every linked worktree
  and preparation only moves refs. Before a dependent work task launches, ADE
  prepares its leased worktree from the run base: the first contributing
  dependency is adopted verbatim (`reset --hard`, identical SHAs) and every
  further dependency replays only its owned delta in work-task creation order
  (the plan's assignment order), skipping already-reachable commits so diamond
  graphs never duplicate work. The resulting HEAD is persisted on the task as
  `preparedBaseSha` and journaled as a `workspace.prepared` event. A
  dependency without a commit contributes information only. Conflicting
  dependency deltas abort the replay, restore the run base and fail the run
  closed with the Git reason journaled before the dependent ever launches —
  ADE never merge-guesses a base.
- Repeatable run loop over the same worktrees. Integration cherry-picks worker
  deltas onto the orchestrator worktree's HEAD, so after a completed run the
  orchestrator carries the result while every worker worktree still sits on its
  own validated tip. `start()` therefore treats the orchestrator HEAD as the
  run base. Without an opt-in a divergent repo-backed worktree fails the start
  closed before any lease or task exists, and the error names each divergent
  worktree with its short SHA. With `Run.workspacePrepare = 'reset-to-base'` —
  set only from an explicit confirmation in the "Neuer Run" dialog and
  persisted on the run — the coordinator first pins each divergent tip under
  `refs/ade/archive/<runId>/<participantId>` (`update-ref` with a zero
  old-value, so an existing archive slot is never overwritten), then
  `reset --hard`s the clean, branch-attached worktree onto the base and
  journals one `workspace.rebased` event (`fromSha`, `toSha`, `archiveRef`).
  `WorkspacePort.resetToBase` refuses non-repo, dirty or detached worktrees and
  bases that share no history with the current HEAD; the coordinator refuses
  worktrees still leased by another active run. The reset runs after the clean
  check and before lease acquisition; leases and the manifest then record the
  aligned base. The orchestrator worktree is never reset by this path.
- A managed task result that arrives after its run already ended (a sibling
  failed, or the operator cancelled, while this process was still exiting) is
  recorded as `cancelled` with that reason. It never creates an ADE commit in
  a worktree the run no longer owns and never advances the phase machine; it
  only drains the run so `releaseIfDrained` can release every lease.
- `RunBudget.maxTaskMinutes` is the run's wall-clock limit per managed task
  (`null` = none; 1–1440). The coordinator arms one timer per running managed
  task and disarms it on any finish/launch-failure path. When the limit passes
  it journals `budget.exhausted` (`kind: 'task minutes'`) and fails the run
  closed with the task title and limit in the reason, which cancels the task
  through the normal PTY cancellation path. A hanging CLI therefore cannot hold
  one of the four global slots past the budget. The timer seam is injectable
  (`TaskTimerPort`) so the contract is tested without waiting.
- Patch ownership follows from inheritance: a work task's owned delta is
  `preparedBaseSha..tip` (run base when no preparation happened). A dependent
  worker may modify files its dependencies changed — those are ordinary
  descendant edits, which removes the Goal 6 F3/F4 re-author/union failure
  mode — while parallel siblings keep the transactional cherry-pick contract
  for overlapping paths. Validation and integration operate exclusively on
  owned deltas, so an inherited upstream range is never counted against the
  50/200 commit caps twice and never integrated twice.
- Every managed task must produce `StructuredTaskResult` version 1. The schema
  includes outcome, summary, worker assignments, changed files, real test
  command/status/output entries, commit SHA, risks and nullable usage. For
  repo-backed work, the runtime returns `commitSha=null`; ADE fills the SHA only
  after validating and committing the exact reported diff. Process exit 0
  without a valid result is a task failure.
- `runtimeAdapters.ts` is the adapter boundary. The native Codex adapter uses
  `codex exec --json --output-schema --output-last-message` and reads token
  usage from `turn.completed`; its JSONL also powers the live/persisted activity
  feed. The native Grok adapter (`grok-json-v1`) launches
  `grok --prompt-file --output-format streaming-json`, renders the Graph
  activity feed, and reads the structured result plus token/cost from `text` /
  `end` events. `file-mailbox-v1` injects
  result/schema/inbox/outbox paths for other non-shell runtimes and requires the
  result file before process exit.
- `MailboxService` journals each delivery and mirrors JSONL under
  `<memoryDir>/mailbox/<runId>/`. Task schema/result files live under
  `<memoryDir>/orchestration/<runId>/<taskId>/`; Codex receives that directory
  through `--add-dir`. Linked-worktree Git metadata remains outside normal
  adapter writable roots; an explicitly selected bypass process is trusted and
  is not constrained by that sandbox boundary.
- Every identity owns a durable, fenced `AGENTS.md` role contract below its
  memory directory. Identity create/update/template flows synchronize it while
  preserving user-authored content. Managed tasks copy a read-only, role-aware
  `AGENTS.md` into their task directory, explicitly instruct the runtime to read
  it, and journal its SHA-256/size in `TASK_CONTEXT.json`. They do not mutate
  repository instruction files after leasing, preserving tracked instructions
  and a clean worktree. Interactive/manual sessions retain normal memory
  injection plus the durable role contract.
- The Codex roster audit verifies the actual memory-directory `AGENTS.md`
  rather than the workspace-preferred pinned-file UI projection. During an
  inactive `--apply`, it may archive a stale provider `CLAUDE.md` only when the
  entire regular file consists of well-formed ADE memory/role fences. Symlinks,
  oversized/malformed files and any user text are preserved; each removal has
  a hash-verified recovery copy below the ADE profile.
- Before planning, every participant workspace is inspected and leased. Dirty
  git worktrees are rejected, duplicate or cross-run paths conflict, and all
  repo-backed participants must share one git common directory and base HEAD.
  Immediately after lease acquisition, ADE re-inspects repository identity,
  cleanliness, branch and HEAD before writing the run manifest or creating a
  task; any drift fails the run and releases its leases. This narrows but does
  not eliminate the TOCTOU window: external Git processes cannot be atomically
  excluded without an OS/Git lock and may still mutate a worktree after the
  stability check. Recovery fails interrupted managed work, rejects pending
  approvals and releases orphaned leases; the safe exception is an idle pending
  approval, which retains its leases and can be approved after restart.
- A successful worker reports the exact repository-relative paths it changed
  and must leave Git history untouched. ADE compares that set to tracked plus
  untracked Git changes, rejects omissions/additions/conflicts, stages with a
  NUL-delimited pathspec, disables repository hooks/signing, and creates the
  task commit itself. It then validates the clean worktree and complete linear
  range from the task's owned base (its prepared dependency base, or the
  leased run base) before requesting durable integration approval. Approval
  triggers one cherry-pick sequencer transaction in the orchestrator worktree,
  replaying owned deltas in work-task creation order so dependencies precede
  their dependents; any conflict aborts the full range. An integration-review
  task may add a similarly ADE-validated commit, followed by a read-only
  verification task.
- Concurrency and approval limits are always enforceable. Token/cost limits are
  accepted only for adapters advertising that telemetry, and missing values
  fail closed. Exact usage is enforced at task-completion boundaries because
  current CLI telemetry is final-turn data, not a live provider spend cap. ADE
  never derives USD from a guessed model price.

### Verified publication boundary

- A repository-backed final verification does not merely mark the run green.
  `RunCoordinator` stores the candidate HEAD on the verification task before
  launch, requires a clean identical HEAD after it exits, and commits that exact
  HEAD, verification-task id and time atomically with run completion and lease
  release. A clean new commit is drift, not success. Migration never fabricates
  this attestation for older runs.
- `publishing/PublicationService.ts` is a post-run Electron-main boundary. Its
  IPC accepts only a run id plus the exact previewed head SHA/generated branch;
  it accepts no path, remote, arbitrary ref, PR URL, Git command or merge
  instruction from the renderer. Preview is read-only. Mutation requires the
  Graph dialog's separate confirmation and repeats preflight immediately.
- Eligibility requires a completed managed run, approved integration, a
  successful final verification result with recorded tests, the released
  orchestrator lease, same repository/backend/common Git dir, clean worktree
  at the attested HEAD, a GitHub `origin`, and an unchanged remote-default HEAD
  equal to the leased base. A non-descendant/empty candidate fails closed.
- ADE generates a bounded `ade/run-*` ref. Git creates it with an empty-remote
  force-with-lease expectation and repository hooks disabled; a different
  existing ref is never overwritten.
  An exact pre-existing ref is retryable after a partial failure. `gh` creates
  only a Draft PR and ADE re-reads its open/draft/base/head/head-SHA/repository
  identity before recording success. There is no direct-default-branch push,
  branch update/delete, ready-for-review, merge or auto-merge operation.
- `origin` must have exactly one URL. An explicit `origin.pushurl` is accepted
  only when it resolves to the same GitHub repository; multiple or different
  push URLs fail closed. Git's local/
  global URL-rewrite configuration remains part of the trusted operator Git
  environment and is not a protection against a malicious bypass process.
- Git and `gh` execute in the repository's immutable native/WSL backend. A WSL
  repository therefore needs Git, `gh` and authentication inside that distro;
  Windows tools or credentials are not used as a fallback. Errors and PR-body
  evidence are bounded and credential/path-redacted. Requested/completed/
  failed state is journaled, and restart converts `publishing` to retryable
  failure rather than inferring success.
- Every `gh` repository selector includes the explicit `github.com` host, so an
  ambient `GH_HOST` cannot retarget it. Disabling push hooks is deliberate
  publisher isolation; hook/Git-LFS-dependent publication is a first-release
  limitation.
- ADE does not inject GitHub credentials or expose publication IPC to a worker
  task. However, a user-selected bypass agent is deliberately an unrestricted,
  trusted OS process and may independently reach ambient credentials or run
  Git commands. The publication gate secures ADE's own product workflow; it is
  not a sandbox against a malicious bypass agent. Stronger isolation requires
  a non-bypass runtime/container/credential boundary.
- This local trusted-desktop operation is deliberately absent from the planned
  Goal 7 remote contract. Repository CI/branch protection and human review are
  authoritative after the Draft PR exists.

### Transport-neutral application boundary (Goal 7)

- `AdeApplicationService` (`main/application`) is the transport-neutral
  facade. `ipc.ts` composes it once with the same `OrchestrationService`,
  `RunCoordinator` and `PtyManager` the Electron handlers use; the host API
  adapter (`main/remote/HostApiServer.ts`) calls the facade and never an
  orchestration service directly.
- Remote authorization is evaluated inside the facade, before the command
  port is called: the channel policy names the required scope, proof and
  idempotency rule, and the facade refuses a principal that does not meet all
  three. Domain invariants (leases, budgets, phase transitions, result
  validation, approval gates) remain inside orchestration services, so an
  adapter cannot bypass them.
- Every remote mutation carries a caller identity (principal), request id and
  idempotency key. The key is bound to one channel and payload digest through
  `commandId = remote:<key>:<sha256(channel+payload)>`, so the coordinator's
  existing command log returns the stored outcome for an exact retry, and a
  retry with another body or another command is rejected
  (`idempotency_key_reused`). Concurrent duplicates coalesce on one in-flight
  promise; a retry can never start a second run or a second planner launch.
- Journal records (`RunEvent`, `RunMessage`) carry the monotonic `seq` the
  orchestration service already assigns; `OrchestrationService.journalCursor()`
  exposes the top of the journal and `eventsSince()` pages strictly after a
  cursor. A `JournalChangeHub` notifies the desktop broadcast and the remote
  streams from one publication point.
- `RunCoordinator.submitSingleTask` is the first-class bounded single-task
  command (`runTask:submit`, `POST /api/v1/tasks`). It takes only an explicit
  `agentId`, `repositoryId`, `prompt` and optional `name`; the caller never
  names a run, participant, workspace binding or PTY.
  `OrchestrationService.createSingleTaskRun` persists the wrapping manual run,
  one worker participant (a one-member team named after the agent), the queued
  task and — when a `commandId` is present — the idempotency record in **one
  atomic save**, with journal `seq` in logical order (`run.created` with
  `kind: 'single-task'`, `participant.added`, `task.queued`). The recorded
  command result is the compact `{runId, taskId}` pair, resolved against the
  journal on replay, so a long prompt can never overflow the command-log bound.
  The coordinator then launches the one-shot task session through the same
  `TaskLauncher` managed tasks use (`PtyManager.create` with the task id, so
  agent/repository/binding checks and the global FIFO of four apply) **without
  awaiting the queue**: the reply carries the persisted run and task, and
  `task.started` / terminal transitions reach callers through the journal. A
  launcher rejection that the PTY layer could not report itself is journaled as
  `task.failed` by the coordinator, so a submission never leaves a task queued
  forever. Cancellation reuses `run:cancel`: for a manual run (single-task or
  desktop-created) the coordinator cancels the queued and running tasks and the
  run status follows from its tasks; a manual draft without work is rejected,
  and managed runs keep their phase-machine cancel. A single-task run cannot be
  started as a managed orchestration (direct tasks already exist).

## ADE host API (Goal 7 and Goal 8 device inventory) and mobile PWA (Goals 8-10)

The host is disabled by default and binds IPv4 loopback only. Desktop Settings
can enable the mobile controller, which discovers the native host's Tailscale
DNS name and configures `tailscale serve --bg --https=443 http://127.0.0.1:4317`.
`ADE_MOBILE_PORT` optionally selects another bounded loopback port. The opt-in
and ownership of the Serve route persist in the host-local device state. Setup
starts/validates the listener and public build before configuring ingress,
refuses conflicting HTTPS routes and Funnel, and never resets other Serve
configuration. A 15-second monitor stops the listener when the route becomes
unsafe/unavailable and restores it when the expected private route returns.
Serve's `Tailscale-Funnel-Request` marker is also rejected per request.

The earlier developer API mode remains separate: `ADE_HOST_API_ENABLED=1`
plus `ADE_HOST_API_TOKEN` and optional `ADE_HOST_API_PORT`. It refuses browser
Origins and requires bearer plus device proof. It cannot run concurrently with
the mobile controller. Browsers never receive that shared listener token.

Endpoints are allowlisted operations, not generic RPC. Implemented today:

- `GET /api/v1/health` - API version, readiness, bounded queue summary and
  whether commands are enabled on this host;
- `GET /api/v1/catalog` - sanitized repositories, agents and runtime readiness;
- `GET /api/v1/runs` - mobile-safe run projection (`RunSummary` incl. `seqCursor`);
- `GET /api/v1/events` - resumable server-sent events over the journal `seq`;
- `POST /api/v1/runs` - create a managed run from explicit `repositoryId`,
  `agentIds`, `name`, `goal` (desktop-only fields such as
  `resetWorktreeToBase` are refused, not ignored);
- `POST /api/v1/runs/{id}/start` and `/cancel` - run lifecycle (`start` is
  managed-only; `cancel` also ends a single-task run's work);
- `POST /api/v1/tasks` - submit one bounded task for an explicit `agentId` and
  `repositoryId` with a `prompt` (≤ 8000 characters, control-character free)
  and optional `name`. The reply is the wrapping run summary plus `taskId`;
  automatic prompt-derived task titles and run names are replaced with neutral
  labels in summaries; explicit independent names remain visible. There is
  no task listing and no per-task action path: progress arrives over
  `/events`, cancellation goes through the run. Plain-workspace (no
  repository) submission is deliberately not offered.

Still planned: Goal 9 approval resolution after step-up authentication and
evidence review. Category, agent and config mutation, interactive PTY methods
(write, resize, attach), filesystem reads, arbitrary IPC and deletion stay
absent. The API never returns absolute paths, prompts, custom command text,
environment values or credentials.

#### Authentication and authorization

Two layers, deliberately separate (`main/remote/authorization.ts`):

- The listener bearer token is an outer authentication gate. In the production
  composition it grants no data by itself: reads, SSE and commands all require
  an active identity from `RemoteDeviceStore`. The earlier bearer-only read
  mode remains available solely to isolated protocol fixtures.
- Every production request additionally requires a **device signature**: `X-ADE-Device`,
  `X-ADE-Timestamp` (Unix ms, ±5 minutes skew) and `X-ADE-Signature`
  (`v1=<hex HMAC-SHA256>` over `ADE-HTTP-V1\n<METHOD>\n<path>\n<timestamp>\n<Idempotency-Key>\n<sha256(body)>`)
  using the device secret. A valid signature yields a `device` principal with
  `read` and `runs:write`. Unknown device, wrong secret, altered path, body,
  key or timestamp all fail closed with distinct, path-free error codes.
- GET signs the exact request target including any `?cursor=...`, with an empty
  idempotency-key field and SHA-256 of the empty body. The signature headers
  must be supplied again on SSE reconnect. POST signing is unchanged.
- `ADE_HOST_API_COMMAND_DEVICE=<id>:<secret>` is now a **one-time migration**
  into the host-local store (secret 32-128 URL-safe chars, distinct from the
  listener token). Both credential variables are consumed before child launch.
  A persisted `bootstrapImported` marker prevents later environment changes or
  a stale credential from recreating a revoked identity. Startup without that
  variable uses persisted devices. A new empty profile has no authorized devices.
  The desktop single-use pairing flow below provisions new browser identities.

#### Browser pairing, sessions and mobile host (Goal 8.2–8.4)

Desktop-only `mobileAccess:status/setEnabled/pair/cancelPair` channels have exact
IPC schemas and policy classification; none are remote command channels.
Status distinguishes `listening` (loopback listener plus matching Serve route)
from `https: pending/verified/unreachable`. An abortable, bounded 20-second
native HTTPS GET verifies the certificate/hostname and public shell without
credentials or redirects. Setup and the connection monitor retry it; initial
Tailscale DNS/ACME provisioning can leave a configured route unconfirmed.
Pairing generates 256 bits of random one-use material, held as a hash in main
for five minutes. A new challenge, explicit cancellation, Settings close or
host restart invalidates it. The QR/manual URL carries it only in the fragment;
the PWA immediately removes that fragment from history. `/api/v1/pair` accepts
only challenge, deviceId, printable name and signing secret, consumes the
challenge before enrollment, and persists a separate encrypted device identity.
The browser creates the key, imports it as non-exportable WebCrypto HMAC and
persists only its `CryptoKey` plus id in IndexedDB before enrollment. A lost
pairing reply can recover by proving that key; no shared bearer is distributed.

For the exact configured `https://<host>.<tailnet>.ts.net` origin, reads, streams
and commands require a device signature **and** a host-only 30-minute session
cookie (`__Host-ade-session`, Secure, HttpOnly, SameSite=Strict, Path=/). Cookie
tokens are random; main holds hashes only, bounded to one session per device
and 100 total. Signed `GET /api/v1/session` retrieves CSRF/session metadata;
signed `POST /api/v1/session` authenticates/rotates it. Rotation, logout, expiry,
revocation and shutdown close its streams. No session survives host restart;
remembered device proof can authenticate again. `POST /api/v1/logout` also
requires session CSRF. Device keys remain revocable in desktop Settings.

Every browser POST requires the exact Origin; a supplied Origin on GET must
also match. Cross-site fetch metadata is refused. Commands additionally require
the session's CSRF header and the existing signed Idempotency-Key. No CORS
wildcards, IPC proxy, remote setup/configuration or additional command scope is
introduced. Admission is bounded to 600 routed browser API requests/minute,
including at most 30 pairing/session authentication attempts. Audit records
pairing/device changes and authentication before effects; payloads, QR material,
device names, signing keys, cookies and CSRF values are excluded.

`src/mobile` builds independently into `out/mobile` through `vite.mobile.config.ts`.
Main loads a bounded exact-path asset allowlist (8 MiB total, 2 MiB/file, at most
100 files, no links). Only the public shell is unauthenticated. Its CSP permits
only same-origin scripts/styles/requests/worker/manifest, plus blob images for
authenticated profile previews (Goal 19); API CSP remains
deny-all. The worker caches an explicit versioned shell list, never API requests,
prompts or results. File/profile drafts and fetched content stay in page memory;
task/terminal drafts and pending work keys use the bounded device store described
above. Commands are never queued for automatic offline execution; an uncertain
reply can be explicitly retried with its original key after reload. Revocation/logout clears pending
commands and private state; an identity generation fences late responses from
the previous device. Run cancellation preserves unrelated composer drafts and
returns keyboard focus to the updated run detail. Reload/background/network recovery
reads authoritative snapshots and resumes signed fetch-based SSE. A 45-second
heartbeat deadline detects silently stalled connections. Detailed reports,
remote approval, push and runtime configuration remain desktop-only. The narrow
Goal 19 name/role/photo API is the documented profile exception.

The mobile shell imports the same `renderer/theme/tokens.css`, pure Avatar and
runtime visual helpers as the desktop. It does not import renderer stores,
preload, the terminal UI or desktop application services. Its Overview, Work
and Graph views consume the health/catalog/run-summary contract; workspace
tools use the dedicated Goal 16–19 contracts described above.
`useMobileHost` owns one connection across all three views; selecting a view,
node or theme never remounts authentication/SSE. Only appearance and the active
view are persisted in localStorage. Drafts, filters, selection and run data
remain in memory; revocation/disconnect clears private state.

Overview reports queue activity as task slots, not terminal sessions. The
current summary DTO cannot establish token-reporting completeness or distinguish
unreported zero usage; zero is displayed as no report. Graph edges describe
participant/team membership and roles; dependency edges are not invented.
Tablet inspectors are complementary panels; phone inspectors and composers are
native modal dialogs with explicit keyboard focus cycling and opener/fallback
restoration. Starting a draft follows the domain contract: fresh task-free
drafts become managed on start, even though their stored pre-start mode is manual.

Mobile build assets are still loaded into main once. Building changed assets
does not disrupt an existing host or its device sessions, and does not update
that host's in-memory asset map. Activating a new build requires a normal host
restart and browser reload. Existing IndexedDB identities and the wire/session
protocol remain compatible; a paired browser can reauthenticate after restart.
See `goal8/MOBILE_DESKTOP_PARITY_PLAN.md` for continuity and UI acceptance goals.

`OrchestrationService.summarize()` replaces automatically derived prompt-prefix
run/task labels with `Single task`/`Task`, including existing persisted records.
Explicit independent labels remain visible. Prompts cannot escape through the
former 80-character title shortcut; source records are preserved unchanged.

With mobile access enabled, closing the desktop window hides it only after a
tray icon is available. The tray can reopen ADE or explicitly quit, which stops
listeners and PTYs. If the tray is unavailable, closing retains normal app exit
behavior. Login autostart, sleep prevention and pre-login execution are not
implemented. The host is the native UI process even when tasks use WSL.

#### Desktop device inventory and durable audit (Goal 8, step 1)

`main/remote/RemoteDeviceStore.ts` stores `userData/ade/remote/devices.json`
separately from `AdeConfig`, renderer snapshots, run archives and workspace
bundles. Device names (1-80 printable characters), creation/revocation times and
ids are desktop metadata; secrets are encrypted with Electron `safeStorage`.
Linux accepts the same OS-backed Secret Service/KWallet providers as harness
credentials, never `basic_text`. Device snapshots use same-directory exclusive
temporary files, fsync and atomic rename; POSIX additionally syncs the directory.
Reads are capped at 256 KiB and 100 records and reject links in path components.
Malformed, unreadable or undecryptable state is preserved and disables device
authorization rather than reseeding identities.

Settings → **Verbundene Geräte** lists active and revoked identities, saves names
and revokes access through three exact, desktop-only IPC channels. Revocation
persists a tombstone and removes encrypted key material before returning success.
It immediately destroys that device's active HTTP responses/SSE connections;
new commands and reads re-resolve the store and fail authorization. Already
accepted domain work is not rolled back or cancelled; its run remains locally
controllable. Rename preserves connections. The UI has loading/error/empty states,
keyboard form submission, wrapped narrow layouts and explicit focus recovery to
the name field after saving or the refresh button after revocation.

`userData/ade/remote/audit.jsonl` is a separate fsynced access journal with bounded
retention, independent of run history and diagnostic logs. A projected entry contains timestamp,
principal id/kind, request id, channel, target, outcome and optional redacted reason.
It excludes device names, secrets, signatures and request bodies. Device changes
record `requested` before the atomic state write and `executed` afterwards; remote
commands record admission before domain effects and a final result or denial.
A crash between these records leaves an unresolved request, never invented success.
Transport denials (including invalid bearer/proof/body) are recorded too; unverified
callers are marked anonymous, never attributed from an untrusted device header.
Successful signed reads record authentication. All text uses `redactForWire`.

Each audit segment has an 8 MiB cap. Before an append exceeds it, `RemoteAuditLog`
atomically saves the complete current segment as `audit.previous.jsonl`, then
atomically replaces current with its newest complete lines (up to 4 MiB) and a
checkpoint. The checkpoint permanently carries prior device/command-history
barriers, so retention cannot turn missing `devices.json` or command receipts
into a fresh profile. Both startup consumers validate current and previous;
an archive without current is unavailable. A crash during replacement leaves
either the old or new complete current segment. Durable storage is at most
16 MiB, plus bounded temporary writes. Older history is deliberately retired.
A torn/invalid/oversized segment, external current-size change, links/hardlinks,
or failed archive/append still disables authorization and closes connections.
Device secrets and command receipts are not pruned by audit retention.
`MobileAccessController` includes secure-store availability in readiness and
pairing checks; its monitor never restarts an unavailable store's listener.
HTTPS alone must not claim that pairing is ready.
This journal is deliberately independent of `RunArchive` and run retention.
General desktop IPC diagnostics still go to the rotating main log.

Desktop and Mobile browser builds separate React and xterm library chunks.
Desktop production assets use esbuild minification; main/preload remain unchanged.
Mobile loads `TerminalScreen` on first displayed terminal, with an accessible
loading state and an explicit page-reload action on module-load failure. Reload
reattaches to the existing PC session. Desktop loads QR generation on demand.
The Mobile worker still precaches all public chunks for offline availability;
lazy loading reduces initial parsing, not the complete precache download size.
`pnpm build` builds both surfaces; `pnpm start` uses `preview --skipBuild` so
starting cannot silently rebuild only Desktop. Build fingerprints include the
shared chunk configuration. [Operator instructions and evidence](MOBILE_PAIRING_RECOVERY.md).

#### Request discipline (fail closed)

Legacy requests: exact `Host` match against the bound loopback address, no
browser `Origin`, `Authorization: Bearer` with a constant-time compare. The
browser path instead uses the exact Tailscale host/session contract above. Both
receive one
`X-ADE-Request-Id` per response, defensive headers (`no-store`, deny-all
CSP, `nosniff`, `DENY`), JSON replies bounded to 512 KiB. Commands add:
`Content-Length` required (`411` for chunked or missing), body ≤ 64 KiB
(`413` before parsing), `Content-Type: application/json` (`415`), JSON object
with only the allowed fields, plain identifiers (`invalid_payload` without
echoing the offending value), `Idempotency-Key` of 8-64 URL-safe characters
(`idempotency_key_required` / `_invalid`). Application rejections
(unknown repository or agent, illegal phase transition) are returned as
`422 command_rejected` with a message that passed `redactForWire`; a missing
device proof is `401 device_proof_required`, a principal without the scope or
a host without command devices is `403 scope_not_granted`, and key reuse
with another payload is `409 idempotency_key_reused`.

#### Event stream contract

`GET /api/v1/events` requires `Accept: text/event-stream` and at most one
cursor, either `Last-Event-ID` (EventSource reconnect) or `?cursor=`; both
present must agree. Without a usable cursor (absent, `0`, beyond the
journal top or behind `journalRetention.prunedSeq`) the stream first sends one bundled `snapshot` event whose `id`
is the current journal cursor; every following `journal` event carries
`events` and `messages` strictly after the previous `id`, in ascending
`seq`, at most 200 records per frame, with `id` = highest `seq` in the frame.
Reconnecting with the last id therefore receives exactly the records it has
not seen, without a snapshot and without duplicates; the union of the
connections equals the journal exactly once. The server sends `retry: 2000`
and a `: ping` comment every 15 s. Streams are bounded: eight concurrent
clients per host (`503 too_many_streams`, `Retry-After`), and a client whose
unsent bytes exceed 256 KiB is disconnected instead of buffering — the
journal is durable, so it resumes from its last id. Stopping the host API
ends every open stream promptly.

Wire projections (`shared/remote.ts`, built in `AdeApplicationService`)
whitelist journal `data` keys (`WIRE_EVENT_DATA_KEYS`); `workspaceDir`,
PTY `sessionId`, mailbox bodies and other host detail never leave main, and
free-text details pass `redactForWire` (credential funnel plus host-path
redaction, bounded to 300 characters).

Pairing begins in the trusted desktop UI with a short-lived single-use QR
challenge. The device completes possession proof over HTTPS and receives its
own revocable identity. Sessions use cookies with `Secure`, `HttpOnly` and
`SameSite=Strict`, plus exact Origin checks and CSRF protection. Every endpoint
performs local authorization; mutations are rate-limited, size-bounded and
appended to an audit journal.
Approval also requires recent passkey/device reauthentication.

The PWA service worker caches versioned static application assets only. API
responses, run evidence, patches and credentials use `no-store`. Offline UI may
report last contact time but cannot enqueue commands for later automatic
execution. The host must be powered on, logged in and running; tray/start-at-
login operation is a Goal 10 user-session feature. Close-to-tray is implemented;
login startup remains planned. There is no pre-login service.

## Electron IPC contract (shared/ipc.ts) — stable, build agents code against it

This contract is an internal trusted-renderer adapter. It is not the planned
network protocol and must never be forwarded by channel name over HTTP.

Invoke (renderer → main, `ipcRenderer.invoke`):
- `config:get` → full config; `config:save({settings:{theme}})` → saved config
- `remoteDevices:list()` → bounded device inventory and availability/error state;
  `remoteDevices:rename({deviceId,name})` / `remoteDevices:revoke({deviceId})` →
  refreshed inventory. Desktop-only; no credential output or remote administration.
- `photo:import(bytesBase64, mime)` → stored filename
- `agent:create(input)` / `agent:delete(id)` / `category:create(input)` …
  (creates workspaceDir, memory scaffold, worktree if repo-backed)
- `pty:create({agentId, task?, dispatchId?, runTaskId?})` → SessionMeta (interactive when
  task is absent; bounded one-shot task otherwise; injects memory first)
- `pty:write({sessionId, dataBase64})`, `pty:resize({sessionId, cols, rows})`,
  `pty:kill({sessionId})`, `pty:attach({sessionId})` → replay + sequence
- `pty:list()` → live/exited retained sessions + task queue status
- `pty:cancelTasks({agentIds?, runTaskIds?})` → active/queued cancellation counts
- `runtime:diagnose({agentId?})` → CLI/version/auth/task-transport readiness
- `harness:status()` → boolean-only stored-API-key status per keyed harness
  plus safeStorage availability; plaintext never crosses IPC
- `harness:setKey({runtime, apiKey})` / `harness:clearKey({runtime})` →
  write-only encrypted key storage (OS safeStorage, own file next to
  config.json; refuses to store when OS encryption is unavailable). On Linux,
  only known OS-backed Secret Service/KWallet backends are accepted;
  Electron's `basic_text` and `unknown` backends fail closed. Stored keys are
  injected main-side as the harness's documented environment variable only
  while secure storage remains available and only into sessions whose
  effective runtime matches
- `harness:setServiceKey({name, value, scope})` / `harness:clearServiceKey({name})`
  → write-only encrypted generic service keys (e.g. ELEVENLABS_API_KEY) with
  an injection scope of 'all' or a runtime list; reserved names (PATH,
  NODE_OPTIONS, ADE_*, the harness API-key slots, …) are refused. Scoped
  keys are injected main-side into matching native and WSL session
  environments only while secure storage remains available; explicit
  task/launch env always wins
- `harness:login({agentId, runtime})` → terminal session running the
  harness's documented sign-in command from ADE's fixed table (never from
  renderer input); the CLI owns the whole OAuth/subscription flow and the
  session receives no stored credentials. Subscription sign-ins therefore
  stay with the CLI and keep applying to ADE sessions automatically
- `harness:diagnose()` → harness-level readiness via one synthetic probe
  identity per first-class CLI (same safe version/auth commands); an
  authenticated CLI is surfaced as signed in, including its auth method
- `run:get`, `run:create`, `run:delete` → persisted orchestration snapshots/runs;
  a `run:create` participant may carry an optional per-run harness override
  (`runtime`, limited to MANAGED_HARNESS_OVERRIDES). The override is
  snapshotted on the RunParticipant and applied through
  `effectiveParticipantAgent` at every launch/capability/manifest seam; the
  catalog agent is never mutated and its customCommand does not leak into an
  overridden harness
- `run:start`, `run:cancel`, `runApproval:resolve` → managed state machine and
  its durable human integration gate
- `run:publicationPreview({runId})` → read-only verified publication candidate
- `run:publish({runId, expectedHeadSha, expectedHeadBranch, commandId?})` →
  explicit new `ade/**` branch plus GitHub Draft PR; no merge/default update
- `run:get` → `OrchestrationView` (no prompts, artifact bodies or mailbox texts)
- `run:report({runId})` → `RunReport`: files, tests with output, risks, SHAs,
  failure with failed test commands, integration range (desktop-only read)
- `runTask:create`, `runTask:fail`, `runArtifact:create` → journal-backed entities
- `git:status({agentId})` → branch, ahead/behind, files [{path,+,-,state}]
- `git:diff({agentId, path})` → unified diff text
- `fs:tree({agentId})` → workspace file tree (depth-limited, lazy children)
- `fs:read({agentId, path})` → text (size-capped)

Events (main → renderer, `webContents.send`):
- `pty:data` `{sessionId, dataBase64, sequence}` (coalesced renderer-side)
- `pty:exit` `{sessionId, exitCode, reason}`
- `pty:removed` `{sessionId}`; `pty:taskQueue` `{active,queued,maxActive}`
- `orchestration:changed` → authoritative `OrchestrationView`: runs/
  participants/tasks (prompt digest and length, parsed provenance)/events,
  artifacts (content length only), results, approvals, workspace leases,
  publications, messages (text length only), run usage and `seqCursor`;
  coalesced to one broadcast per event-loop tick
- `git:changed` `{agentId}` (debounced watcher, v1 optional: poll on focus)

Every invoke passes through one wrapper (`handle()` in `main/ipc.ts`) that
applies four checks/steps in order:

1. **Sender.** The sender is the main frame of a *registered* ADE renderer
   window (`main/rendererWindows.ts`) at the exact configured Vite URL
   (development) or packaged renderer file (production). Dashboard windows
   are never registered, so they cannot invoke ADE IPC regardless of URL.
2. **Payload.** The payload has only the channel's allowed fields, runtime
   enum values and bounded strings/arrays/base64/dimensions. Compile-time
   TypeScript types are not treated as a security boundary.
3. **Privilege policy.** `main/ipcPolicy.ts` holds
   `CHANNEL_POLICY: Record<InvokeChannel, {effect, surface, audit, armsShell?, remote?}>`,
   exhaustive by type: an unclassified channel does not compile, a
   misclassified one throws at registration. `effect` is the highest
   privilege the handler exercises (`read` < `mutate` < `host` < `launch` <
   `shell`); `shell` — operator command text through a shell — is confined to
   `SHELL_CHANNELS` (`agent:openDashboard` only). `surface: 'shared'` marks
   the operations the host API may also expose; every shared channel must
   carry a `remote` requirement `{scope, idempotency, proof}` that the
   application facade enforces before the handler runs. Channels whose
   payload stores a `dashboardCommand` carry `armsShell`. Audited channels
   (launch/shell/host, remote commands, never `pty:write`/`pty:resize`) log
   one line per call.

   *Why the `shared ⇒ read` invariant became `shared ⇒ read unless
   allowlisted`.* Until Goal 7 the only remote principal was the listener
   bearer token, so any shared mutation would have been reachable with one
   secret; the invariant was the lock. Deleting it would make a single policy
   line enough to expose a mutation. Instead the invariant is lifted per
   channel and only under the strongest requirement: a shared channel whose
   effect is not `read` must be listed in `REMOTE_COMMAND_CHANNELS`
   (`run:create`, `run:start`, `run:cancel`, `runTask:submit`), demand `scope: 'runs:write'`,
   `idempotency: 'required'`, `proof: 'device-signature'` and `audit: true`;
   shared `read` channels demand `scope: 'read'` without idempotency; `host`
   and `shell` effects can never be shared; desktop channels carry no remote
   requirement. `channelPolicyViolations()` reports every deviation and
   `handle()` throws on the first one at registration, so a misclassified
   line never reaches a renderer or the host API. The security suite pins the
   allowlist and each negative control (`test-security.ts`, "channel
   privilege policy").
4. **Redaction funnel.** A handler error is logged main-side (redacted, with
   stack) and rebuilt for the reply through `main/errors.ts`
   (`toIpcError`): URL credentials, vendor key shapes, `NAME=value` secret
   assignments, bearer/authorization headers and control characters are
   removed and the message is bounded to 2000 characters. The same module
   redacts backend stderr inside `ExecutionBackendService.checked`, the
   `pty:create` argv log and publication text. Text that leaves the host
   over the network additionally passes `redactForWire` /
   `redactedWireMessage`: the credential funnel plus `redactHostPaths`
   (Windows drive paths, UNC/`\\wsl$` paths, multi-segment POSIX absolute
   paths and `~/` paths become `[path]`; relative repository paths and URLs
   stay readable), bounded to 300 characters.

Main → renderer events use `broadcastToRenderers`; nothing iterates
`BrowserWindow.getAllWindows()` for ADE payloads, dialogs or notification
targets.

## Terminal beta security and UX

- Renderer process sandboxing, context isolation and disabled Node integration
  and webviews are mandatory. The preload exposes only allowlisted `invoke`
  and `on` wrappers.
- CSP defaults to `none`, permits self-hosted scripts/styles/fonts plus the
  `ade-photo:` image scheme, and denies objects, frames, forms and base URLs.
- Main-frame navigation stays on the ADE renderer; only credential-free HTTP(S)
  links may be handed to the system browser. Web permissions default to deny.
- Agent dashboards (`main/dashboard/DashboardWindows.ts`) open in a separate,
  unregistered BrowserWindow per agent with its own `persist:` partition,
  deny-all permissions, no preload and a fixed title. `will-navigate` and
  `will-redirect` share one origin guard: anything off the dashboard origin —
  a server 302 included — is blocked and, when it is a plain http(s) URL,
  handed to the system browser. Session cookies are rewritten with a bounded
  expiry only when they belong to the dashboard origin
  (`cookieBelongsToOrigin`, applied on top of Electron's URL filter); a login
  hop through a foreign identity provider earns no persistence. Deleting the
  agent closes the window and clears the partition's storage and cache.
- Workspace reads (`fs:tree`, `fs:read`, `fs:pathInfo`, `fs:agentFiles`) apply
  the same link discipline as mutations and the WSL helper: every component
  from the workspace root to the leaf is `lstat`-checked, a link or junction
  anywhere fails closed, the real path must stay inside the real root, and
  listings never follow links (a linked directory is shown as a plain entry).
- Diagnostics execute fixed version/auth probes for known runtimes. Custom
  command strings are neither executed nor echoed. Claude/Codex expose stable
  auth probes; Ollama checks its local service; other runtimes report unknown
  auth explicitly when no stable probe exists.
- Keyboard: Ctrl+Shift+T/W create/close, Ctrl+PageUp/PageDown cycle sessions,
  Alt+1..9 selects a session, Ctrl+1/2/3 changes top-level view (Terminals /
  Graph / Overview). Tab lists also implement roving focus and
  arrow/Home/End navigation.
- Native notifications fire only while ADE is in the background, for task
  completion/failure and abnormal interactive exits. Cancellation and clean
  interactive exits remain quiet.
- The Graph resolves a failed selected run's newest persisted task error first,
  then its `run.failed` journal detail, and renders the result directly as an
  accessible alert. Legacy failures without either source show an explicit
  missing-detail message instead of a silent generic status.

The planned remote renderer has a separate trust boundary. It receives no
preload bridge and no Electron privileges. HTTPS, ADE device authentication,
per-endpoint authorization, exact Host/Origin/content validation, CSRF defense,
idempotency, revocation and audit are cumulative requirements; private-network
reachability alone is not authorization. Its restrictive CSP permits only the
same-origin host and standards-based Web Push endpoints when notifications are
explicitly enabled.

## How the evidence is kept honest (tsconfig.scripts.json, scripts/run-suites.ts)

The suites are the project's proof; two guards keep them from proving less
than they appear to.

- **The drivers are typechecked.** `tsconfig.scripts.json` covers `scripts/**`
  and joins `pnpm typecheck` as a third `tsc --noEmit`. Before it existed,
  `tsx` transpiled the drivers without checking them, so compile-time guards
  written *inside* a driver never ran. `scripts/test-security.ts` declares its
  fixture map as `Record<InvokeChannel, unknown>` precisely so a new IPC
  channel without a fixture is a type error — the runtime loop cannot catch it,
  because a missing key reads as `undefined` and passes every void request.
  That guard first fired when it was switched on, and found `wsl:list`.
  (A channel with no *validation* was already caught: `ipcValidation.ts` ends
  in `const exhaustive: never = channel`. The uncovered case was a validated
  channel with no security fixture.)
  The project is standalone rather than a reference: the drivers pull
  main-process modules in transitively, and `composite` would require every one
  of them to be listed here too.
- **Each suite has a floor.** `scripts/run-suites.ts` is what `pnpm test` runs.
  It executes every suite (a failure no longer stops the rest, as the old `&&`
  chain did), reads each `<n> passed, <m> failed` summary and fails when a
  suite reports fewer checks than its recorded floor. A driver that silently
  stops emitting checks — an early return, a skipped branch, a fixture that no
  longer builds — otherwise prints a green summary and exits 0. Floors are per
  platform because several drivers gate checks on `process.platform`; only
  platforms whose counts were actually observed are enforced, and the runner
  names any platform it has no measurement for instead of guessing. A suite
  that grows past its floor is reported so the floor gets raised.
  `pnpm test -- --record` prints a paste-ready manifest.

## CI and packaging

- `.github/workflows/ci.yml` runs typecheck, focused scripts and production
  build on Windows and Ubuntu. Windows additionally runs the real
  Electron/ConPTY workflow plus an unpacked package; Ubuntu builds Linux-native
  `node-pty` and runs the same Electron/Playwright workflow against both source
  and the unpacked Linux executable under Xvfb.
- `.github/workflows/package-windows.yml` repeats verification, creates the
  x64 NSIS installer and uploads it. `WIN_CSC_LINK` and
  `WIN_CSC_KEY_PASSWORD` opt into Authenticode signing; local artifacts are
  expected to be unsigned.
- `.github/workflows/package-linux.yml` repeats the native Ubuntu gate, builds
  AppImage and Debian artifacts, runs the 47-check Electron workflow against
  unpacked, AppImage and installed `.deb` executables, writes SHA-256 checksums
  and uploads the unsigned artifacts.
- `scripts/test-electron-workflow.ts` uses platform-specific shell commands,
  seeds only a temporary ADE profile and
  verifies sandbox/preload boundaries, IPC rejection, real terminal I/O,
  multi-tab shortcuts, renderer reload replay, non-zero failure/restart,
  diagnostics, worker-specific managed planning, approval, integration and
  verification. Its current source workflow also drives publication preview,
  explicit confirmation, an exact push to a real isolated bare remote, a
  deterministic fake GitHub Draft PR and restart-persisted audit. The same
  script can target `ADE_E2E_EXECUTABLE`. It also proves catalog selection,
  local repository health, independent PR rendering, tab keyboard behavior,
  lazy commit diff, Escape focus restoration and manual refresh.
- The current 2026-07-19 development gate passes 465 focused Windows
  assertions and 64 source Electron/Playwright assertions. The previous hosted
  platform-closing gates passed 410 focused Windows assertions, 409 native
  Ubuntu assertions (the Windows `.cmd` probe is inapplicable), production
  builds and 47 Electron assertions on each native platform/artifact. The extended
  Windows-GUI→WSL gate adds 31 backend checks and 67 Electron assertions,
  including a full managed run and app restart. The first hosted cross-platform
  CI and Linux package workflows passed on `d32faa9`, including installation
  and execution of the Debian package. Versioned release publication remains a
  separate release gate.
- Goal 7 adds host contract tests for malformed/unauthorized/replayed requests,
  event reconnection and mobile projections. Goal 8 adds pairing, revocation,
  CSRF, mutation-audit and browser workflows through an isolated loopback
  proxy; CI must not require a real personal tailnet. Goal 9 adds step-up
  approval, evidence and notification tests. These join `pnpm verify` before
  their respective goal completes.

## Theming

- `theme/tokens.css`: all colors as custom properties on `:root[data-theme]`.
- Two themes v1: `dark` (mockup palette: bg #0E0F12, panel #15171C, raised
  #1B1E24, line #262A31, text #D7DBE1, muted #7C838E, accent copper #E09A4A,
  add #4EC98A, del #E0645C) and `light` (same hue family on paper ground —
  design it properly, not naive inversion).
- Each theme carries an **xterm ITheme** (bg/fg/cursor/selection + 16 ANSI
  colors). Theme switch calls `terminal.options.theme = …` on every live
  terminal — the terminal itself changes, not just chrome (SPEC #8).
- Background architected as a dedicated layer token (`--app-bg-layer`) so a
  gradient or user PNG-with-alpha can slot in later without refactor
  (SPEC #9 — architecture only, no UI now).

## Memory (main/memory/) — per docs/reports/hermes-memory.md

- Per agent: `<memoryDir>/MEMORY.md` + `USER.md`, entries joined `\n§\n`,
  caps 2,200/1,375 chars. `MemoryStore.ts` ports add/replace/remove/batch,
  dedup, drift guard (.bak + refuse destructive ops), atomic writes.
- On every `pty:create`, regenerate the managed block
  (`<!-- ADE:MEMORY:start/end -->`, rendered with the `═` headers + usage %)
  inside `CLAUDE.md` (claude) / `AGENTS.md` (codex & others) in the agent's
  workspaceDir, plus the WHEN/SKIP save-instructions and the rule that the
  agent edits the memory files directly (paths given in the block).
- v1 write path = direct file edits by the CLI agent + drift guard on load.
  v1.1 = MCP `memory` tool (schema text already in the report).
- Goal 5 labels existing `memoryDir` content as agent-global and reserves a
  binding-local overlay for repository context. Template seeds are copied on
  spawn; no two agents/templates/bindings share a writable memory directory.

## Photos

- Import via file picker (renderer) → bytes to main → stored under
  `userData/photos/<id>.<ext>`; PNG alpha preserved; renderer loads via
  custom `ade-photo://` protocol (registered in main) to avoid file:// CSP
  issues. Fallback avatar: initials on hue gradient (from mockup).

## UI rules distilled from feedback (see SPEC)

No emojis or status-bar path. Sessions are terminal windows: the tab strip has
tabs + `+`; `+` opens the per-session scope/runtime/model selection from Goal 21.
Inspector:
repository-scope header plus Overview / Changes / Files tabs, collapsible,
resizable and progressively disclosed through one shared detail pane.
Default order is rail | terminal | inspector; Settings may put the inspector
on the left. Rail resizable. Onboarding modals per mockup, plus photo upload.

## Build phases & ownership (agents)

The phase list below is the historical 2026-07-07 build plan. Current work is
tracked in `ROADMAP.md`; factual capability status lives in `STATUS.md`.

- **A. Scaffold** (one agent): toolchain boots, window opens, tokens +
  theme provider, IPC skeleton with typed contract, config store, empty
  panes with resizable layout. `pnpm dev` verified on Windows.
- **B1. PTY/terminal** (agent, after A): PtyManager + TerminalPane +
  launch profiles + attach/replay + exit handling. Owns `src/main/pty`,
  `src/renderer/terminal`, `src/shared/runtimes.ts`.
- **B2. Rail/tabs/onboarding/photos** (agent, parallel to B1): owns
  `src/renderer/{rail,tabs,onboarding}`, `src/main/photos.ts`, stores.
- **C. Workspace/git** (agent): owns `src/main/git`, `src/renderer/rightpanel`.
- **D. Memory** (agent): owns `src/main/memory`.
- **E. Integration + verify** (agent + architect): real CLI smoke test
  (launch claude/codex in a session), theme switch incl. xterm, resize,
  onboarding round-trip.

Phase agents must not touch files owned by a parallel phase; shared files
(`shared/*`, `App.tsx`, `ipc.ts`) change only via the contract above.
## Remote workspace administration (Goals 12–15, 2026-09-08)

The new operator-requested administration surface goes through
`AdeApplicationService`, separately from mirrored IPC channels.
`REMOTE_COMMAND_CHANNELS` remains the four bounded run/task commands; no host,
config, filesystem, PTY or shell IPC is promoted to `shared`. Administration
uses explicit typed application methods and path-free DTOs in `shared/remote`.

Device records optionally carry desktop-granted `host:restart`, `catalog:write`
and `repositories:write` capabilities. Missing grants mean no administration;
bootstrap and pairing never inherit them. The new desktop-only audited invoke
`remoteDevices:setAdminScopes` validates exact keys, supported scopes and unique
values. Grant changes close sessions/streams; subsequent requests must prove
the device again and use current grants. Secrets never leave the local vault.

Signed `GET /api/v1/host` returns an opaque process-instance ID, app version,
restart availability and bounded blocker descriptions. `POST /api/v1/host/restart`
requires `{instanceId}`, a current device grant, an idempotency key and the
existing browser session/CSRF gate. `RemoteCommandLedger` binds the hashed
device/key to operation/payload, fsyncs a reservation and records the outcome
before scheduling relaunch. Same-key requests coalesce/replay across restart;
interrupted reservations never rerun. Storage is link-checked, bounded to
500 receipts/1 MiB and unavailable on corruption/write failure.

`HostOperationGate` counts desktop mutations and remote run commands, refuses
restart during in-flight operations and fences new mutations once accepted.
Existing PTYs, task queue, running runs and workspace operations are blockers.
Desktop revocation/grant withdrawal remains available through the fence; the
controller rechecks the grant before relaunch. Electron retains its executable,
app argv, cwd and profile environment and quits gracefully after allowing the
receipt response to flush. No remote executable, argv or host path is accepted.
The PWA confirms completion only after an authenticated different instance ID.
The implementation is measured on native Windows source production launches;
platform/package claims must follow `REMOTE_WORKSPACE_RESULTS.md`.

`POST /api/v1/admin/commands` dispatches a closed discriminated application
union: `agent-create`, `project-create`, `workspace-prepare` need `catalog:write`;
`git-fetch` and `git-apply` need `repositories:write`. These are not invoke
channel names and cannot call IPC handlers. Every effect uses the same signed
device/CSRF/audit/receipt admission and host-operation fence. Agent creation
accepts a bounded name and host catalog/profile identity, copies only configured
runtime settings and creates fresh home/memory/instructions. Project creation
accepts a name only and creates a named child of the desktop-configured project
parent. Without that setting, legacy administration creates a UUID directory
below `userData/ade/projects`. Both initialize native Git with an initial empty
main commit and disabled hooks; configured roots also have their saved directory
identity rechecked. See `TABLET_PROJECT_START.md`.
There is no clone URL, path, executable, secret or free-form config field.

Workspace preparation resolves the existing agent/repository binding through
`RepositoryScopeService`. Native scope creation and reads now check link/junction
components before inspecting/materializing worktrees, including configured
worktree roots. Existing leases and live sessions (including legacy path-only
records) refuse remote preparation. Interrupted provisioning may leave files
for inspection but never automatically repeats under the same receipt key.

`POST /api/v1/admin/git` is a bounded signed read/preview query. Overviews need
read scope; previews additionally need the Git grant. It uses the existing
`RepositorySyncService` with an explicit wire redaction projection. Preview IDs
are device-owned, capped at 20 and expire with the underlying five-minute
preview. Apply rechecks ownership and target/source/binding drift, then consumes
the preview; retry replays the durable outcome. Queries/commands currently
accept native catalog repositories only. Main/agent branches, counts and measured
fetch freshness are visible, absolute host paths and Git argv are not.

Run summary participants add optional `agentId` for compatibility with older
hosts and stable remote filtering. Work/Graph filter by repository and agent
identity; the global task-slot counter remains global. Project/mode drafts and
pending task keys survive reload in device-scoped storage; general management
dialog keys remain in page memory. Both clear on identity revocation/disconnect.
A late task reply clears only the matching
submitted draft; it cannot erase another project's or subsequently edited text.

### Device resource selection

`RemoteDeviceStore` stores optional `DeviceResourceAccess` alongside device
administrative grants. Absence preserves the legacy `all` policy; `selected`
contains at most 500 unique opaque repository IDs and 500 agent IDs. Empty
selection grants no resources. Desktop-only `remoteDevices:setAdminScopes`
atomically saves scopes and optional resource selection, invalidating current
device connections and terminal control. Pairing keys remain unchanged.

`DeviceResourceService` reads current grants, never cached principal selection.
`AdeApplicationService` filters catalog, summaries, snapshots and journal pages,
and guards direct profile/workspace/run requests. A run is visible only when its
repository, task repositories and every participant agent are shared. SSE advances
over filtered journal pages without revealing their contents. Async reads check
again before returning. `ProjectAuthorization` callbacks receive the resolved
repository/workspace before registration or Git mutation; stored previews cannot
authorize their own execution. Replayed results are checked against current
sharing. Terminal services independently guard selection, launch profiles,
inventories, spawn and input; the narrow remote IPC command allowlist is unchanged.

Selection governs ADE resource access, not the filesystem privileges of an
interactive shell. Global catalog creation and legacy cross-agent Git sync require
the `all` policy; selected projects retain their per-workspace Git/publish APIs.
`MobileHostState.resourceSelection` explains this in the mobile management flow.

Electron owns one process per user-data profile via `requestSingleInstanceLock`;
a subsequent launch activates the initialized owner. A persisted mobile opt-in
starts connection monitoring even after an initial listener failure. Retry never
enables a device/profile that the operator has disabled.

### Interactive native Codex tasks and saved result files (September 12)

`allowQuestions` selects `CodexAppServerProcess` for native Codex only, preserving
the existing exec transport otherwise. The process negotiates experimental
request-user-input support; model/reasoning/sandbox come from the effective
profile. JSONL frames, queued bytes, item deltas, question counts and question
text are bounded. Only explicit public notifications enter the activity parser;
raw reasoning content and protocol envelopes do not. Managed output schemas and
final-result files use the existing coordinator validation boundary.

`RunQuestionService` journals questions on their owning task using
`question.requested` / `question.updated` records with explicit status, so
an answer awaiting confirmation is never labelled resolved by the journal.
The `run:questions` IPC endpoint
is a read channel; `run:answer` is the only added remote command channel and
requires device-signature/runs:write/idempotency/audit. GET
`/api/v1/runs/:id/questions` and POST `/api/v1/runs/:id/answers` call only
AdeApplicationService and recheck resource selection. Task IDs are resolved
inside the specified run. Status progresses pending → answering → answered only
after the native server acknowledges it; interrupted callbacks expire. Answer
forms are not persisted as text, while model results may quote answers. General
views contain pending counts, never question bodies or answer digests. RunReport
contains question detail without digests. Archives carry question records and
pruning removes them with their task. Blocking questions pause the remaining
task budget; answering resumes that remainder.

`RunFileTracker` stores changed completion bytes in `RunFileStore`, addressed by
SHA-256 under `ade/archive/files`. Limits: 16 MiB/file, 64 MiB scanned/task,
100 saved files/task, 2 GiB content store. Existing blobs are retained; reaching
the quota produces an explicitly incomplete capture. Reads validate link count,
descriptor identity, size and hash. Task `fileTracking.saved` contains only
references and is archived/pruned with the task; file bytes stay outside config.
Archived runs retain blob references. No automatic blob deletion or archive
import is introduced. Result APIs read retained journal runs; cold JSON run
archives remain operator files. Saved downloads require the same current device
and resource authorization, safe types and text redaction as workspace downloads,
and can work without the original workspace.

Project results page retained runs in batches of 20, ordered by creation time and
ID. The validated timestamp/ID cursor contains no host paths; resource filtering
precedes pagination. Shared desktop/mobile controls provide previous/next pages,
loading/error/offline states and a separate saved-file label.


## Personal organizer: Tasks, Notes and offline edits

`shared/organizer.ts` defines exact document/query/mutation shapes and size limits.
`OrganizerStore` owns a separate `userData/ade/organizer.json`, outside project
repositories. Its atomic snapshot contains document revisions, deletion tombstones
and one latest receipt per writer. A writer is bound to a hashed desktop/device
owner; sequence plus payload digest makes a lost-reply retry idempotent. A stale
put creates a conflict copy, while stale deletion is rejected. File reads and
atomic writes enforce the existing no-link discipline and external-change guard.
Bodies and photos never enter the generic remote command ledger or audit log.

Desktop invokes `organizer:query`, `organizer:command`, and
`organizer:dictationPrepare`; these channels remain desktop-only in IPC policy.
The host exposes dedicated signed POST `/api/v1/organizer/query`, `/command` and
`/dictation` adapters through `AdeApplicationService`. Existing devices gain no
implicit authority: `organizer:read` and `organizer:write` are separate grants;
dictation additionally requires `dictation:transcribe`. Mutations require an
Idempotency-Key matching writer and sequence. Project/run resource restrictions
remain enforced. Wire text passes through redaction; a redacted document is not
an editable replacement for the original. The generic remote-command allowlist
is unchanged. Main events use `rendererWindows` and carry revision metadata only.

Diagnostics on the tablet reuse the desktop probes without widening any
channel: `runtime:diagnose` stays desktop-only (`launch`, audited), and the
host exposes a dedicated signed POST `/api/v1/diagnostics/query`
(`AdeApplicationService.diagnostics`) behind the separate grant
`diagnostics:read` ("Run CLI diagnostics"). The payload is at most one
`agentId`; session ids never appear on the wire because the tablet only
holds opaque host-API ids. The composition root passes the same
`diagnoseConfigured` closure the IPC handler uses (no session, backend from
the agent's default repository), so the probes are identical: `where`/`which`,
`--version` and the sign-in status commands, never a credential value and
never a custom command. Items are filtered to the agents the device may see,
then every free-text field passes `redactForWire` (`main/diagnostics/
diagnosticsWire.ts`), so absolute host paths become `[path]`. Each run is
audited under `runtime:diagnose`; browser sessions get at most twelve runs per
minute (`BrowserRequestBudget`) because each run spawns CLI processes on the
PC. The tablet renders the report with the same `DiagnosticsReport` component
as the desktop modal, inside Settings, and shows where to enable the grant
when `capabilities` lacks it. The generic remote-command allowlist is unchanged.

The common React organizer uses an IndexedDB profile per desktop/paired identity.
A local transaction reserves the exact pending command before network submission.
Web Locks serialize browser-tab flushes where supported; durable writer receipts
remain the authority. Confirmation clears only the acknowledged generation, so
later typing retains the original acknowledged base even when another writer
changes the document between save and read. Confirmed rejection may release an
unexecuted request after checking the server writer checkpoint; unknown outcomes
keep their exact key. Rejected stale deletion restores the newer visible entry.

`OrganizerEditing` coalesces typing and retains unsaved buffers across page changes.
Quota failure is visible and is not reported as saved. The buffer can be retried
or exported; a reload warning is a last safeguard, not persistent storage. Local
identity removal clears retained buffers and writes an IndexedDB tombstone that
also prevents late in-flight operations from recreating the forgotten profile.
Offline availability is limited to the cached public app shell and local drafts;
this does not imply offline speech transcription or a running remote agent.

Image imports normalize PNG/JPEG/WebP into bounded JPEG attachments. Main checks
encoded dimensions before native decode. Views and canvas use temporary Blob URLs
under the unchanged CSP. Strokes remain structured editable data. Who may draw is
decided per pointer in `renderer/organizer/sketchInput.ts`: a pen tip draws, its
barrel button or eraser end erases, a touch contact wider than 24 CSS px is a
palm and is ignored, and any touch is ignored while a pen is down or was near
(hover or contact) within the last 1.5 s. Once a device has reported a pen, a
finger on the sheet scrolls the page instead of drawing (`touch-action` switches
from `none` to panning); the input mode, "pen seen", colour and width are device
preferences in `localStorage`, never document data. Rendering smooths recorded
points with quadratic curves on screen and in exports alike. Drawing happens on
the sheet (`renderer/organizer/SketchSheet.tsx`): a fixed overlay portalled to
`<body>` with `role="dialog"`, not the browser Fullscreen API, so Electron and
the tablet PWA behave alike; the note keeps a read-only preview. Pan/zoom is a
`ViewTransform` (`renderer/viewTransform.ts`, shared with the graph's wheel and
button zoom), clamped so a quarter of the sheet stays visible and bounded to
0.5–6× the fitted scale; the canvas is sized to the viewport times
`devicePixelRatio` and strokes are drawn through the transform, so zoom is
sharp. One finger pans, two fingers pinch, Ctrl + wheel zooms, the middle mouse
button or Space + drag pans; a finger that lands beside a drawing finger turns
the gesture into a pinch and drops the unfinished stroke. View, tool side and
the first-run hint are view/device state; the document sees only strokes and
the background photo id. Focus discipline comes from `useDialogFocus`
(`renderer/onboarding/Modal.tsx`): focus moves to the canvas on open, Tab cycles
inside, Escape closes (the options panel first), and focus returns to the
"Draw" button or falls back to the note's first field. A pen touching the
preview opens the sheet and hands the active pointer over: the sheet calls
`setPointerCapture` for that pointer on mount and continues the stroke; when
the pen has already lifted the capture throws and the sheet merely opens. An
optional dot grid is drawn on screen only, from a device preference, and
never reaches the document or an export. Erasing (`renderer/organizer/sketchErase.ts`)
either removes the topmost whole stroke or cuts a part out of every stroke
under the eraser: points inside the circle disappear, crossing segments are
split at the circle's edge, and the pieces become new strokes with fresh ids,
so strokes stay structured data. The sheet size is editable within the
contract's 1…4096 bounds (presets and custom width/height); a size smaller
than the drawing's extent is refused, and the undo history holds whole
`OrganizerSketch` snapshots so size changes undo too. PNG export takes a
device-side scale (1–3, capped at 8192 px per side); the document itself
never changes for it. Line width (1–40), pen pressure, eraser mode and size
are device preferences. PDF is lazily
loaded and rasterizes Unicode text and images; Markdown is text-only and PNG is
the sketch/background. Exports do not replace the editable original.

Task dispatch persists its reviewed project, agent, prompt and command key before
calling the existing `runTask:submit` / `/api/v1/tasks` boundary. Confirmation adds
one run link; it does not mark the personal task complete. Attachments stay with
the personal item and are not silently included in a text-only agent submission.
The main reminder scheduler checks every ten seconds without launching work.
Foreground reminders use an application banner; background native notices contain
only a count, and depend on OS support/settings. Acknowledgement is document data;
unacknowledged reminders can appear again after restarting ADE.

Evidence and the explicitly deferred whole-repository verification are recorded in
[TASKS_NOTES.md](TASKS_NOTES.md). These tests do not establish physical tablet pen
pressure/palm behavior or guaranteed operating-system notification delivery.


## Shared room navigation

`shared/appNavigation.ts` and `appViews.ts` own the room order and German product
vocabulary. Desktop and mobile render `renderer/nav/AppNav`; personal tasks and
notes mount the existing lazy organizer routes. The navigation keeps the prior
per-device collapse preference and arrow/Home/End navigation. Only the toggle
button collapses the navigation: an Escape that lands on a tab after a dialog
closes used to collapse and persist it, which hid every room until the toggle
was found again (removed 2026-09-23).
Graph actions use the UI branch's fixed control groups. The mobile connection
dialog explains transport/build states without replacing the paired identity.
This integration changes presentation; organizer and signed-host boundaries remain
unchanged. Integration tests were explicitly deferred by the user.
