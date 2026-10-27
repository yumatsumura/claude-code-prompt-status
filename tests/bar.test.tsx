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

// A command the person typed at the prompt.
const TYPED = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

// Nothing sits beneath the plugin: each hook here stands for the engine.
const PROJECT = '/Users/me/Desktop/ai-projects/claude-mods-sandbox'

const engine = (on: On, root = { path: PROJECT }, settings = { level: 'xhigh' }) => {
  on('session.root', () => ({ value: root.path }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }))
  on('settings.read', () => ({
    value: {
      effortLevel: 'high',
      modelSettings: {
        'claude-opus-5-5': { effortLevel: settings.level },
        'claude-sonnet-5-5': { effortLevel: 'medium' },
      },
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('classic.CwdChanged', () => ({}))
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

test('a session started in a spare folder shows the project it moves into', async ($, on) => {
  const root = { path: '/Users/me/.claude/spares/spare-ufKHrU' }
  engine(on, root)
  await $.session.start({ cwd: root.path, surface: 'terminal', isInteractive: true })

  root.path = PROJECT
  await $.classic.CwdChanged({ old_cwd: '/Users/me/.claude/spares/spare-ufKHrU', new_cwd: PROJECT })

  const line = await lineOf($)
  expect(line).toContain('claude-mods-sandbox')
  expect(line).not.toContain('spare-ufKHrU')
})

test('a model switch shows the new model and the level its settings keep', async ($, on) => {
  engine(on)
  on('classic.PostModelSwitch', () => ({}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.classic.PostModelSwitch({
    from_model: 'claude-opus-5-5',
    to_model: 'claude-sonnet-5-5',
    requested_model: 'sonnet',
    source: 'picker',
    context_tokens: 0,
    prompt_cache_warm: false,
    cache_ttl: '5m',
    estimated_cache_write_usd: 0,
    pricing: 'catalog',
  })

  expect(await lineOf($)).toContain('Sonnet 5.5 · medium')
})

test('/effort with a level shows it at once; another command leaves it', async ($, on) => {
  engine(on)
  on('command.run', () => ({}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.command.run({ command: 'effort', args: 'low', ...TYPED })
  expect(await lineOf($)).toContain('Opus 5.5 · low')

  await $.command.run({ command: 'context', args: '', ...TYPED })
  expect(await lineOf($)).toContain('Opus 5.5 · low')
})

test("/effort's picker shows the level once the settings hold it", async ($, on) => {
  const settings = { level: 'xhigh' }
  engine(on, { path: PROJECT }, settings)
  on('classic.ConfigChange', () => ({}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  settings.level = 'max'
  await $.classic.ConfigChange({ source: 'user_settings' })

  expect(await lineOf($)).toContain('Opus 5.5 · max')
})
