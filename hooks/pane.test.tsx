import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'suggestion-box',
  component: 'Pane',
  requestId: 'suggestion-box',
  props: {
    title: 'Suggestion Box',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('the pane draws and the Learn tab lists features, on every surface', async $ => {
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Reading your sessions/ })).toBeTruthy()
    await ui.unmount()
  }
})
