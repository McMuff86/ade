> Historical build brief from 2026-07-07. It explains the original product
> intent but is not the current implementation contract. Use `docs/SPEC.md`,
> `docs/STATUS.md`, and `docs/ROADMAP.md` for current decisions.

I’m building my own ADE — an agentic development environment — for how I work. I run agents for everything: writing, content, and coding. I want one app where all of them live. This is a fresh repo; my hand-drawn mockup is at `mock/PENUP_20260707_214207.png` — use it as the layout reference.

Start from the Superset codebase (`github.com/superset-sh/superset`) — it’s the closest to this. Pull the memory system from Hermes (`github.com/NousResearch/hermes-agent`). I like how Conductor (conductor.build) does its tabs, but it’s not open source — so I’m giving you screenshots of it. -> In `mock/Screenshot1 + Screenshot2` Match the tab layout and feel from those. -> But not too much in "Mac" Style with the colored dots.

Here’s how Superset and Conductor work — they’re nearly the same — and what I want to change:

They each have a left rail of workspaces/projects, each one a repo in its own git worktree. Inside a workspace you get tabs, and each tab is a terminal pane where you talk to a CLI coding agent (Claude Code, Codex, Grok Build), plus a changes/diff panel on the right. Tabs can auto-launch an agent on open.

Keep that terminal-tab core, but restructure it:

- Make the left rail two levels: categories at the top (each with a profile photo) — like YouTube, or a coding project — and under each category, named agents (each with a name + profile photo). An agent is basically Superset’s “workspace” — its own repo/worktree and its own skills.
- When I select an agent, the tabs across the top are sessions of THAT agent — each tab a terminal running the same agent, so I can have three going at once. NOT split by model the way Superset does.
- Keep the terminal panes (chat with the agent right in the terminal) and the changes panel.
- Agents run Claude Code and Codex by default; let me connect Ollama for open-source models.
- Give each agent a Hermes-style memory system out of the box (`MEMORY.md` / `USER.md` + providers).

Then onboarding (reuse the new-project flow): a new user creates a category and picks a profile photo, then adds agents under it (name + photo), and that builds the rails on the left and tabs on top. Wrap it in a single one-command install.

For the build itself, use the fable-orchestration skill — you’re the architect: plan and direct, and hand the actual coding to Opus 4.8 agents. But start with the UI only — before you build anything real, give me a clickable mockup of this layout (the two-level rail, the agent tabs, a terminal pane) so I can react to it. Don’t wire up the backend yet.
