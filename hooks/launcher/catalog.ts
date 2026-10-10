import type { AgentSource, SkippedFile } from '../../types'
import { type AgentDefinition, parseAgentFile } from './frontmatter'

export type CatalogEntry = { agent: AgentDefinition; source: AgentSource; path: string }

export type Catalog = {
  entries: readonly CatalogEntry[]
  skipped: readonly SkippedFile[]
}

export type CatalogHost = {
  cwd: () => Promise<string>
  root: () => Promise<string>
  home: () => Promise<string | undefined>
  list: (path: string) => Promise<readonly { name: string; kind: 'file' | 'dir' | 'other' }[]>
  read: (path: string) => Promise<string>
}

type Location = { dir: string; source: AgentSource }

const AGENTS_FOLDER = '.claude/agents'

const slashed = (path: string) => path.replaceAll('\\', '/').replace(/(?<=.)\/+$/, '')

const sameDir = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

const parentOf = (dir: string): string | undefined => {
  const cut = dir.lastIndexOf('/')
  const parent = dir.slice(0, cut)

  return cut <= 0 || !parent.includes('/') ? undefined : parent
}

const directoriesFrom = (cwd: string, root: string): string[] => {
  if (!`${cwd}/`.toLowerCase().startsWith(`${root}/`.toLowerCase())) {
    return [cwd, root]
  }

  const dirs: string[] = []

  for (let dir: string | undefined = cwd; dir !== undefined && dirs.length < 64; dir = parentOf(dir)) {
    dirs.push(dir)

    if (sameDir(dir, root)) {
      break
    }
  }

  return dirs
}

const agentLocations = async (host: CatalogHost): Promise<Location[]> => {
  const cwd = slashed(await host.cwd())
  const root = slashed(await host.root())
  const home = await host.home()
  const project = directoriesFrom(cwd, root).map(dir => ({
    dir: `${dir}/${AGENTS_FOLDER}`,
    source: 'project' as const,
  }))

  if (home === undefined || home === '') {
    return project
  }

  const user = { dir: `${slashed(home)}/${AGENTS_FOLDER}`, source: 'user' as const }

  return project.some(location => sameDir(location.dir, user.dir)) ? project : [...project, user]
}

const markdownFilesIn = async (host: CatalogHost, dir: string): Promise<string[]> => {
  const listed = await host.list(dir).catch(() => [])
  const entries = [...listed].sort((left, right) => (left.name < right.name ? -1 : 1))
  const files: string[] = []

  for (const entry of entries) {
    const path = `${dir}/${entry.name}`

    if (entry.kind === 'dir') {
      files.push(...(await markdownFilesIn(host, path)))
    } else if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md')) {
      files.push(path)
    }
  }

  return files
}

export const readAgent = async (host: Pick<CatalogHost, 'read'>, path: string) => {
  try {
    return parseAgentFile(await host.read(path))
  } catch {
    return { error: 'unreadable' as const }
  }
}

export const loadCatalog = async (host: CatalogHost): Promise<Catalog> => {
  const entries: CatalogEntry[] = []
  const skipped: SkippedFile[] = []
  const taken = new Set<string>()

  for (const { dir, source } of await agentLocations(host)) {
    for (const path of await markdownFilesIn(host, dir)) {
      const file = await readAgent(host, path)

      if ('error' in file) {
        skipped.push({ path, reason: file.error })
      } else if (!taken.has(file.agent.name)) {
        taken.add(file.agent.name)
        entries.push({ agent: file.agent, source, path })
      }
    }
  }

  return { entries, skipped }
}

export const findAgent = (catalog: Catalog, name: string): CatalogEntry | undefined =>
  catalog.entries.find(entry => entry.agent.name === name)
