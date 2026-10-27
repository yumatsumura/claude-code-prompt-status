import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { ContextFill, RateLimit, Snapshot } from '../types'

type Dollar = Parameters<Hook<'session.start'>>[0]

const EMPTY: Snapshot = {
  dir: null,
  model: null,
  effort: null,
  context: null,
  rateLimits: [],
}

// Change the tag when Snapshot's fields change: it declines what an earlier
// version stored, which outlives a reload.
const snapshot = atom({ plugin: 'prompt-status', key: 'snapshot' } as const, EMPTY, {
  shape: 'snapshot-1',
})

// Writes only the fields that moved, so an unchanged measure redraws nothing.
const patch = async ($: Dollar, change: Partial<Snapshot>) => {
  const now = await read($, snapshot)
  const isSame = (Object.keys(change) as (keyof Snapshot)[]).every(
    key => JSON.stringify(now[key]) === JSON.stringify(change[key]),
  )

  if (!isSame) {
    await update($, snapshot, value => ({ ...value, ...change }))
  }
}

const basename = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

const modelKey = (model: string) =>
  model
    .toLowerCase()
    .replace(/\[.*?\]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^claude-/, '')

// `claude-opus-5-5` -> `Opus 5.5`; anything else is shown as the engine names it.
const formatModel = (model: string) => {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(model)

  if (!match) {
    return model
  }

  const [, family = '', major, minor, longContext] = match
  const name = family.charAt(0).toUpperCase() + family.slice(1)

  return `${name} ${minor ? `${major}.${minor}` : major}${longContext ? ' 1M' : ''}`
}

// Before the first request reports one: the settings' level for this model,
// then the global one.
const effortFromSettings = async ($: Dollar, model: string | null) => {
  const perModel = await $.settings.read({ key: 'modelSettings' })

  if (model && perModel && typeof perModel === 'object') {
    const wanted = modelKey(model)

    for (const [key, value] of Object.entries(perModel as Record<string, unknown>)) {
      const level = (value as { effortLevel?: unknown } | null)?.effortLevel

      if (modelKey(key) === wanted && typeof level === 'string') {
        return level
      }
    }
  }

  const level = await $.settings.read({ key: 'effortLevel' })

  return typeof level === 'string' ? level : null
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

// `/effort`'s output names the level it set, a pick for this session alone
// included, which the settings never see.
const EFFORT_SET = /Set effort level to (low|medium|high|xhigh|max)\b/

const effortInRow = (content: readonly { type: string; text?: string }[]) => {
  for (const block of content) {
    const match = block.type === 'text' && block.text ? EFFORT_SET.exec(block.text) : null

    if (match) {
      return match[1]
    }
  }

  return undefined
}

// The effort is read from the settings only where they can be newer than the
// last request's (the start, a model switch, a settings write): elsewhere they
// would undo a level `--effort` or `/effort` set for this session alone.
const refresh = async ($: Dollar, { withEffort = false } = {}) => {
  const [root, model, usage] = await Promise.all([
    $.session.root(),
    $.session.model(),
    $.session.usage(),
  ])
  const { tokens, window, percent } = usage.context

  await patch($, {
    dir: basename(root),
    model,
    ...(withEffort ? { effort: await effortFromSettings($, model) } : {}),
    context: { tokens, window, percent },
    rateLimits: usage.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({
      kind,
      percentUsed,
      resetsAt,
    })),
  })
}

const formatTokens = (n: number) => {
  if (n >= 1_000_000) {
    return `${+(n / 1_000_000).toFixed(1)}M`
  }

  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`
}

const levelColor = (percent: number) =>
  percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'success'

const LIMIT_LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: 'spend',
}

const pad = (n: number) => String(n).padStart(2, '0')

// The 5h window resets within the day: the time is enough. Longer ones carry the date.
const formatReset = (kind: string, resetsAt?: string) => {
  const at = resetsAt ? new Date(resetsAt) : null

  if (!at || Number.isNaN(at.getTime())) {
    return ''
  }

  const time = `${at.getHours()}:${pad(at.getMinutes())}`

  return kind === 'five_hour' ? time : `${at.getMonth() + 1}/${at.getDate()} ${time}`
}

const contextText = (context: ContextFill | null) => {
  if (!context) {
    return { text: 'ctx --', color: undefined }
  }

  const window = formatTokens(context.window)

  if (context.percent === undefined || context.tokens === undefined) {
    return { text: `ctx --/${window}`, color: undefined }
  }

  return {
    text: `ctx ${context.percent}% (${formatTokens(context.tokens)}/${window})`,
    color: levelColor(context.percent),
  }
}

const limitText = (limit: RateLimit) => {
  const label = LIMIT_LABELS[limit.kind] ?? limit.kind
  const reset = formatReset(limit.kind, limit.resetsAt)

  return `${label} ${limit.percentUsed}%${reset ? ` ↻${reset}` : ''}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refresh($, { withEffort: true })

    return next(e)
  })

  // Every switch, a picker's included, whose command has returned before the
  // pick. The new model runs at the level its settings keep for it.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const ran = await next(e)

    try {
      await patch($, {
        model: e.to_model,
        effort: await effortFromSettings($, e.to_model),
      })
    } catch {
      // The next request's step corrects it.
    }

    return ran
  })

  // The command's output row, kept once the picker has closed.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    const isCommandRow = e.door === 'command' || e.door === 'notice'
    const level = isCommandRow && e.agentId === undefined ? effortInRow(e.message.content) : undefined

    if (level) {
      try {
        await patch($, { effort: level })
      } catch {
        // The next request's step corrects it.
      }
    }

    return stored
  })

  // `/effort`'s picker keeps the level in the settings once picked.
  on('classic.ConfigChange', async ($, e, next) => {
    const ran = await next(e)

    if (e.source !== 'skills') {
      try {
        await patch($, { effort: await effortFromSettings($, await $.session.model()) })
      } catch {
        // The next request's step corrects it.
      }
    }

    return ran
  })

  // A host's directory change (the desktop app starting a session in a spare
  // folder, then moving it into the project) runs no command.
  on('classic.CwdChanged', async ($, e, next) => {
    const ran = await next(e)

    try {
      await refresh($)
    } catch {
      // The bar keeps its last figures until the next measure.
    }

    return ran
  })

  // The context fill and the rate-limit windows, pushed after each turn; the
  // directory too, should a move have gone unannounced.
  on('session.measure', async ($, e, next) => {
    const { tokens, window, percent } = e.context

    await patch($, {
      dir: basename(await $.session.root()),
      context: { tokens, window, percent },
      rateLimits: e.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({
        kind,
        percentUsed,
        resetsAt,
      })),
    })

    return next(e)
  })

  // The effort the main loop actually sends, after any downgrade for the model.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      await patch($, {
        model: await $.session.model(),
        effort: e.effort === undefined ? null : String(e.effort),
      })
    }

    return yield* next(e)
  })

  // `/model`, `/effort`, `/cd` and the rest show at once, not after the next prompt.
  // The command has already run by the refresh: a failed refresh must not undo it.
  on('command.run', async ($, e, next) => {
    const ran = await next(e)
    const level = e.args.trim().toLowerCase()

    try {
      await refresh($)

      // `/effort low` names the level outright; a bare `/effort` opens its picker.
      if (e.command === 'effort' && EFFORTS.includes(level)) {
        await patch($, { effort: level })
      }
    } catch {
      // The bar keeps its last figures until the next measure.
    }

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const { dir, model, effort, context, rateLimits } = await read($, snapshot)
    const ctx = contextText(context)
    const sep = <Text dimColor> │ </Text>

    return (
      <Box flexDirection="row" width={e.props.bodyColumns}>
        <Text wrap="truncate-end">
          <Text color="claude" bold>
            {dir ?? '--'}
          </Text>
          {sep}
          <Text color={ctx.color} dimColor={!ctx.color}>
            {ctx.text}
          </Text>
          {sep}
          {rateLimits.length === 0 ? (
            <Text dimColor>limit: 送信後に表示</Text>
          ) : (
            rateLimits.map((limit, i) => (
              <Text>
                {i > 0 && <Text dimColor> · </Text>}
                <Text color={levelColor(limit.percentUsed)}>{limitText(limit)}</Text>
              </Text>
            ))
          )}
          {sep}
          <Text>{model ? formatModel(model) : '--'}</Text>
          {effort && <Text color="suggestion"> · {effort}</Text>}
        </Text>
      </Box>
    )
  })
}
