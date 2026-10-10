import { expect, test } from 'claude-code/testing'

import { type Catalog, type CatalogHost, findAgent, loadCatalog } from '../hooks/launcher/catalog'

type World = {
  cwd: string
  root: string
  home: string | undefined
  files: Readonly<Record<string, string>>
}

const slashed = (path: string) => path.replaceAll('\\', '/')

const agentFile = (name: string, extra = '') =>
  `---\nname: ${name}\ndescription: ${name} from a file\n${extra}---\nBody of ${name}.\n`

const hostOf = (world: World): CatalogHost => {
  const files = new Map(Object.entries(world.files).map(([path, text]) => [slashed(path), text]))

  return {
    cwd: async () => world.cwd,
    root: async () => world.root,
    home: async () => world.home,
    read: async path => {
      const text = files.get(slashed(path))

      if (text === undefined) {
        throw new Error(`ENOENT ${path}`)
      }

      return text
    },
    list: async path => {
      const dir = slashed(path).replace(/\/$/, '')
      const children = new Map<string, 'file' | 'dir'>()

      for (const file of files.keys()) {
        if (file.startsWith(`${dir}/`)) {
          const [head, ...rest] = file.slice(dir.length + 1).split('/')
          children.set(head ?? '', rest.length === 0 ? 'file' : 'dir')
        }
      }

      if (children.size === 0) {
        throw new Error(`ENOENT ${path}`)
      }

      return [...children].map(([name, kind]) => ({ name, kind }))
    },
  }
}

const namesOf = (catalog: Catalog) => catalog.entries.map(entry => `${entry.agent.name}:${entry.source}`)

test('a project agent beats a user agent with the same name', async () => {
  const catalog = await loadCatalog(
    hostOf({
      cwd: 'C:/work/app',
      root: 'C:/work/app',
      home: 'C:\\Users\\bruno',
      files: {
        'C:/work/app/.claude/agents/a.md': agentFile('twin', 'model: claude-opus-5-5\n'),
        'C:/Users/bruno/.claude/agents/b.md': agentFile('twin', 'model: claude-sonnet-5-5\n'),
        'C:/Users/bruno/.claude/agents/c.md': agentFile('only-user'),
      },
    }),
  )

  expect(namesOf(catalog)).toEqual(['twin:project', 'only-user:user'])
  expect(catalog.entries[0]?.agent.model).toBe('claude-opus-5-5')
  expect(catalog.entries[0]?.path).toBe('C:/work/app/.claude/agents/a.md')
})

test('a nearer project directory beats a farther one and nothing above the root is read', async () => {
  const catalog = await loadCatalog(
    hostOf({
      cwd: 'C:/work/app/packages/ui',
      root: 'C:/work/app',
      home: 'C:\\Users\\bruno',
      files: {
        'C:/work/app/packages/ui/.claude/agents/near.md': agentFile('twin', 'model: claude-opus-5-5\n'),
        'C:/work/app/.claude/agents/far.md': agentFile('twin', 'model: claude-sonnet-5-5\n'),
        'C:/work/app/.claude/agents/extra.md': agentFile('extra'),
        'C:/work/.claude/agents/outside.md': agentFile('outside'),
      },
    }),
  )

  expect(namesOf(catalog)).toEqual(['twin:project', 'extra:project'])
  expect(catalog.entries[0]?.agent.model).toBe('claude-opus-5-5')
})

test('subfolders are scanned and only .md files are read', async () => {
  const catalog = await loadCatalog(
    hostOf({
      cwd: 'C:/work/app',
      root: 'C:/work/app',
      home: undefined,
      files: {
        'C:/work/app/.claude/agents/top.md': agentFile('top'),
        'C:/work/app/.claude/agents/team/deep/nested.md': agentFile('nested'),
        'C:/work/app/.claude/agents/notes.txt': 'not an agent',
      },
    }),
  )

  expect([...namesOf(catalog)].sort()).toEqual(['nested:project', 'top:project'])
  expect(catalog.skipped).toEqual([])
})

test('an invalid file lands in skipped and the rest still load', async () => {
  const catalog = await loadCatalog(
    hostOf({
      cwd: 'C:/work/app',
      root: 'C:/work/app',
      home: undefined,
      files: {
        'C:/work/app/.claude/agents/bad.md': '---\nname: broken\n---\nno description',
        'C:/work/app/.claude/agents/good.md': agentFile('good'),
      },
    }),
  )

  expect(namesOf(catalog)).toEqual(['good:project'])
  expect(catalog.skipped).toHaveLength(1)
  expect(catalog.skipped[0]?.path).toBe('C:/work/app/.claude/agents/bad.md')
  expect(catalog.skipped[0]?.reason).toContain('description')
})

test('a missing directory is an empty directory', async () => {
  const catalog = await loadCatalog(
    hostOf({
      cwd: 'C:/work/app/sub',
      root: 'C:/work/app',
      home: 'C:\\Users\\bruno',
      files: { 'C:/Users/bruno/.claude/agents/u.md': agentFile('u') },
    }),
  )

  expect(namesOf(catalog)).toEqual(['u:user'])
  expect(catalog.skipped).toEqual([])
})

test('Windows backslash paths from the session are walked the same way', async () => {
  const catalog = await loadCatalog(
    hostOf({
      cwd: 'C:\\work\\app\\mid\\sub',
      root: 'C:\\work\\app',
      home: 'C:\\Users\\bruno',
      files: {
        'C:/work/app/mid/sub/.claude/agents/a.md': agentFile('inner'),
        'C:/work/app/mid/.claude/agents/m.md': agentFile('middle'),
        'C:/work/app/.claude/agents/b.md': agentFile('outer'),
      },
    }),
  )

  expect(namesOf(catalog)).toEqual(['inner:project', 'middle:project', 'outer:project'])
})

test('a home that is also a project directory is scanned once, as project', async () => {
  const catalog = await loadCatalog(
    hostOf({
      cwd: '/home/bruno',
      root: '/home/bruno',
      home: '/home/bruno',
      files: { '/home/bruno/.claude/agents/a.md': agentFile('a') },
    }),
  )

  expect(namesOf(catalog)).toEqual(['a:project'])
})

test('findAgent matches the name field, not the file name', async () => {
  const catalog = await loadCatalog(
    hostOf({
      cwd: '/p',
      root: '/p',
      home: undefined,
      files: { '/p/.claude/agents/file-name.md': agentFile('real-name') },
    }),
  )

  expect(findAgent(catalog, 'real-name')?.path).toBe('/p/.claude/agents/file-name.md')
  expect(findAgent(catalog, 'file-name')).toBeUndefined()
})

test('with the session at the project root nothing above it is read as a project', async () => {
  const underHome = await loadCatalog(
    hostOf({
      cwd: 'C:/Users/bruno/Projetos',
      root: 'C:/Users/bruno/Projetos',
      home: 'C:/Users/bruno',
      files: { 'C:/Users/bruno/.claude/agents/u.md': agentFile('mine') },
    }),
  )
  const elsewhere = await loadCatalog(
    hostOf({
      cwd: 'C:/work/app',
      root: 'C:/work/app',
      home: 'C:/Users/bruno',
      files: { 'C:/work/.claude/agents/x.md': agentFile('above') },
    }),
  )

  expect(namesOf(underHome)).toEqual(['mine:user'])
  expect(namesOf(elsewhere)).toEqual([])
})
