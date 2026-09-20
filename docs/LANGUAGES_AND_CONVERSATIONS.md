# Interface languages, conversations and voice studio

Implemented 20 September 2026. **Production builds are the validation performed
for this change. The operator explicitly requested no tests, typecheck or full
verification.** New conversation and paid audio flows still need operator review;
earlier coordinator evidence is not evidence for this new casual mode.

Update 20 September, 09:24 CEST: the fixed Codex version rejection is replaced
by per-process compatibility checks. Native Codex 0.155.1 casual text and
desktop/tablet continuation are now measured; voice/audio acceptance remains
separate. [Compatibility, evidence and activation](CODEX_VERSION_COMPATIBILITY.md).

## Using the feature

On PC and tablet, open **Einstellungen / Settings → Sprache / Language** and choose
**Deutsch** or **English**. The change is immediate and does not reload the app.
Open editors, terminal sessions, notes and task drafts retain their contents.
The desktop preference is saved with the PC configuration; each browser/device
keeps its own preference. Device pairing is independent of this setting.

The main **Gespräche / Conversations** button opens two choices:

- **Projektbetreuung / Project supervision**: existing project overview,
  handoffs and confirmed Codex project actions. A project-specific entry opens
  this area directly.
- **Plaudern & Stimme / Chat & voice**: a separate conversation history for
  everyday questions and ideas. Select a native Codex profile with an explicit
  model and reasoning effort, create a conversation, then type or dictate.
  Sending the first message starts the model. Closing the dialog preserves the
  conversation; ending it disconnects that model session.

Expand **Stimmenstudio / Voice studio**, load voices, and enter sample text or use
the latest conversation reply. Review that text before generating audio. Up to
1,200 characters are accepted; longer replies are visibly truncated in the sample
editor. Two independent variants share the same sample text. Generate either one
or explicitly generate both, then use their audio controls to compare. Replaying
the already generated audio does not create another provider request.

| Model / connection | Controls sent to ElevenLabs |
| --- | --- |
| Eleven Multilingual v2, text-to-speech | Speed (0.7–1.2), stability, similarity, style, speaker boost |
| Eleven v3, existing text-to-dialogue connection | Stability only; other settings remain stored for v2 |

The voice studio does not overwrite ADE's global/project/agent voice preferences
or ElevenLabs' saved voice settings. Neutral, calm and expressive presets are
available; up to 12 custom presets are stored on the current device. Changing
controls does not generate audio. Generating A/B is two explicitly requested,
sequential paid generations, each with its own receipt. A disconnect stops the
remaining sequence; it does not silently retry either sample. Samples stay in
memory; settings, text and a pending request survive closing the dialog.

The spoken-language choice applies to v3. Multilingual v2 detects language from
the text and does not support a forced language code. Interface language,
conversation language and voice are separate choices. Existing terminal read-aloud
and greeting behavior remains on its v3 connection; those global controls still
expose stability only.

## Localization architecture

`src/shared/i18n/locales.ts` defines the supported language IDs, autonyms,
`Intl` locale and direction. `index.ts` owns one i18next instance per process.
English is the source/fallback catalog; German is a complete typed catalog.
Catalog keys are English source copy, with context suffixes where existing
German wording differs. `language.*` keys cover the language setting itself.
Interpolation uses named values and React text rendering, never translated HTML.

`useLocale()` subscribes React components without remounting the application.
Module-level presentation tables use `localizedLabels()` to resolve a fresh
read-only snapshot after a language change. Do not use that helper for state,
protocol values, user objects or frozen objects. Dates and numbers use the
selected `Intl` locale. Storage keys, identifiers, CLI commands, branch names,
terminal text, personal content and model replies are not translated.

The existing IPC error contract transports strings. `localizeAppMessage()`
recognizes only known ADE messages and bounded catalog interpolation patterns
at presentation boundaries. It preserves unknown provider/Git diagnostics.
Host redaction runs before presentation translation. Never use the message
adapter on arbitrary notes, chat replies, commit messages or user titles.
Persisted legacy notices that are not recognizable catalog messages retain their
original text. Native OS and third-party command output use their own language.

To add a language:

1. Add its ID, autonym, `Intl` locale and direction in `APP_LOCALES`.
2. Add a catalog matching the English keys and register it in `i18n.resources`.
   Deliberately partial future catalogs can use English fallback.
3. Include it in the known-message adapter if old string-based host notices
   must be interpreted in that language. Add a separate cacheable locale chunk.
4. Review interpolation, plural wording, longer labels, keyboard navigation and
   direction on PC and tablet. Do not translate user content or wire enums.

`pnpm exec tsx scripts/i18n-inventory.ts` creates a source-copy inventory under
`test-results/i18n/`. It is a review aid with technical false positives, not a
language-completeness test. Translation tooling and downloaded language models
used during drafting remain in ignored scratch storage, outside the app.

## Conversation and voice boundaries

Conversation creation accepts optional `mode: 'project' | 'casual'`; omission
keeps the existing project mode. The main-owned binding stores the casual
`ade-casual-chat-v1` tool contract. Existing conversation storage needs no
migration. Summaries/detail expose the mode; the two UI histories and local
draft keys are separate. Old project drafts retain their original storage keys.

Casual mode inherits the chosen profile's model/reasoning only. It receives no
project instructions, memory or project tools, runs in its own conversation
workspace and uses the read-only coordinator runtime policy, checked against
the PC's installed stable Codex CLI (minimum 0.154.0) on each fresh connection.
Both action-source creation and action-authority checks reject casual bindings.
Changing supervised project scope does not invalidate a casual conversation.
Profile/model/policy changes still require a new conversation. Limits remain
64 stored conversations, 128 turns each, four connected/closing processes and
bounded durable receipts. Restart recovery never resends an uncertain turn.

No generic remote command allowlist was expanded. Conversation/dictation keep
their existing signed-device, all-project and scoped permissions. Consequently
casual conversations on tablet currently need the same broad read/run rights as
the existing coordinator; narrower chat-only device grants are future work.
Voice studio keeps the existing `speech:control` capability and resource checks.

The strict `SpeechTestInput` contract adds bounded `studio` text, an allowlisted
model and language with required valid tuning. It cannot be combined with a
server preset. The fixed provider endpoint and API key stay in main. Responses
are bounded to 2 MiB and 30 seconds; authorization is rechecked during requests
and before returning audio. Usage records include the actual selected model and
distinguish complete, not sent and unconfirmed attempts. Audio previews sent over
the host API pass through `redactForWire`.

Mobile generation uses the existing durable command ledger; a pending operation
can be checked with the same idempotency key. Only a small test ID is persisted
on the PC, while audio expires in memory after ten minutes/restart. Desktop
generation has no durable replay endpoint: an unconfirmed request is visible but
cannot be retried as though delivery were known. Dismissing it and requesting
another sample is an explicit new generation. Revoking a device clears its
casual drafts and studio storage alongside existing device drafts.

Provider contracts consulted:
[Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert),
[voice settings](https://elevenlabs.io/docs/api-reference/voices/settings/get-default),
[models](https://elevenlabs.io/docs/overview/models).
No paid ElevenLabs requests were made during implementation.

## Build and activation

From the repository root, `pnpm build` builds **desktop and mobile**. Close ADE
through its tray **Quit ADE / ADE vollständig beenden** action before rebuilding
the active output directory, then use `pnpm start` to open that build.
`pnpm start` uses `preview --skipBuild`; it does not create a newer mobile build.
The tablet uses the PC's mobile assets at the existing private HTTPS address.
Reload the page after activation; keep the existing browser profile and pairing.

During development, isolated output under `test-results/i18n/build` avoids
overwriting assets used by the running host. Language catalogs and libraries
have separate cacheable chunks; the desktop graph is loaded when opened.
This improves entry-bundle size but does not imply the total download shrank:
both language catalogs are currently loaded to permit immediate switching and
interpret known messages from a PC using the other language.

Final activation details are recorded in `docs/HANDOFF.md` and the ignored local
deployment receipt. Production build success is not a full runtime acceptance.
