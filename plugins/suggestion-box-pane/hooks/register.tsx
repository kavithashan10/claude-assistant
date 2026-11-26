import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Report, Suggestion } from '../types'
import { CATALOG } from './catalog'
import {
  analyze,
  detectProject,
  EMPTY_PROJECT,
  EMPTY_SETUP,
  fromMessages,
  parseTranscript,
  type Project,
  type Setup,
  type Turn,
} from './analyze'

const PANE = 'suggestion-box-pane'
const MAX_HERE = 40 // newest past sessions of THIS project, read whole
const MAX_ELSEWHERE = 12 // newest sessions of other projects (your habits)
const CHUNK = 3_000_000 // bytes per read (a read may not exceed 4 MiB)
const BUDGET = 120_000_000 // bytes read in one scan, all files together
const ROOT_FILES = [
  'package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml',
  'go.mod', 'Gemfile', 'composer.json', 'pom.xml',
]
const RESCAN_MS = 5 * 60_000

const report = atom({ plugin: 'suggestion-box-pane', key: 'report' } as const, null as Report | null, {
  shape: 'report-2',
})
const tab = atom({ plugin: 'suggestion-box-pane', key: 'tab' } as const, 'suggest' as 'suggest' | 'learn', {
  shape: 'tab-1',
})
const open = atom({ plugin: 'suggestion-box-pane', key: 'open' } as const, '', {
  shape: 'open-1',
})
const dismissed = atom({ plugin: 'suggestion-box-pane', key: 'dismissed' } as const, [] as string[], {
  shape: 'dismissed-1',
})
const busy = atom({ plugin: 'suggestion-box-pane', key: 'busy' } as const, false, {
  shape: 'busy-1',
})

type Engine = EngineInterface

// ------------------------------------------------------------------ scanning

async function exists($: Engine, path: string): Promise<boolean> {
  try {
    return await $.fs.exists(path)
  } catch {
    return false
  }
}

async function countIn($: Engine, dir: string, dirsOnly: boolean): Promise<number> {
  try {
    const list = await $.fs.list(dir)
    return list.filter(e => (dirsOnly ? e.kind === 'dir' : e.name.endsWith('.md'))).length
  } catch {
    return 0
  }
}

async function readJson($: Engine, path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await $.fs.read(path)) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function detectSetup($: Engine, home: string, cwd: string): Promise<Setup> {
  const settings = await Promise.all(
    [`${cwd}/.claude/settings.json`, `${cwd}/.claude/settings.local.json`, `${home}/.claude/settings.json`].map(p =>
      readJson($, p),
    ),
  )
  const has = (k: string) => settings.some(s => s[k] && Object.keys(s[k] as object).length > 0)
  const [a1, a2, s1, s2, c1, c2] = await Promise.all([
    countIn($, `${cwd}/.claude/agents`, false),
    countIn($, `${home}/.claude/agents`, false),
    countIn($, `${cwd}/.claude/skills`, true),
    countIn($, `${home}/.claude/skills`, true),
    countIn($, `${cwd}/.claude/commands`, false),
    countIn($, `${home}/.claude/commands`, false),
  ])
  let claudeMdText = ''
  for (const p of [`${cwd}/CLAUDE.md`, `${cwd}/.claude/CLAUDE.md`]) {
    if (await exists($, p)) {
      claudeMdText = (await $.fs.read(p, { length: 40_000 }).catch(() => '')) || ' '
      break
    }
  }
  return {
    claudeMdText,
    claudeMd:
      claudeMdText !== '' || (await exists($, `${home}/.claude/CLAUDE.md`)),
    designMd: await exists($, `${cwd}/DESIGN.md`),
    hooks: has('hooks'),
    agents: a1 + a2,
    skills: s1 + s2,
    commands: c1 + c2,
    mcp: (await exists($, `${cwd}/.mcp.json`)) || has('mcpServers'),
  }
}

async function detectProjectAt($: Engine, cwd: string): Promise<Project> {
  try {
    const entries = (await $.fs.list(cwd)).map(e => e.name)
    const files: Record<string, string | undefined> = {}
    for (const f of ROOT_FILES)
      if (entries.includes(f)) files[f] = await $.fs.read(`${cwd}/${f}`, { length: 200_000 }).catch(() => undefined)
    return detectProject(cwd.split('/').filter(Boolean).pop() ?? '', files, entries)
  } catch {
    return EMPTY_PROJECT
  }
}

/** Reads a transcript from its first byte to its last, a chunk at a time. */
async function readWhole($: Engine, path: string, size: number, turnsOut: Turn[]): Promise<number> {
  let carry = ''
  let used = 0
  for (let offset = 0; offset < size; offset += CHUNK) {
    const text = carry + (await $.fs.read(path, { offset, length: CHUNK }))
    used += Math.min(CHUNK, size - offset)
    const cut = text.lastIndexOf('\n')
    turnsOut.push(...parseTranscript(text.slice(0, Math.max(cut, 0)), path))
    carry = cut >= 0 ? text.slice(cut + 1) : text
  }
  if (carry) turnsOut.push(...parseTranscript(carry, path))
  return used
}

async function scan($: Engine): Promise<Report> {
  const notes: string[] = []
  const sources: string[] = []
  const turns: Turn[] = []
  const home = (await $.env.get('HOME')) ?? ''
  const cwd = await $.session.cwd()
  const sid = await $.session.id()

  // 1. this session
  try {
    const rows = await $.session.messages()
    if (!('deny' in rows)) {
      turns.push(...fromMessages(rows, sid))
      sources.push('this session')
    }
  } catch (err) {
    notes.push(`Could not read this session: ${String(err)}`)
  }

  // 2. past sessions: ~/.claude/projects/<project>/<session>.jsonl, read whole.
  // This project's own sessions come first; a few from other projects show habits.
  const here = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  let nHere = 0
  let nElse = 0
  try {
    const root = `${home}/.claude/projects`
    const mine: { path: string; mtimeMs: number; size: number }[] = []
    const others: typeof mine = []
    for (const dir of await $.fs.list(root)) {
      if (dir.kind !== 'dir') continue
      try {
        for (const f of await $.fs.list(`${root}/${dir.name}`)) {
          if (f.kind !== 'file' || !f.name.endsWith('.jsonl') || f.name.startsWith(sid)) continue
          ;(dir.name === here ? mine : others).push({
            path: `${root}/${dir.name}/${f.name}`,
            mtimeMs: f.mtimeMs,
            size: f.size,
          })
        }
      } catch {
        // an unreadable project folder is skipped
      }
    }
    const newest = (l: typeof mine, n: number) => l.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, n)
    let budget = BUDGET
    for (const [list, isHere] of [[newest(mine, MAX_HERE), true], [newest(others, MAX_ELSEWHERE), false]] as const) {
      for (const f of list) {
        if (budget <= 0) {
          notes.push('Stopped early: very large history. Oldest sessions were skipped.')
          break
        }
        try {
          budget -= await readWhole($, f.path, f.size, turns)
          if (isHere) nHere++
          else nElse++
        } catch {
          // skip a file that cannot be read
        }
      }
    }
    if (nHere + nElse > 0)
      sources.push(`${nHere} past ${nHere === 1 ? 'session' : 'sessions'} of this project`)
    if (nElse > 0) sources.push(`${nElse} from other projects`)
    if (nHere + nElse === 0) notes.push(`No past sessions found in ${root}.`)
  } catch (err) {
    notes.push(
      'Past sessions are not readable from here (' +
        String(err).slice(0, 80) +
        '). Install this plugin in Claude Code on your own computer to include them.',
    )
  }

  const setup = await detectSetup($, home, cwd).catch(() => EMPTY_SETUP)
  const project = await detectProjectAt($, cwd)
  return analyze(turns, setup, project, { sources, notes, cwd, thisProject: nHere }, Date.now())
}

async function refresh($: Engine): Promise<Report | null> {
  if (await read($, busy)) return read($, report)
  await update($, busy, () => true)
  try {
    const next = await scan($)
    await update($, report, () => next)
    const gone = new Set(await read($, dismissed))
    const live = next.suggestions.filter(s => !gone.has(s.id)).length
    $.ui.status(live > 0 ? `💡 ${live} suggestion${live === 1 ? '' : 's'}` : undefined)
    return next
  } finally {
    await update($, busy, () => false)
  }
}

// ------------------------------------------------------------------ the hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'suggestions',
      description: 'Open the Suggestion Box: ideas for hooks, subagents and skills from your sessions',
    })
    try {
      const saved = await $.store.get('dismissed')
      if (Array.isArray(saved)) await update($, dismissed, () => saved as string[])
    } catch {
      // the store can be empty or unavailable
    }
    void $.ui.open({ id: PANE, title: 'Suggestion Box' })
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'suggestions' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Suggestion Box' })
    const r = await refresh($)
    const gone = new Set(await read($, dismissed))
    const list = (r?.suggestions ?? []).filter(s => !gone.has(s.id)).slice(0, 5)
    return {
      text:
        list.length === 0
          ? 'Suggestion Box: nothing to suggest yet. Keep working and check back.'
          : 'Suggestion Box:\n' + list.map((s, i) => `${i + 1}. [${s.kind}] ${s.title}`).join('\n'),
    }
  })

  // Look again after a turn, at most every few minutes.
  on('turn.complete', async ($, e, next) => {
    const last = (await read($, report))?.generatedAt ?? 0
    if (e.agentId === undefined && Date.now() - last > RESCAN_MS) void refresh($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const r = await read($, report)
    const current = await read($, tab)
    const openId = await read($, open)
    const gone = new Set(await read($, dismissed))
    const isBusy = await read($, busy)
    const list = (r?.suggestions ?? []).filter(s => !gone.has(s.id))

    const pick = (t: 'suggest' | 'learn') => () => update($, tab, () => t)
    const fill = (text: string) => async () => {
      const done = await $.prompt.fill({ text })
      $.ui.toast(done.isFilled ? 'Prompt ready — press Enter to send it.' : 'Close the dialog first.')
    }
    const copy = (text: string) => (p: { surface: never }) =>
      $.ui.copy({ text, surface: p.surface })
    const dismiss = (id: string) => async () => {
      const ids = [...(await read($, dismissed)), id]
      await update($, dismissed, () => ids)
      await $.store.set('dismissed', ids)
    }
    const toggle = (id: string) => () => update($, open, o => (o === id ? '' : id))

    const detail = (s: Suggestion) => (
      <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
        <Text>{s.why}</Text>
        {s.evidence.map((x, i) => (
          <Text key={`ev${i}`} dimColor>
            · {x}
          </Text>
        ))}
        <Text bold>Create: {s.make}</Text>
        <Text bold>Then tell Claude:</Text>
        <Text dimColor>{s.prompt}</Text>
        <Box>
          <Button key={`fill:${s.id}`} variant="primary" onPress={fill(s.prompt)}>
            Put in my prompt
          </Button>
          <Text> </Text>
          <Button key={`copy:${s.id}`} onPress={copy(s.prompt) as never}>
            Copy
          </Button>
          <Text> </Text>
          <Button key={`dismiss:${s.id}`} dimColor onPress={dismiss(s.id)}>
            Dismiss
          </Button>
        </Box>
      </Box>
    )

    const ago = r ? Math.max(0, Math.round((Date.now() - r.generatedAt) / 60000)) : 0

    return (
      <Box flexDirection="column">
        <Box>
          <Button key="tab:suggest" hotkey="s" variant={current === 'suggest' ? 'primary' : 'secondary'} onPress={pick('suggest')}>
            {`Suggestions (${list.length})`}
          </Button>
          <Text> </Text>
          <Button key="tab:learn" hotkey="l" variant={current === 'learn' ? 'primary' : 'secondary'} onPress={pick('learn')}>
            Learn
          </Button>
          <Text> </Text>
          <Button key="refresh" hotkey="r" dimColor onPress={() => void refresh($)}>
            {isBusy ? 'Reading…' : 'Refresh'}
          </Button>
        </Box>
        <Text dimColor>
          {r
            ? `Read ${r.prompts} prompts from ${r.sources.join(' + ') || 'nothing yet'} · ${ago === 0 ? 'just now' : `${ago} min ago`}`
            : 'Reading your sessions…'}
        </Text>
        {r && r.project !== '' && <Text>Project: {r.project}</Text>}
        {r?.stats.map((x, i) => (
          <Text key={`stat${i}`} dimColor>
            {x}
          </Text>
        ))}
        {r?.notes.map((n, i) => (
          <Text key={`note${i}`} dimColor>
            ! {n}
          </Text>
        ))}
        <Text> </Text>

        {current === 'suggest' && (
          <Box flexDirection="column">
            {list.length === 0 && (
              <Text dimColor>
                {r ? 'Nothing to suggest yet — keep working and I will keep watching.' : ' '}
              </Text>
            )}
            {list.map(s => (
              <Box key={`row:${s.id}`} flexDirection="column">
                <Button key={`open:${s.id}`} onPress={toggle(s.id)}>
                  {`${openId === s.id ? '▾' : '▸'} [${s.kind}] ${s.title}`}
                </Button>
                {openId === s.id && detail(s)}
              </Box>
            ))}
          </Box>
        )}

        {current === 'learn' && (
          <Box flexDirection="column">
            <Text dimColor>Things Claude Code can do. Open one, then put its prompt in the box.</Text>
            {CATALOG.map(f => (
              <Box key={`lrow:${f.id}`} flexDirection="column">
                <Button key={`lopen:${f.id}`} onPress={toggle('learn:' + f.id)}>
                  {`${openId === 'learn:' + f.id ? '▾' : '▸'} ${f.name}`}
                </Button>
                {openId === 'learn:' + f.id && (
                  <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
                    <Text>{f.what}</Text>
                    <Text bold>Use it when: {f.when}</Text>
                    <Text dimColor>{f.prompt}</Text>
                    <Box>
                      <Button key={`lfill:${f.id}`} variant="primary" onPress={fill(f.prompt)}>
                        Put in my prompt
                      </Button>
                      <Text> </Text>
                      <Button key={`lcopy:${f.id}`} onPress={copy(f.prompt) as never}>
                        Copy
                      </Button>
                    </Box>
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
