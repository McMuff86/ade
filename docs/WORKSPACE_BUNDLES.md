# Workspace bundles and profile migration

Status: shipped and used. A Windows profile — 5 categories, 7 agents, photos and
memory — was migrated into a native-Linux ADE inside WSL Ubuntu on 2026-08-03.
This document describes what the feature carries, what it deliberately does not,
and where each host differs.

## What a bundle is

A single JSON file describing a workspace **without any host paths**. It carries
repositories by *identity* (their normalised origin remote, e.g.
`github.com/owner/repo`), never by location, so the same bundle applies on a
machine that keeps its clones somewhere else entirely.

| carried | not carried |
|---|---|
| repositories (name + remote identity) | repository paths, worktree bindings |
| categories, agents, agent templates | runs, tasks, leases, publication audit |
| agent memory (`MEMORY.md`, `USER.md`) | harness credentials, API and service keys |
| profile photos, content-addressed | `customCommand`, dashboard URL/command |
| theme and memory settings (opt-in) | `settings.worktreeBaseDir` |

Omissions are reported as notices in the preview rather than left to be
discovered. Secrets are out of scope by design: they never enter a bundle, so a
bundle is not a credential to protect — but it does carry agent memory in clear
text, which is user content.

Photos are stored once per distinct content (`sha256`), so two identities
sharing an image cost one asset. Memory and photos are subject to aggregate
budgets; when one is exhausted the export says so with
`asset-budget-exhausted` rather than silently truncating the set.

## Exporting

Settings → **Workspace-Bundles** → *Bundle exportieren*, with two opt-in boxes:

- **Memory einschließen** — copies each agent's `MEMORY.md` and `USER.md`.
- **Fotos einschließen** — embeds the referenced profile photos.

Both are off by default because they enlarge the file and, in the case of
memory, put personal notes into a document that is easy to hand around.

An agent that no category can reach is **left out** with a notice naming it. Such
a record is invisible in the app — the rail and the graph both enumerate agents
through `category.agents` — so failing the whole export over one would block the
feature on a row the user cannot fix.

## Importing

Settings → *Workspace/Profil importieren…*, then one of two sources.

### Workspace-Bundle

A `.json` file produced by the export above. This is the route for moving
between machines or operating systems.

### ADE-Profilordner

An ADE profile directory (`<userData>/ade`, or a folder containing one), read
directly. It carries memory, photos and — where this host can reach the
repository paths named in that profile — the origin identities.

A repository whose path does not exist here loses its own origin check; the
planner then accepts any target for it. That is the normal case for a profile
copied from another machine and never fails the import.

### The mapping form

Nothing is written before *Import anwenden*.

- **Repositories** must point at a clone that already exists on this host. No
  target is proposed, because a guess would send the user at a path that cannot
  work. An entry can be skipped.
- **Agent homes** are *created* by the import, so the host proposes one under
  its own layout (`<profileDir>/agents/<slug>-<id>`), seeded once when the bundle
  is opened. The browse button picks the home's **parent**, since the home itself
  must not exist yet.
- **Kategorien / Agents / Vorlagen** are renamed or skipped here. Skipping a
  category skips its agents too — a cascade the preview states rather than
  implies.

Above the confirmation the preview states the outcome — *"Es werden übernommen:
2 von 3 Repositories · 5 von 5 Kategorien · 7 von 7 Agents"* — and warns whenever
anything is being left out. Read that line before confirming; every individual
skip is plausible on its own, and only the total shows what the import will
really produce.

Paths are shaped for the host as they are typed. On a Linux host both WSL share
spellings and a drive letter are translated, so a target copied out of Windows
Explorer works:

```
\\wsl.localhost\Ubuntu\home\me\repo   ->  /home/me/repo
\\wsl$\Ubuntu\home\me\repo            ->  /home/me/repo
C:\Users\me\repo                      ->  /mnt/c/Users/me/repo
```

On Windows those same strings are valid native targets and are left alone.

### Applying

`Import anwenden` is transactional: a backup of the current config, a staged
copy of every asset, a journal, then the config replace, then a receipt. An
interrupted apply is replayed or rolled back at the next start; a journal that
cannot be replayed is reported through the config-health banner and never
prevents ADE from opening.

The receipt at `<profile>/import-receipts/` records what was imported and what
was skipped, per entry, with a reason code. It is the first thing to read when
an import produced less than expected.

## Host support

`managedProfileSupport(platform)` is the single source for whether a host may
apply an import, whether managed assets are complete, and what the user is told.

| host | level | apply | difference |
|---|---|---|---|
| Linux | `descriptor-anchored` | yes | every managed path is addressed relative to a pinned directory descriptor with `O_NOFOLLOW`; a component cannot be substituted between check and use |
| Windows | `verified-path` | yes | no `O_NOFOLLOW`, no descriptor-relative syscalls, and a directory handle does not pin its directory, so every open is followed by an identity check that fails closed |
| macOS | `unsupported` | no | reported as a notice in the preview |

The Windows differences are measured, not assumed. Two decide the design:
`openSync(danglingSymlink, O_CREAT|O_EXCL)` **succeeds and writes the link's
target**, so files are created, verified and only then written; and renaming a
directory with an open handle succeeds, so anchors are witnesses to revalidate
rather than locks.

The workspace-import lock stays Linux-only — `ConfigStore` implements it with
`/proc/self/fd` lock files and `O_EXLOCK` is unavailable on Windows. Windows
relies on `ConfigStore.replace`'s compare-and-swap of the on-disk fingerprint
instead, and the weaker guarantee is stated in the preview.

## After migrating to a Linux/WSL ADE

What the bundle cannot carry has to be re-established once:

- **CLI sign-ins** in the distribution (`claude auth login`, `codex login`, …).
  ADE's sign-in terminal is native-backend only.
- **API and service keys.** Electron's `safeStorage` needs a keyring; without a
  desktop session WSL has none, and Settings says so. CLI subscription sign-ins
  are unaffected.
- **Repositories**, cloned locally and imported.
- **`customCommand` / dashboard fields** on agents that used them.

One thing improves rather than degrades: ADE running natively in Linux injects
the agent role and memory block into `AGENTS.md`/`CLAUDE.md`, which a Windows
host driving a WSL *backend* skips (`PtyManager` injects only for the native
backend).

Interactive sessions therefore leave `AGENTS.md` modified in the worktree. That
is expected and should not be committed. Managed tasks deliberately do **not**
inject — mutating the file after a clean workspace lease would alter the
repository under a run whose diff is verified.

## Testing

- `pnpm run test:workspace-bundle` — schema, exporter budgets, profile source,
  planner, target probe, the apply/recovery transaction and fault injection.
  Two groups are Linux-only and announce themselves as skipped: the root-swap
  test, which a host that revalidates instead of pinning cannot pass, and the
  profile-lock check.
- `pnpm run test:wsl-import` — opt-in, real end to end: plans and applies an
  import with a `wsl:<distro>` agent home against a live distribution, then
  confirms the home exists there with mode 0700 and the ownership marker. Skips
  cleanly with exit 0 when there is no WSL or no `python3` in the distro.
- `scripts/test-electron-workflow.ts` drives the import form itself — the
  proposed target, the totals line, and that clearing a field does not strand
  the flow.
