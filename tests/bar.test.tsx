import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const BAND = {
  plugin: 'prompt-status',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 160,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

// Nothing sits beneath the plugin: each hook here stands for the engine.
const engine = (on: On) => {
  on('session.root', () => ({ value: '/Users/me/Desktop/ai-projects/claude-mods-sandbox' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }))
  on('settings.read', () => ({
    value: {
      effortLevel: 'high',
      modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } },
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
}

const lineOf = async ($: Engine) => {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const line = await ui.find({ type: 'Text', text: /claude-mods-sandbox/ })
  await ui.unmount()

  return line?.text ?? ''
}

test('before the first prompt: the directory, the model and its settings effort', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const line = await lineOf($)
  expect(line).toContain('claude-mods-sandbox')
  expect(line).toContain('ctx --/200k')
  expect(line).toContain('送信後に表示')
  expect(line).toContain('Opus 5.5 · xhigh')
})

test('after a turn: the context fill and the rate-limit windows', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({
    context: { tokens: 45_000, window: 200_000, percent: 23 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 12.5 },
      { kind: 'seven_day', percentUsed: 61 },
    ],
    changed: ['context', 'rateLimits'],
  })

  const line = await lineOf($)
  expect(line).toContain('ctx 23% (45k/200k)')
  expect(line).toContain('5h 12.5%')
  expect(line).toContain('7d 61%')
})

test('the band yields to a survey', async ($, on) => {
  engine(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>survey</Text>
  })

  const ui = await $.ui.mount({
    ...BAND,
    props: { ...BAND.props, hasSurvey: true },
    surface: 'terminal',
  })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('survey')
  await ui.unmount()
})
