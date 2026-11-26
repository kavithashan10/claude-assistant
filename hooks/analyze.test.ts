import { expect, test } from 'claude-code/testing'

import { analyze, commandKey, EMPTY_SETUP, fromMessages, parseTranscript } from './analyze'

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
  const ids = analyze(turns, { ...EMPTY_SETUP, claudeMd: true }, { sources: [], notes: [] }, 0)
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
  const report = analyze(turns, EMPTY_SETUP, { sources: [], notes: [] }, 0)
  expect(report.suggestions.map(s => s.id)).toContain('init-claude-md')
})

test('no sessions, no crash', () => {
  const report = analyze([], { ...EMPTY_SETUP, claudeMd: true }, { sources: [], notes: [] }, 0)
  expect(report.suggestions).toEqual([])
})
