import { type TestRest, test as kitTest } from 'claude-code/testing'

const PORTUGUESE = { language: 'pt-BR' }

export const test = (name: string, ...rest: TestRest): void => {
  if (rest.length === 1) {
    kitTest(name, { options: PORTUGUESE }, rest[0])

    return
  }

  const [options, body] = rest

  kitTest(name, { ...options, options: { ...PORTUGUESE, ...options.options } }, body)
}
