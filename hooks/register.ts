import type { EngineInterface, Register, RenderInput, RenderSurface } from 'claude-code'

import { createLauncher, type Host, type Launcher } from './launcher/index'
import { savedSessionOf, storeKey } from './launcher/saved'
import {
  AGENTS_ARGUMENT_HINT,
  AGENTS_COMMAND_DESCRIPTION,
  COMMAND_ARGUMENT_HINT,
  COMMAND_DESCRIPTION,
  panelOpenedOnAgents,
} from './messages'
import { type Monitor, SESSION_CHANGING_SOURCES, createMonitor, type MonitorHost } from './monitor/index'
import type { ClockPort } from './monitor/registry'
import { drawFooterButton, footerSummaryOf } from './ui/footer'
import { type AgentsPort, PANE_ID, type PaneHost, createPane } from './ui/pane'

const PROMPT_FROZEN = { plugin: 'agent-studio', key: 'promptFrozen' } as const
const COMPOSE_SEEN = { plugin: 'agent-studio', key: 'composeSeen' } as const

const SENT_SUMMARIES = new WeakMap<Monitor, { text: string }>()

const sentSummaryOf = (monitor: Monitor) => {
  const known = SENT_SUMMARIES.get(monitor)

  if (known !== undefined) {
    return known
  }

  const created = { text: '' }

  SENT_SUMMARIES.set(monitor, created)

  return created
}

const sendSummary = async ($: EngineInterface, monitor: Monitor, summary: string) => {
  try {
    await $.ui.status(summary === '' ? undefined : summary)
    sentSummaryOf(monitor).text = summary
  } catch {
    return
  }
}

const hostOf = ($: EngineInterface, monitor: Monitor | null): Host => ({
  cwd: () => $.session.cwd(),
  root: async () => (await $.session.repo())?.root ?? (await $.session.root()),
  home: async () => (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')),
  list: path => $.fs.list(path),
  read: path => $.fs.read(path),
  sessionId: () => $.session.id(),
  sessionModel: () => $.session.model(),
  now: () => $.clock.now(),
  loadSaved: async sessionId => savedSessionOf(await $.store.get(storeKey(sessionId))),
  save: async (sessionId, saved) => {
    if (saved === null) {
      await $.store.delete(storeKey(sessionId))
    } else {
      await $.store.set(storeKey(sessionId), saved)
    }
  },
  loadFlags: async () => ({
    promptFrozen: (await $.state.get(PROMPT_FROZEN)).value ?? false,
    composeSeen: (await $.state.get(COMPOSE_SEEN)).value ?? false,
  }),
  saveFlags: async flags => {
    await $.state.set(PROMPT_FROZEN, flags.promptFrozen)
    await $.state.set(COMPOSE_SEEN, flags.composeSeen)
  },
  appendHidden: async text => {
    const row = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })

    return row.deny === undefined
  },
  notify: async text => {
    await $.ui.toast(text)
  },
  status: async text => {
    if (monitor === null) {
      await $.ui.status(text)
    } else {
      await sendSummary($, monitor, footerSummaryOf(monitor))
    }
  },
  submit: async text => {
    $.clock.after(0, () => {
      $.prompt.submit({ text, asUser: true }).catch(() => undefined)
    })
  },
  defaultAgent: async () => {
    const agent = (await $.settings.read()).agent

    return typeof agent === 'string' && agent !== '' ? agent : undefined
  },
})

const clockOf = ($: EngineInterface): ClockPort => ({
  now: () => $.clock.now(),
  after: (ms, fn) => $.clock.after(ms, fn),
  every: (ms, fn) => $.clock.every(ms, fn),
})

const monitorHostOf = ($: EngineInterface): MonitorHost => ({
  session: async () => {
    const repo = await $.session.repo()

    return {
      sessionId: await $.session.id(),
      cwd: await $.session.cwd(),
      repo: repo === null ? null : (repo.name ?? repo.root),
      model: await $.session.model(),
    }
  },
  agents: () => $.agent.list(),
  store: {
    get: key => $.store.get(key),
    set: (key, value) => $.store.set(key, value),
    delete: key => $.store.delete(key),
    keys: () => $.store.keys(),
  },
  clock: clockOf($),
  invalidate: () => $.ui.invalidate('ui.render'),
})

const runAs = async ($: EngineInterface, launcher: Launcher, monitor: Monitor | null, args: string) => {
  const text = await launcher.command(hostOf($, monitor), args)

  await guarded(() => monitor?.changed())

  return text
}

const agentsOf = ($: EngineInterface, launcher: Launcher | null, monitor: Monitor | null): AgentsPort | undefined =>
  launcher === null
    ? undefined
    : {
        view: () => launcher.catalogView(hostOf($, monitor)),
        use: name => runAs($, launcher, monitor, name),
      }

const paneHostOf = ($: EngineInterface, launcher: Launcher | null, monitor: Monitor | null): PaneHost => ({
  surfaces: () => $.session.surfaces(),
  open: pane => $.ui.open(pane),
  close: id => $.ui.close({ id }),
  panes: () => $.ui.panes(),
  invalidate: () => $.ui.invalidate('ui.render'),
  focus: async key => (await $.ui.focus({ requestId: PANE_ID, key })).deny === undefined,
  toast: text => $.ui.toast(text),
  stopTask: async agentId => {
    const result = await $.tool.call({ tool: 'TaskStop', task_id: agentId })

    return result.deny === undefined
      ? { isStopped: result.isError !== true, text: result.text ?? '' }
      : { isStopped: false, text: result.deny }
  },
  send: (to, text) => $.session.send({ to, text }),
  submit: text => {
    $.clock.after(0, () => {
      $.prompt.submit({ text }).catch(() => undefined)
    })
  },
  agents: agentsOf($, launcher, monitor),
  clock: clockOf($),
})

const NOT_OFFERED: Partial<Record<RenderSurface, readonly string[]>> = { mobile: ['Input', 'Select'] }

const elementsOf = ($: EngineInterface, e: RenderInput<'Pane' | 'SessionMode'>) => {
  const table = $.ui.resolve(e)
  const absent = NOT_OFFERED[e.surface] ?? []

  return Object.fromEntries(Object.entries(table).filter(([name]) => !absent.includes(name))) as typeof table
}

const instantOf = ($: EngineInterface) => $.clock.now()

const guarded = async (work: () => unknown) => {
  try {
    await work()
  } catch {
    return
  }
}

const NO_AGENT = { current: () => null }

export const register: Register = (on, options) => {
  const launcher = options.enableLauncher === false ? null : createLauncher(options)
  const monitor = options.enableMonitor === false ? null : createMonitor(options, launcher ?? NO_AGENT)
  const pane = monitor === null ? null : createPane(monitor)

  if (launcher === null && monitor === null) {
    return
  }

  on('session.start', async ($, e, next) => {
    if (launcher !== null) {
      await $.command
        .register({ name: 'as', description: COMMAND_DESCRIPTION, argumentHint: COMMAND_ARGUMENT_HINT })
        .catch(() => undefined)
      await launcher.start(hostOf($, monitor))
    }

    if (monitor !== null) {
      await $.command
        .register({ name: 'agentes', description: AGENTS_COMMAND_DESCRIPTION, argumentHint: AGENTS_ARGUMENT_HINT })
        .catch(() => undefined)
      await guarded(() => monitor.start(monitorHostOf($)))
    }

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    await launcher?.classicStart(hostOf($, monitor), e)

    if (monitor !== null) {
      await guarded(async () => {
        if (SESSION_CHANGING_SOURCES.includes(e.source)) {
          monitor.moved(await monitorHostOf($).session())
        }

        monitor.titled(e.session_title)
        monitor.changed()
      })
    }

    return next(e)
  }).catch((_$, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    await launcher?.turnStarted(hostOf($, monitor))
    await guarded(async () => monitor?.turnStarted(await instantOf($)))

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(launcher === null ? e : await launcher.step(hostOf($, monitor), e))
    const { agentId } = e

    if (agentId !== undefined) {
      await guarded(() => monitor?.stepUsed(agentId, result.usage))
    }

    return result
  })

  on('tool.call', async (_$, e, next) => {
    const reason = launcher?.guard(e, next.origin.plugin)
    const { agentId } = e

    if (reason !== undefined) {
      return { deny: reason }
    }

    if (monitor === null || agentId === undefined) {
      return next(e)
    }

    const tool = String(e.tool)

    await guarded(() => monitor.toolStarted(agentId, tool))

    try {
      return await next(e)
    } finally {
      await guarded(() => monitor.toolFinished(agentId, tool))
    }
  }).catch((_$, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const reason = launcher?.spawnGuard(e, next.origin.plugin)

    if (reason !== undefined) {
      return { deny: reason }
    }

    const result = await next(e)

    await guarded(async () => monitor?.spawned(e, result, await instantOf($)))

    return result
  }).catch((_$, e, next) => next(e))

  if (launcher !== null) {
    on('command.run', { command: 'as' }, async ($, e) => {
      if (e.args.trim() === '' && (await pane?.open(paneHostOf($, launcher, monitor), 3))) {
        return { text: panelOpenedOnAgents }
      }

      return { text: await runAs($, launcher, monitor, e.args) }
    })

    on('prompt.compose', async ($, e, next) => {
      const composed = await next(e)

      return { sections: await launcher.compose(hostOf($, monitor), composed.sections) }
    })
  }

  if (monitor !== null && pane !== null) {
    on('turn.complete', async ($, e, next) => {
      await guarded(async () => monitor.turnCompleted(e, await instantOf($)))

      return next(e)
    })

    on('classic.UserPromptSubmit', async (_$, e, next) => {
      await guarded(() => monitor.titled(e.session_title))

      return next(e)
    }).catch((_$, e, next) => next(e))

    on('session.end', async (_$, e, next) => {
      await guarded(() => monitor.ended())

      return next(e)
    })

    on('command.run', { command: 'agentes' }, async ($, e) => ({
      text: await pane.command(paneHostOf($, launcher, monitor), e.args, () => monitor.command(monitorHostOf($), e.args)),
    }))

    on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) =>
      pane.render(paneHostOf($, launcher, monitor), elementsOf($, e), {
        columns: e.props.bodyColumns,
        isFocused: e.props.isFocused,
      }),
    ).catch((_$, e, next) => next(e))

    on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
      const below = await next(e)
      const host = paneHostOf($, launcher, monitor)
      const summary = footerSummaryOf(monitor)

      if (summary !== sentSummaryOf(monitor).text) {
        await sendSummary($, monitor, summary)
      }

      return drawFooterButton(elementsOf($, e), below, () => pane.open(host))
    }).catch((_$, e, next) => next(e))

    on('ui.focus', { requestId: PANE_ID }, async (_$, e, next) => {
      const press = pane.takeover(e.element, e.origin.kind)
      const result = await next(e)

      if (result.deny === undefined) {
        press?.()
      }

      return result
    }).catch((_$, e, next) => next(e))

    on('ui.close', { id: PANE_ID }, async ($, e, next) => {
      const result = await next(e)

      await pane.closed(paneHostOf($, launcher, monitor))

      return result
    }).catch((_$, e, next) => next(e))
  }
}
