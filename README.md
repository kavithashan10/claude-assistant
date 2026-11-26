# Claude Assistant — Suggestion Box

A beginner-friendly advisor for Claude Code. You say `/suggest`; it studies **your
project** and **your past sessions**, then tells you exactly what to create next and
why: which **subagent** (for which task), **hook**, **skill**, **CLAUDE.md** rules,
**DESIGN.md**, **MCP server** or **plugin**. Pick the ones you want and it writes them
for you, explaining each part so you learn the format.

```
## What I learned about your project
A Next.js + Tailwind shop. You're polishing the cart and checkout.

## Start here
1. Subagent — cart-reviewer
   - Task: review changes in src/cart/ for pricing and rounding bugs
   - Why now: 14 edits in src/cart/ and 3 corrections about rounding
2. Hook — run `pnpm run lint` after every edit
   - Why now: Claude ran it right after edits 11 times
3. DESIGN.md …
```

## Install

In Claude Code, type these two lines one at a time:

```
/plugin marketplace add kavithashan10/claude-assistant
/plugin install suggestion-box@claude-assistant
```

Start a new session, then run:

```
/suggestion-box:suggest
```

Optional focus: `/suggestion-box:suggest subagents`, `… hooks`, `… design`.

### If the plugin install gives errors

Copy the two files in by hand; no plugin needed:

```bash
git clone https://github.com/kavithashan10/claude-assistant
mkdir -p ~/.claude/agents ~/.claude/skills/suggest ~/.claude/scripts
cp claude-assistant/plugins/suggestion-box/agents/advisor.md ~/.claude/agents/
cp claude-assistant/plugins/suggestion-box/skills/suggest/SKILL.md ~/.claude/skills/suggest/
cp claude-assistant/plugins/suggestion-box/scripts/digest.py ~/.claude/scripts/
```

Then in `~/.claude/agents/advisor.md` and `~/.claude/skills/suggest/SKILL.md` replace
`${CLAUDE_PLUGIN_ROOT}/scripts/digest.py` with `~/.claude/scripts/digest.py`. Run `/suggest`.

## How it works

1. `plugins/suggestion-box/scripts/digest.py` (read-only, local) summarises the project (stack, scripts, folders,
   git churn, existing `.claude/` setup, `.env` files by name only) and your history in
   `~/.claude/projects` (commands run, files edited most, repeated prompts, corrections,
   "every time…" requests).
2. The **advisor** subagent reads that, opens the important files, judges what stage the
   project is in, and writes a ranked report with evidence.
3. `/suggest` shows it and creates what you choose.

Nothing is uploaded anywhere beyond your normal Claude Code session.

## Optional: live side pane (experimental)

`suggestion-box-pane` is a rule-based side pane. It needs a recent Claude Code and may
not work everywhere:
`/plugin install suggestion-box-pane@claude-assistant`.

Browse community skills at [skills.sh](https://skills.sh).
