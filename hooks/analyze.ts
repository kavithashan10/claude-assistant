// Pure analysis: turns of conversation in, suggestions out. No I/O here, so it
// is easy to test and nothing leaves the machine.
import type { Report, Suggestion } from '../types'

export type Tool = { name: string; input: Record<string, unknown> }
export type Turn = {
  role: 'user' | 'assistant'
  text: string
  tools: Tool[]
  session: string
}
export type Setup = {
  claudeMd: boolean
  designMd: boolean
  hooks: boolean
  agents: number
  skills: number
  commands: number
  mcp: boolean
}

export const EMPTY_SETUP: Setup = {
  claudeMd: false,
  designMd: false,
  hooks: false,
  agents: 0,
  skills: 0,
  commands: 0,
  mcp: false,
}

// ---------------------------------------------------------------- parsing

const NOISE = /<system-reminder>[\s\S]*?<\/system-reminder>/g
const SKIP_PROMPT =
  /^\s*(<command-|<local-command|<task-notification|Caveat:|\[Request interrupted)/

export function cleanPrompt(text: string): string {
  return text.replace(NOISE, '').trim()
}

type Block = { type?: string; text?: string; name?: string; input?: unknown }

function blocksOf(content: unknown): Block[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (Array.isArray(content)) return content as Block[]
  return []
}

/** Reads the lines of a Claude Code transcript (.jsonl) into turns. */
export function parseTranscript(jsonl: string, session: string): Turn[] {
  const turns: Turn[] = []
  for (const line of jsonl.split('\n')) {
    if (line.length < 2 || line[0] !== '{') continue
    let row: {
      type?: string
      isMeta?: boolean
      message?: { content?: unknown }
    }
    try {
      row = JSON.parse(line)
    } catch {
      continue // a cut first line, or a row this reader does not know
    }
    if (row.isMeta) continue
    if (row.type !== 'user' && row.type !== 'assistant') continue
    const blocks = blocksOf(row.message?.content)
    const text = blocks
      .filter(b => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text as string)
      .join('\n')
    const tools: Tool[] = blocks
      .filter(b => b.type === 'tool_use' && typeof b.name === 'string')
      .map(b => ({
        name: b.name as string,
        input: (b.input ?? {}) as Record<string, unknown>,
      }))
    if (row.type === 'user') {
      const prompt = cleanPrompt(text)
      if (prompt === '' || SKIP_PROMPT.test(prompt)) continue
      turns.push({ role: 'user', text: prompt, tools: [], session })
    } else if (text !== '' || tools.length > 0) {
      turns.push({ role: 'assistant', text, tools, session })
    }
  }
  return turns
}

export type MessageRow = {
  role: 'user' | 'assistant'
  text: string
  toolUses: { tool: string; input: Record<string, unknown> }[]
}

/** The running session's own rows ($.session.messages()) as turns. */
export function fromMessages(rows: readonly MessageRow[], session: string): Turn[] {
  const turns: Turn[] = []
  for (const row of rows) {
    if (row.role === 'user') {
      const prompt = cleanPrompt(row.text)
      if (prompt === '' || SKIP_PROMPT.test(prompt)) continue
      turns.push({ role: 'user', text: prompt, tools: [], session })
    } else {
      turns.push({
        role: 'assistant',
        text: row.text,
        tools: row.toolUses.map(t => ({ name: t.tool, input: t.input })),
        session,
      })
    }
  }
  return turns
}

// ---------------------------------------------------------------- helpers

const clip = (s: string, n = 100): string => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}

const plural = (n: number, one: string, many = one + 's'): string =>
  `${n} ${n === 1 ? one : many}`

const MULTI = new Set([
  'git', 'npm', 'pnpm', 'yarn', 'bun', 'npx', 'gh', 'docker', 'cargo', 'go',
  'make', 'pip', 'uv', 'kubectl', 'terraform',
])

/** `cd app && npm run test -- --watch` -> `npm run test`. */
export function commandKey(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  let cmd = (raw.split('\n')[0] ?? '').trim()
  cmd = cmd.replace(/^cd\s+\S+\s*(&&|;)\s*/, '')
  cmd = cmd.split(/\s*(?:&&|\|\||\||;)\s*/)[0] ?? ''
  const t = cmd.split(/\s+/).filter(Boolean)
  const first = t[0]
  if (first === undefined || /^[A-Z_]+=/.test(first)) return undefined
  const name = first.replace(/^.*\//, '')
  if (!MULTI.has(name)) return name
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(name) && t[1] === 'run' && t[2])
    return `${name} run ${t[2]}`
  return t[1] && !t[1].startsWith('-') ? `${name} ${t[1]}` : name
}

const SAFE =
  /^(git (status|diff|log|show|branch)|ls|cat|grep|rg|find|head|tail|wc|pwd|which|tree|stat|(npm|pnpm|yarn|bun) (test|run (test|lint|build|typecheck|check))|pytest|cargo (check|test|clippy)|go (test|vet)|tsc|eslint|ruff)$/
const CHECK =
  /^(npm (test|run (test|lint|build|typecheck|check|format))|pnpm (test|run \w+)|yarn (test|\w+)|bun (test|run \w+)|pytest|python -m pytest|jest|vitest|tsc|eslint|prettier|ruff|black|mypy|cargo (test|check|fmt|clippy)|go (test|vet|fmt)|make (test|lint|check)|npx (jest|vitest|tsc|eslint|prettier))$/
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const READS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch'])

function count<T>(items: T[], key: (x: T) => string | undefined): Map<string, number> {
  const m = new Map<string, number>()
  for (const x of items) {
    const k = key(x)
    if (k) m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

const top = (m: Map<string, number>, n = 3): [string, number][] =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

// ---------------------------------------------------------------- detectors

type Ctx = {
  turns: Turn[]
  prompts: Turn[]
  tools: (Tool & { session: string })[]
  setup: Setup
  sessions: number
}

type Detector = (c: Ctx) => Suggestion | undefined

const HOOKY =
  /\b(from now on|every time|each time|whenever|after (every|each|you)|before (every|each|you) (commit|push|edit|run|finish))\b/i
const RULEY =
  /\b(always|never|don'?t ever|do not ever|make sure (you|to|that)|remember to|please don'?t|stop (doing|using|adding))\b/i

function sentenceWith(text: string, re: RegExp): string | undefined {
  for (const s of text.split(/(?<=[.!?\n])\s+/)) if (re.test(s)) return clip(s)
}

const hookFromWords: Detector = c => {
  const hits = c.prompts.flatMap(p => {
    const s = sentenceWith(p.text, HOOKY)
    return s ? [s] : []
  })
  if (hits.length < 2) return
  return {
    id: 'hook-from-words',
    kind: 'hook',
    title: 'Turn "every time…" requests into a hook',
    why: `You asked for something to happen automatically ${plural(hits.length, 'time')} ("every time", "from now on", "whenever"). A hook makes the harness do it for certain; a sentence in a prompt only lasts for one session.`,
    evidence: hits.slice(0, 3),
    make: 'A hook in .claude/settings.json (PreToolUse / PostToolUse / Stop / SessionStart)',
    prompt: `Look at these things I keep asking for by hand:\n${hits.slice(0, 3).map(h => `- ${h}`).join('\n')}\nPick the right hook event for each, write the hook into .claude/settings.json, and show me the diff before you save it. Explain in one line what each hook does.`,
    score: 70 + Math.min(hits.length, 10),
  }
}

const claudeMdRules: Detector = c => {
  const hits = c.prompts.flatMap(p => {
    if (HOOKY.test(p.text)) return []
    const s = sentenceWith(p.text, RULEY)
    return s ? [s] : []
  })
  if (hits.length < 2) return
  return {
    id: 'claude-md-rules',
    kind: 'claude-md',
    title: `Save ${plural(hits.length, 'repeated rule')} in CLAUDE.md`,
    why: 'You keep telling Claude the same preferences ("always…", "never…", "make sure…"). CLAUDE.md is read at the start of every session, so you say it once.',
    evidence: hits.slice(0, 3),
    make: 'Rules in CLAUDE.md (project) or ~/.claude/CLAUDE.md (every project)',
    prompt: `Add these standing rules to CLAUDE.md, grouped under short headings, one line each. Put project-specific ones in ./CLAUDE.md and personal ones in ~/.claude/CLAUDE.md:\n${hits.slice(0, 5).map(h => `- ${h}`).join('\n')}`,
    score: 62 + Math.min(hits.length, 10),
  }
}

const formatAfterEdit: Detector = c => {
  // An edit, then a test/lint/format command within the next 4 tool calls.
  const hits: string[] = []
  const bySession = new Map<string, Tool[]>()
  for (const t of c.tools) {
    const list = bySession.get(t.session) ?? []
    list.push(t)
    bySession.set(t.session, list)
  }
  for (const list of bySession.values()) {
    let since = 99
    for (const t of list) {
      if (EDITS.has(t.name)) since = 0
      else {
        since++
        if (t.name === 'Bash' && since <= 4) {
          const k = commandKey(t.input.command)
          if (k && CHECK.test(k)) hits.push(k)
        }
      }
    }
  }
  if (hits.length < 3) return
  const lead = top(count(hits, x => x), 1)[0]
  if (!lead) return
  const [cmd, n] = lead
  return {
    id: 'hook-post-edit',
    kind: 'hook',
    title: `Auto-run \`${cmd}\` after edits`,
    why: `Claude ran checks like \`${cmd}\` right after editing files ${plural(hits.length, 'time')} (${n}× that exact one). A PostToolUse hook runs it after every edit without anyone asking.`,
    evidence: top(count(hits, x => x)).map(([k, v]) => `${k} — ${v}×`),
    make: 'A PostToolUse hook matching Edit|Write in .claude/settings.json',
    prompt: `Create a PostToolUse hook in .claude/settings.json that runs \`${cmd}\` after Edit and Write tool calls. If it fails, the hook should print the error so Claude sees it. Keep it fast (only touch the changed file if the tool supports that). Show me the JSON before saving.`,
    score: 78 + Math.min(hits.length, 10),
  }
}

const allowlist: Detector = c => {
  const keys = c.tools.flatMap(t =>
    t.name === 'Bash' ? [commandKey(t.input.command) ?? ''] : [],
  )
  const safe = keys.filter(k => k && SAFE.test(k))
  const counts = top(count(safe, x => x), 8)
  if (safe.length < 12 || counts.length < 3) return
  return {
    id: 'permissions-allowlist',
    kind: 'permissions',
    title: 'Stop approving the same safe commands',
    why: `${plural(safe.length, 'read-only or check command')} ran across ${plural(counts.length, 'distinct kind')}. Allow-listing them in settings removes the permission prompts.`,
    evidence: counts.map(([k, v]) => `${k} — ${v}×`),
    make: 'permissions.allow rules in .claude/settings.json',
    prompt: `Run /fewer-permission-prompts. If it isn't available, add these to permissions.allow in .claude/settings.json as Bash(...) rules: ${counts.map(([k]) => k).join(', ')}.`,
    score: 55 + Math.min(Math.floor(safe.length / 4), 15),
  }
}

const repeatedPrompt: Detector = c => {
  const key = (p: Turn): string | undefined => {
    const words = p.text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
    if (words.length < 4 || p.text.startsWith('/')) return undefined
    return words.slice(0, 5).join(' ')
  }
  const groups = new Map<string, Turn[]>()
  for (const p of c.prompts) {
    const k = key(p)
    if (k) groups.set(k, [...(groups.get(k) ?? []), p])
  }
  const best = [...groups.entries()]
    .filter(([, g]) => g.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)[0]
  if (!best) return
  const [k, g] = best
  return {
    id: 'skill-repeated-prompt',
    kind: 'skill',
    title: `Make "${clip(k, 40)}…" a reusable skill or command`,
    why: `You started ${plural(g.length, 'prompt')} with nearly the same words. A skill (or a /slash command) packages that routine so you type one word and Claude follows the full steps every time.`,
    evidence: g.slice(0, 3).map(p => clip(p.text)),
    make: 'A skill in .claude/skills/<name>/SKILL.md, or a command in .claude/commands/<name>.md',
    prompt: `I often send prompts like this:\n${g.slice(0, 3).map(p => `- ${clip(p.text, 160)}`).join('\n')}\nTurn this routine into a skill in .claude/skills/. Ask me for anything that varies between runs and make that an argument. Show me the SKILL.md before saving. (You can also browse ready-made skills at skills.sh.)`,
    score: 66 + Math.min(g.length, 12),
  }
}

const gitFlow: Detector = c => {
  const keys = c.tools.flatMap(t =>
    t.name === 'Bash' ? [commandKey(t.input.command) ?? ''] : [],
  )
  const ship = keys.filter(k => k === 'git commit' || k === 'git push' || k === 'gh pr')
  if (ship.length < 4) return
  return {
    id: 'command-ship',
    kind: 'command',
    title: 'One command for commit → push → PR',
    why: `Claude ran ${plural(ship.length, 'commit/push/PR command')}. A custom slash command can hold your exact conventions (branch names, message style, PR template).`,
    evidence: top(count(ship, x => x)).map(([k, v]) => `${k} — ${v}×`),
    make: 'A command in .claude/commands/ship.md',
    prompt: `Create .claude/commands/ship.md. When I run /ship it should: show git status and diff, write a conventional-commit message, commit, push the branch, and open a PR with a short summary. Ask me before pushing. Use my usual style from the recent commits in this repo (check git log).`,
    score: 58,
  }
}

const research: Detector = c => {
  const reads = c.tools.filter(t => READS.has(t.name)).length
  if (reads < 40 || reads / Math.max(c.tools.length, 1) < 0.5) return
  return {
    id: 'subagent-research',
    kind: 'subagent',
    title: 'Send reading-heavy work to a subagent',
    why: `${reads} of your ${c.tools.length} tool calls were reading or searching. Subagents do that in their own context window and bring back only a summary, so your main conversation stays small and sharp.`,
    evidence: top(count(c.tools.filter(t => READS.has(t.name)), t => t.name)).map(
      ([k, v]) => `${k} — ${v}×`,
    ),
    make: 'A subagent in .claude/agents/<name>.md (or just ask for the built-in Explore agent)',
    prompt: `Create a subagent in .claude/agents/ called "code-scout": read-only tools (Read, Grep, Glob), and it answers "where is X implemented and how does it work?" with file paths and a 5-line summary. Then, in future, tell me when to delegate to it.`,
    score: 60,
  }
}

const longSessions: Detector = c => {
  const per = count(c.prompts, p => p.session)
  const long = [...per.entries()].filter(([, n]) => n >= 40)
  if (long.length === 0) return
  return {
    id: 'context-hygiene',
    kind: 'workflow',
    title: 'Keep long sessions from getting foggy',
    why: `${plural(long.length, 'session')} went past 40 prompts. Long conversations fill the context window and quality drops. Use /compact to summarize, /clear between unrelated tasks, and subagents for side quests.`,
    evidence: long.slice(0, 3).map(([, n]) => `${n} prompts in one session`),
    make: 'A habit — plus an optional hook or note in CLAUDE.md',
    prompt: `Add a short "Working style" section to CLAUDE.md: when a task is finished, summarize and suggest /clear; keep exploratory research in subagents; ask me before reading more than ~10 files for a single question.`,
    score: 50,
  }
}

const DESIGN =
  /\b(css|tailwind|ui|ux|layout|design|figma|colou?rs?|fonts?|responsive|landing page|styling|dark mode|theme|spacing)\b/i
const designMd: Detector = c => {
  if (c.setup.designMd) return
  const hits = c.prompts.filter(p => DESIGN.test(p.text))
  if (hits.length < 4) return
  return {
    id: 'design-md',
    kind: 'design-md',
    title: 'Write a DESIGN.md so UI work looks consistent',
    why: `${plural(hits.length, 'prompt')} were about look and feel. A DESIGN.md (colors, type scale, spacing, component rules) gives Claude your design system once, instead of re-describing it every time.`,
    evidence: hits.slice(0, 3).map(p => clip(p.text)),
    make: 'DESIGN.md in the project root, referenced from CLAUDE.md',
    prompt: `Look at the existing UI in this project and write DESIGN.md: color tokens, typography, spacing scale, border radius, button/input/card patterns, and dos & don'ts. Then add "Follow DESIGN.md for all UI work" to CLAUDE.md.`,
    score: 64,
  }
}

const SERVICES: [string, RegExp][] = [
  ['GitHub', /\bgithub\b|\bpull request\b|\bPRs?\b/i],
  ['Slack', /\bslack\b/i],
  ['Linear', /\blinear\b/i],
  ['Jira', /\bjira\b/i],
  ['Notion', /\bnotion\b/i],
  ['Figma', /\bfigma\b/i],
  ['Sentry', /\bsentry\b/i],
  ['a database', /\b(postgres|mysql|sqlite|supabase|database)\b/i],
  ['Google Drive', /\b(google drive|gdrive)\b/i],
]
const mcp: Detector = c => {
  if (c.setup.mcp) return
  const found = SERVICES.map(([name, re]) => ({
    name,
    n: c.prompts.filter(p => re.test(p.text)).length,
  }))
    .filter(x => x.n >= 3)
    .sort((a, b) => b.n - a.n)
  if (found.length === 0) return
  const f = found[0]
  if (!f) return
  return {
    id: 'mcp-' + f.name.toLowerCase().replace(/\W+/g, '-'),
    kind: 'mcp',
    title: `Connect ${f.name} with an MCP server`,
    why: `You mentioned ${f.name} in ${plural(f.n, 'prompt')}. An MCP server lets Claude read and act in it directly instead of you pasting things back and forth.`,
    evidence: found.slice(0, 3).map(x => `${x.name} — ${plural(x.n, 'prompt')}`),
    make: 'An MCP server (claude mcp add …, or /plugin for a packaged one)',
    prompt: `Help me connect ${f.name} to Claude Code. Find the recommended MCP server or plugin for it, explain what access it needs, and give me the exact command to add it. Don't add it until I confirm.`,
    score: 56,
  }
}

const CORRECT = /^\s*(no[,.! ]|nope|wrong|that'?s not|not what|don'?t|stop|undo|revert|actually[, ])/i
const corrections: Detector = c => {
  const hits = c.prompts.filter(p => CORRECT.test(p.text) && p.text.length < 400)
  if (hits.length < 3) return
  return {
    id: 'corrections',
    kind: 'workflow',
    title: 'Fewer "no, not like that" — plan first',
    why: `${plural(hits.length, 'prompt')} opened by correcting Claude. For bigger changes, plan mode (Shift+Tab) makes Claude propose the approach before touching files, and a CLAUDE.md note captures what it keeps getting wrong.`,
    evidence: hits.slice(0, 3).map(p => clip(p.text)),
    make: 'Plan mode habit + CLAUDE.md notes (or a PreToolUse hook to block a specific mistake)',
    prompt: `Here are things I had to correct:\n${hits.slice(0, 3).map(p => `- ${clip(p.text, 140)}`).join('\n')}\nFor each, say whether a CLAUDE.md rule or a hook would prevent it, then add the right one.`,
    score: 57,
  }
}

const REPEAT_TASK =
  /\b(every \d+ ?(min|minute|hour)s?|daily|every (day|morning|hour)|keep checking|check again|poll)\b/i
const loops: Detector = c => {
  const hits = c.prompts.filter(p => REPEAT_TASK.test(p.text))
  if (hits.length < 2) return
  return {
    id: 'loop-schedule',
    kind: 'workflow',
    title: 'Let Claude repeat checks on a schedule',
    why: `${plural(hits.length, 'prompt')} asked for something recurring ("every…", "keep checking"). /loop reruns a prompt on an interval, and scheduled tasks run it even when you're away.`,
    evidence: hits.slice(0, 3).map(p => clip(p.text)),
    make: '/loop (in-session) or a scheduled task (runs on its own)',
    prompt: `Set up a recurring check for: ${clip(hits[0]?.text ?? '', 140)}. Use /loop if it only matters while I'm here, otherwise propose a scheduled task. Tell me which you chose and why.`,
    score: 52,
  }
}

const noClaudeMd: Detector = c => {
  if (c.setup.claudeMd) return
  return {
    id: 'init-claude-md',
    kind: 'claude-md',
    title: 'Create a CLAUDE.md for this project',
    why: 'No CLAUDE.md was found here. It is the single highest-value file: build/test commands, conventions and gotchas that Claude reads at the start of every session.',
    evidence: [],
    make: 'CLAUDE.md in the project root',
    prompt: 'Run /init to generate a CLAUDE.md for this project, then trim it to what a new teammate would actually need.',
    score: 72,
  }
}

const noHelpers: Detector = c => {
  const s = c.setup
  if (!s.claudeMd || s.hooks || s.agents + s.skills + s.commands > 0) return
  if (c.prompts.length < 10) return
  return {
    id: 'first-helpers',
    kind: 'skill',
    title: 'You have no hooks, subagents or skills yet',
    why: 'You use Claude Code regularly but nothing is automated. Start with one tiny hook or skill — you learn the format and it pays back immediately.',
    evidence: [],
    make: 'Your first skill (easiest) or hook',
    prompt: 'Look at how I have used Claude Code in this project. Suggest ONE small skill I would use weekly, write it in .claude/skills/, and explain each part of the SKILL.md so I can write the next one myself.',
    score: 45,
  }
}

const DETECTORS: Detector[] = [
  noClaudeMd, hookFromWords, formatAfterEdit, repeatedPrompt, claudeMdRules,
  designMd, research, gitFlow, corrections, mcp, allowlist, loops,
  longSessions, noHelpers,
]

export function analyze(
  turns: Turn[],
  setup: Setup,
  extra: { sources: string[]; notes: string[] },
  now: number,
): Report {
  const prompts = turns.filter(t => t.role === 'user')
  const tools = turns.flatMap(t => t.tools.map(x => ({ ...x, session: t.session })))
  const sessions = new Set(turns.map(t => t.session)).size
  const ctx: Ctx = { turns, prompts, tools, setup, sessions }
  const suggestions = DETECTORS.flatMap(d => {
    const s = d(ctx)
    return s ? [s] : []
  }).sort((a, b) => b.score - a.score)
  return {
    generatedAt: now,
    sessions,
    prompts: prompts.length,
    sources: extra.sources,
    notes: extra.notes,
    suggestions,
  }
}
