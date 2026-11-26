// The "Learn" tab: Claude Code features worth knowing, each with a prompt you
// can paste to have Claude set it up for you.
export type Feature = {
  id: string
  name: string
  what: string
  when: string
  prompt: string
}

export const CATALOG: Feature[] = [
  {
    id: 'claude-md',
    name: 'CLAUDE.md',
    what: 'A file Claude reads at the start of every session: commands, conventions, gotchas.',
    when: 'You keep repeating the same instructions.',
    prompt: 'Run /init, then trim the CLAUDE.md to what a new teammate would need.',
  },
  {
    id: 'hooks',
    name: 'Hooks',
    what: 'Commands the harness runs automatically on events (before/after a tool, on stop, on session start). Guaranteed, unlike a request in a prompt.',
    when: '"Every time you edit, run the formatter" / "never touch .env".',
    prompt: 'Create a PostToolUse hook in .claude/settings.json that runs my formatter after every Edit. Show me the JSON before saving and explain each field.',
  },
  {
    id: 'subagents',
    name: 'Subagents',
    what: 'Specialist helpers with their own context window and tool limits (.claude/agents/*.md).',
    when: 'Research, code review, or anything that would flood your main conversation.',
    prompt: 'Create a read-only "code-reviewer" subagent in .claude/agents/ that reviews my staged diff for bugs and style. Explain the frontmatter fields.',
  },
  {
    id: 'skills',
    name: 'Skills',
    what: 'Folders with a SKILL.md of instructions (plus scripts) Claude loads when relevant, or when you type /name. Community skills live at skills.sh.',
    when: 'A multi-step routine you do repeatedly.',
    prompt: 'Turn the routine I just did into a skill in .claude/skills/. Ask what should be an argument. Show the SKILL.md first.',
  },
  {
    id: 'commands',
    name: 'Slash commands',
    what: 'Markdown prompts in .claude/commands/ that you run as /name (skills have largely superseded them, but they are the simplest start).',
    when: 'A prompt you retype often.',
    prompt: 'Create .claude/commands/review.md so /review reviews my uncommitted changes.',
  },
  {
    id: 'design-md',
    name: 'DESIGN.md',
    what: 'Your design system in words: colors, type, spacing, component rules.',
    when: 'You build UI and want it consistent without re-explaining.',
    prompt: 'Inspect the UI and write DESIGN.md with tokens and component rules; reference it from CLAUDE.md.',
  },
  {
    id: 'mcp',
    name: 'MCP servers',
    what: 'Connectors that give Claude live access to tools and data: GitHub, Figma, databases, Slack…',
    when: 'You paste data from another app into the chat.',
    prompt: 'Which MCP servers fit the tools I use? Suggest two and give the exact commands. Do not install anything yet.',
  },
  {
    id: 'plan-mode',
    name: 'Plan mode',
    what: 'Shift+Tab until it says plan: Claude researches and proposes, but changes nothing until you approve.',
    when: 'Big or risky changes, or when you are unsure of the approach.',
    prompt: 'Switch to plan mode and plan how to add <feature>. List the files you would touch and the risks.',
  },
  {
    id: 'permissions',
    name: 'Permissions',
    what: 'Allow / ask / deny rules in settings so safe commands stop prompting and dangerous ones are blocked.',
    when: 'You approve the same command all day.',
    prompt: 'Run /fewer-permission-prompts, then show me what it would add.',
  },
  {
    id: 'loop',
    name: '/loop and scheduled tasks',
    what: 'Rerun a prompt every N minutes, or on a schedule even when you are away.',
    when: 'Watching CI, a deploy, or a daily report.',
    prompt: 'Check the status of my last CI run every 5 minutes and tell me when it finishes.',
  },
  {
    id: 'context',
    name: '/compact, /clear, /resume',
    what: 'Manage context: summarize a long chat, wipe between tasks, or pick an old session back up.',
    when: 'Claude gets slower or forgets earlier decisions.',
    prompt: '/compact keep the decisions and the list of files changed',
  },
  {
    id: 'plugins',
    name: 'Plugins',
    what: 'Bundles of skills, agents, hooks and MCP servers you install in one line — like this Suggestion Box.',
    when: 'You want something someone else already built.',
    prompt: '/plugin',
  },
]
