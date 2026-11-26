# Claude Assistant — Suggestion Box

A companion pane for Claude Code that sits beside your chat in **every session**
and tells you what to create next: a hook, a subagent, a skill, a CLAUDE.md rule,
a DESIGN.md, an MCP connection, a permissions allowlist.

It reads your own Claude Code transcripts (`~/.claude/projects/*/*.jsonl`), your
current session, and your existing setup (`CLAUDE.md`, `.claude/`), then spots
patterns:

| It notices… | It suggests… |
| --- | --- |
| "every time / from now on / whenever…" in your prompts | a **hook** |
| "always / never / make sure…" repeated | **CLAUDE.md** rules |
| Claude running tests/lint right after edits | a **PostToolUse hook** |
| the same prompt opening again and again | a **skill** or slash command |
| lots of reading/searching | a **subagent** |
| many UI/design prompts, no DESIGN.md | a **DESIGN.md** |
| the same safe commands approved repeatedly | a **permissions allowlist** |
| commit/push/PR over and over | a **/ship command** |
| talk of GitHub, Figma, Slack… | an **MCP server** |

It also learns **your project**: stack (Next.js, Python, Rust…), package manager,
the real `test` / `lint` / `format` scripts, `.env` files, database migrations,
monorepo layout, and whether your `CLAUDE.md` mentions how to test. Sessions are
read **in full** (this project's newest 40, plus a few from other projects for your
habits), so suggestions use your actual commands, folders and files, e.g. "auto-run
`pnpm run lint` after edits", "block `.env` access", "give `src/cart/` its own CLAUDE.md".

Each suggestion shows the evidence from your sessions, what to create, and a
ready-to-send prompt. Press **Put in my prompt** (or **Copy**), review it, hit
Enter, and Claude builds it with you. The **Learn** tab is a short tour of every
Claude Code feature, also with starter prompts.

Everything is analysed locally by plain code. Nothing is sent anywhere.

## Install (once, works in all sessions)

In Claude Code on your own computer:

```bash
/plugin marketplace add kavithashan10/claude-assistant
/plugin install suggestion-box@claude-assistant
```

Choose **user** scope so it loads in every project. Then start a new session —
the pane opens by itself. Reopen it any time with `/suggestions`.

Keys inside the pane: `s` suggestions, `l` learn, `r` refresh.

## Notes

- Past sessions are read from the machine the plugin runs on. In a cloud session
  you only see that container's history, so install it locally for the full picture.
- Suggestions are heuristic. Dismissing one hides it permanently.
- Browse community skills at [skills.sh](https://skills.sh).
