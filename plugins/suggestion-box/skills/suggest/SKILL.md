---
name: suggest
description: Suggestion Box. Looks at this project and your Claude Code history and tells you which subagents, hooks, skills, DESIGN.md, MCP servers or plugins to create next, then creates the ones you pick. Use when the user asks what to set up, what to automate, or how to get more out of Claude Code.
argument-hint: "[optional focus, e.g. subagents | hooks | design]"
---

# Suggestion Box

The user is learning Claude Code. Do this in order.

## 1. Get the recommendations

Delegate to the **advisor** subagent (use the Agent tool; the plugin's agent is named
`suggestion-box:advisor`, or just `advisor` if it was copied into `.claude/agents`). It reads the
project and the user's history in its own context window so this conversation stays clean.

Prompt it with: the current working directory, and this focus if the user gave one: `$ARGUMENTS`
(empty means everything). Ask it to follow its instructions and return its full report.

If the Agent tool or the advisor is unavailable, do the advisor's work yourself: run
`python3 "${CLAUDE_PLUGIN_ROOT}/scripts/digest.py" --cwd "$PWD"` (find `digest.py` under
`~/.claude` if the variable is empty), read the project, and write the same report.

## 2. Show it

Show the advisor's report to the user as written. Don't pad it or add new ideas of your own.
If anything is unclear to a beginner, add one plain sentence.

## 3. Create what they pick

When the user answers with numbers, create each chosen item. For every one:

1. Say in one line what file you are about to write and where.
2. Write the file(s) (templates below). Prefer the project's `.claude/` folder; use `~/.claude/`
   only if the user wants it in every project.
3. Show them what you wrote and explain each part in a sentence, so they can write the next one
   themselves.
4. Tell them how to use it (for example `/name`, or "Claude will pick it automatically when…").

Never overwrite an existing file without asking. For settings changes (hooks, permissions)
show the JSON diff first and wait for a yes.

### Templates

**Subagent** — `.claude/agents/<name>.md`
```markdown
---
name: <kebab-case-name>
description: <when Claude should use it; be specific, start with "Use when…">
tools: Read, Grep, Glob   # only what it needs; add Bash/Edit only if required
model: sonnet             # sonnet is fine for most; omit to inherit
---
<instructions: its job, what to check, exactly what to return>
```

**Skill** — `.claude/skills/<name>/SKILL.md` (typed as `/<name>`)
```markdown
---
name: <kebab-case-name>
description: <what it does and when to use it>
argument-hint: "<optional argument>"
---
<numbered steps. Use $ARGUMENTS where the user's input goes.>
```

**Hook** — merge into `.claude/settings.json`
```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "<the project's real lint/format command>" }] }
    ]
  }
}
```
Events: `PreToolUse` (can block), `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart`.

**CLAUDE.md** — short sections: Commands, Folder map, Conventions, Gotchas. Only facts you verified.

**DESIGN.md** — colors, typography, spacing, radius, component patterns, do/don't. Read the real
CSS/theme files first and reuse the existing tokens.

**MCP server** — explain what access it needs, give the exact `claude mcp add …` command, and let
the user run it. Don't add it yourself.

**Plugin** — tell the user the exact `/plugin install <name>@<marketplace>` line to run.

After creating things, suggest running `/suggest` again in a week, as their habits change.
