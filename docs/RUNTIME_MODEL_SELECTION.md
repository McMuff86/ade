# Dynamic runtime model selection — 2026-09-09

New Agent and Agent Settings load model choices from the installed CLI in the
selected native/WSL environment. The default repository's backend takes priority;
without a repository, the agent's home backend applies. No model identifiers are
hard-coded into the returned catalog.

## Operator use

1. Start the updated ADE build. Open **New agent** or an agent's **Agent settings**.
2. Choose **Codex**, **Grok Build**, **Claude Code** or **Ollama** as the runtime.
   The model field becomes a dropdown; **Modelle aktualisieren** repeats discovery.
3. Select a model and save. Claude aliases show their currently resolved model ID.
   Codex's effort choices follow the selected model's reported capabilities.
4. A missing CLI/login or failed query has a visible recovery message. Configure
   the CLI in **Settings → Harnesses** and refresh. A saved ID absent from the
   latest list stays selected as **nicht bestätigt**, so a transient failure
   cannot silently migrate the profile. Manual IDs remain an explicit advanced
   option and are never labelled as discovered availability.

New blank profiles choose the CLI-reported default when discovery succeeds.
Existing profiles retain their choice. An existing Claude profile without an ADE
model pin keeps inheriting its CLI setting unless the operator chooses a model.
Custom start commands keep precedence and can select their own model.

## Discovery and persistence contract

- Desktop-only `harness:models` is classified as an audited `launch` operation.
  Its strict payload contains only a supported runtime and optional backend ID;
  it never accepts a path, executable, prompt or arguments. It is not added to
  the remote IPC allowlist. The selector is a desktop onboarding/profile feature.
- `RuntimeModelService` deduplicates concurrent queries for the same runtime and
  backend; subsequent queries are fresh. It passes the same ADE credential
  environment used for that runtime's sessions, exclusively inside main.
- Discovery resolves the installed executable and runs from that backend's user
  home. The list describes the CLI account/global configuration; project-local
  settings and custom commands can further affect a session. Model-list discovery
  does not submit a prompt or measure inference, quota or per-request availability.
- Codex uses stdio `initialize`/`initialized`, `account/read`, then paginated
  `model/list` with hidden entries excluded. It never starts a thread or turn.
  The official [Codex App Server model contract](https://learn.chatgpt.com/docs/app-server#list-models-modellist)
  supplies model names and reasoning capabilities.
- Grok uses the documented [`grok models`](https://docs.x.ai/build/cli/reference)
  command and parses its bounded Available models section, including the default.
- Claude checks `auth status --json`, then reads the `models` array from the
  stream-json initialization control response. The probe disables session
  persistence, hooks and external MCP configuration and sends no user message.
  This response is version-sensitive: unknown or malformed formats fail closed.
  Model IDs/aliases are passed to the documented
  [`--model` option](https://code.claude.com/docs/en/model-config#setting-your-model).
- Ollama uses `ollama list`. Discovery never downloads or starts a model.
- Process output is limited to 1 MiB and 200 models, with bounded locator/auth/
  protocol timeouts and repeated-cursor refusal. Only validated IDs and redacted
  display fields leave main. Raw stderr, account details, credentials and host
  paths never enter the catalog. Windows npm shims use fixed, quoted arguments;
  WSL environment values travel through `WSLENV`, not arguments. Only the probe's
  own process tree is stopped after completion or failure.
- Optional `claudeModel` is carried by Agent, creation/update inputs, templates
  and portable bundle v1. Existing configurations need no migration. Interactive,
  one-shot and managed Claude commands preserve the selected ID and quote its
  optional `[1m]` suffix. Changing runtime clears the old model field through
  the normal identity update. Existing running sessions keep their launch choice.

## Evidence and limits

Final native Windows `pnpm verify` passed **2,026 checks**, all three TypeScript
projects and the production build (exit 0). The complete log is
`test-results/model-selection-verify.log`.

| Verification group | Passed |
| --- | ---: |
| 30 focused suites | 1,637 |
| Desktop Electron workflow | 182 |
| Git sync Electron | 20 |
| Mobile Chromium browser | 56 |
| Mobile Electron | 15 |
| Remote restart Electron | 10 |
| Remote workspace browser | 24 |
| Remote workbench browser | 25 |
| Remote terminal Electron | 35 |
| Visual regression | 22 |

The focused total includes 27 model-discovery, 216 security and 34 configuration
checks. The desktop workflow includes 18 new checks covering dropdown selection,
dynamic effort options, missing/removed models, refresh recovery, Claude command
preview, durable save/reopen, templates/bundle round-trips, clearing a Claude pin
back to CLI inheritance and keyboard/focus. The isolated screenshot
`test-results/models/claude-model-picker.png` was visually inspected. Discovery
negative controls cover missing authentication, malformed/oversized output,
timeouts and repeated pagination cursors, followed by a successful positive query.

Live metadata-only probes of the installed native CLIs succeeded: Codex 0.153.4
returned six picker entries, Grok returned two, and Claude Code 2.1.266 returned
five alias/default entries with their resolved IDs. No real inference was run.
Automated CLI fixtures are isolated from personal authentication and projects.
Native Linux/macOS, real WSL model discovery, third-party Claude providers and
physical Galaxy/Chrome model selection are not claimed by these measurements.

The operator's personal ADE instance was not restarted during this change.
Completely close and start ADE to load the updated main process and renderer;
reloading a renderer alone does not activate the new discovery service.
