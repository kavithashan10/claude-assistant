import { expect, test } from 'claude-code/testing'

import {
  analyze,
  commandKey,
  detectProject,
  EMPTY_PROJECT,
  EMPTY_SETUP,
  fromMessages,
  parseTranscript,
} from './analyze'

const line = (o: unknown) => JSON.stringify(o)
const user = (text: string) => line({ type: 'user', message: { role: 'user', content: text } })
const asst = (...tools: [string, Record<string, unknown>][]) =>
  line({
    type: 'assistant',
    message: { content: tools.map(([name, input]) => ({ type: 'tool_use', name, input })) },
  })

test('commandKey keeps the meaningful part of a command', () => {
  expect(commandKey('cd app && npm run test -- --watch')).toBe('npm run test')
  expect(commandKey('git status -sb | head')).toBe('git status')
  expect(commandKey('FOO=1 ls')).toBe(undefined)
})

test('transcripts: tool results and system rows are not prompts', () => {
  const turns = parseTranscript(
    [
      'half a line',
      user('always use tabs'),
      line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }),
      user('<command-name>/clear</command-name>'),
      line({ type: 'user', isMeta: true, message: { content: 'meta' } }),
      asst(['Bash', { command: 'ls' }]),
    ].join('\n'),
    's1',
  )
  expect(turns.map(t => t.role)).toEqual(['user', 'assistant'])
  expect(turns[1]?.tools[0]?.name).toBe('Bash')
})

test('"every time" and "always" become a hook and a CLAUDE.md suggestion', () => {
  const turns = parseTranscript(
    [
      user('From now on run the formatter. Thanks.'),
      user('Every time you finish, run the tests'),
      user('Always use pnpm here'),
      user("Never add comments to my code, and make sure to keep lines short"),
    ].join('\n'),
    's1',
  )
  const ids = analyze(turns, { ...EMPTY_SETUP, claudeMd: true }, EMPTY_PROJECT, { sources: [], notes: [] }, 0)
    .suggestions.map(s => s.id)
  expect(ids).toContain('hook-from-words')
  expect(ids).toContain('claude-md-rules')
})

test('edit then test, three times, suggests a PostToolUse hook', () => {
  const run = [1, 2, 3].flatMap(() => [
    asst(['Edit', { file_path: 'a.ts' }]),
    asst(['Bash', { command: 'npm test' }]),
  ])
  const report = analyze(
    parseTranscript(run.join('\n'), 's1'),
    { ...EMPTY_SETUP, claudeMd: true },
    EMPTY_PROJECT,
    { sources: [], notes: [] },
    0,
  )
  expect(report.suggestions[0]?.id).toBe('hook-post-edit')
})

test('a missing CLAUDE.md is suggested first-class, and the current session counts', () => {
  const turns = fromMessages(
    [{ role: 'user', text: 'hello <system-reminder>x</system-reminder>', toolUses: [] }],
    'now',
  )
  expect(turns[0]?.text).toBe('hello')
  const report = analyze(turns, EMPTY_SETUP, EMPTY_PROJECT, { sources: [], notes: [] }, 0)
  expect(report.suggestions.map(s => s.id)).toContain('init-claude-md')
})

test('no sessions, no crash', () => {
  const report = analyze([], { ...EMPTY_SETUP, claudeMd: true }, EMPTY_PROJECT, { sources: [], notes: [] }, 0)
  expect(report.suggestions).toEqual([])
})

const NEXT_APP = detectProject(
  'shop',
  {
    'package.json': JSON.stringify({
      name: 'shop',
      scripts: { test: 'vitest', lint: 'eslint .', dev: 'next dev', build: 'next build' },
      dependencies: { next: '14', react: '18', tailwindcss: '3', '@prisma/client': '5' },
      devDependencies: { typescript: '5', vitest: '1' },
    }),
  },
  ['package.json', 'pnpm-lock.yaml', '.env', '.env.local', 'prisma', '.github', 'tsconfig.json'],
)

test('a project is recognised: stack, package manager, real commands, risks', () => {
  expect(NEXT_APP.stacks).toEqual(expect.arrayContaining(['TypeScript', 'Next.js', 'Tailwind', 'Prisma']))
  expect(NEXT_APP.pm).toBe('pnpm')
  expect(NEXT_APP.scripts.test).toBe('pnpm test')
  expect(NEXT_APP.scripts.lint).toBe('pnpm run lint')
  expect(NEXT_APP.hasEnv).toBe(true)
  expect(NEXT_APP.hasDb).toBe(true)
  expect(NEXT_APP.hasFrontend).toBe(true)
})

test('suggestions use the project: its lint command, .env guard, DB guard', () => {
  const report = analyze([], { ...EMPTY_SETUP, claudeMd: true }, NEXT_APP, { sources: [], notes: [] }, 0)
  const byId = Object.fromEntries(report.suggestions.map(s => [s.id, s]))
  expect(byId['hook-project-checks']?.title).toContain('pnpm run lint')
  expect(byId['hook-protect-env']).toBeTruthy()
  expect(byId['hook-protect-migrations']).toBeTruthy()
  expect(report.project).toContain('Next.js')
})

test('a CLAUDE.md that never mentions the test command is flagged', () => {
  const stale = analyze([], { ...EMPTY_SETUP, claudeMd: true, claudeMdText: '# Shop\nBe nice.' }, NEXT_APP, { sources: [], notes: [] }, 0)
  expect(stale.suggestions.map(s => s.id)).toContain('claude-md-commands')
  const fine = analyze([], { ...EMPTY_SETUP, claudeMd: true, claudeMdText: 'Run pnpm test' }, NEXT_APP, { sources: [], notes: [] }, 0)
  expect(fine.suggestions.map(s => s.id)).not.toContain('claude-md-commands')
})

test('files edited again and again become a nested CLAUDE.md suggestion', () => {
  const edits = Array.from({ length: 9 }, (_, i) =>
    asst(['Edit', { file_path: `/work/shop/src/cart/file${i}.ts` }]),
  )
  const report = analyze(
    parseTranscript(edits.join('\n'), 's1'),
    { ...EMPTY_SETUP, claudeMd: true },
    EMPTY_PROJECT,
    { sources: [], notes: [], cwd: '/work/shop' },
    0,
  )
  const hot = report.suggestions.find(s => s.id === 'claude-md-hot-areas')
  expect(hot?.title).toBe('Give src/cart/ its own CLAUDE.md')
})
