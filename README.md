# ade_

Agentic development environment — one desktop workspace where all of your CLI
agents (Claude Code, Codex, OpenCode, Grok Build, Ollama models) live as real
terminals around named agents.

Product spec: `docs/SPEC.md` · Architecture: `docs/ARCHITECTURE.md`

## Run

```
pnpm i
pnpm dev
```

`pnpm build` builds to `out/`; `pnpm start` previews the built app.

## PTY smoke test

node-pty (ConPTY) is verified at app start when the env var `ADE_PTY_SMOKE=1`
is set — main logs `[ade] pty-smoke: ade-pty-ok` on success. node-pty 1.1.0
ships Node-API prebuilds, so no Electron rebuild is needed; if a future
node-pty version drops them, run `pnpm rebuild:pty`.
