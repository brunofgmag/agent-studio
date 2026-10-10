import type { EngineInterface, Register } from 'claude-code'

import { createLauncher, type Host } from './launcher/index'
import { savedSessionOf, storeKey } from './launcher/saved'
import { COMMAND_ARGUMENT_HINT, COMMAND_DESCRIPTION } from './messages'

const PROMPT_FROZEN = { plugin: 'agent-studio', key: 'promptFrozen' } as const
const COMPOSE_SEEN = { plugin: 'agent-studio', key: 'composeSeen' } as const

const hostOf = ($: EngineInterface): Host => ({
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
})

export const register: Register = (on, options) => {
  if (options.enableLauncher === false) {
    return
  }

  const launcher = createLauncher(options)

  on('session.start', async ($, e, next) => {
    await $.command
      .register({ name: 'as', description: COMMAND_DESCRIPTION, argumentHint: COMMAND_ARGUMENT_HINT })
      .catch(() => undefined)
    await launcher.start(hostOf($))

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    await launcher.classicStart(hostOf($), e)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await launcher.turnStarted(hostOf($))

    return next(e)
  })

  on('command.run', { command: 'as' }, async ($, e) => ({ text: await launcher.command(hostOf($), e.args) }))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return { sections: await launcher.compose(hostOf($), composed.sections) }
  })

  on('turn.step', async function* ($, e, next) {
    return yield* next(await launcher.stepModel(hostOf($), e))
  })

  on('tool.call', (_$, e, next) => {
    const reason = launcher.guard(e, next.origin.plugin)

    return reason === undefined ? next(e) : { deny: reason }
  }).catch((_$, e, next) => next(e))
}
