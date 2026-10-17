// The quiet scan of a project: signs, file types, an outline, dependencies, the README and the instruction files, then a guess at the person's role.
// A port of the tested build3 script. Reads through OnboardIo closures only; nothing is asked and nothing leaves this computer.
import type { OnboardIo, PastUse, ProjectFacts, RoleGuess } from './onboard-types'

export type ScanIo = Pick<OnboardIo, 'cwd' | 'list' | 'read' | 'exists'>

/** Folders never opened. */
const SKIP = new Set(['node_modules', '.git', '.next', 'coverage', 'dist', 'build', '.vercel', '__pycache__', '.venv'])
/** Counting goes this many levels down; the outline shows folders three levels down and files two. */
const COUNT_DEPTH = 5
const OUTLINE_DIR_DEPTH = 3
const OUTLINE_FILE_DEPTH = 2
const OUTLINE_LINES = 120
const FILE_TYPES_SHOWN = 12
const DEPS_SHOWN = 80
const README_LINES = 40
const DOC_LINES = 80
const DOC_CHARS = 2500
const IMPORT_LINES = 60
const IMPORT_CHARS = 2000
/** The most folders opened in one look, so a huge tree stays quick. */
const MAX_FOLDERS = 600

const CODE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.swift', '.rb', '.php', '.c', '.cc', '.cpp', '.h', '.cs', '.vue', '.svelte', '.dart', '.scala', '.sh', '.lua', '.ex', '.exs', '.r'])

type Node = { readonly rel: string; readonly name: string; readonly isDir: boolean; readonly depth: number }

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
const firstLines = (text: string | undefined, n: number) => (text ?? '').split('\n').slice(0, n).join('\n')
const extOf = (name: string) => (name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.')) : name)

/** Every entry down to COUNT_DEPTH levels, in folder order, skipping heavy folders. `budget` counts the folders opened. */
async function walk(io: ScanIo, dir: string, rel: string, depth: number, budget: { left: number }): Promise<readonly Node[]> {
  if (budget.left <= 0) return []
  budget.left -= 1
  const listed = await io.list(dir).then(found => [...found].sort(byName), () => [])
  const nodes = await Promise.all(listed.filter(e => !SKIP.has(e.name)).map(async e => {
    const path = rel ? `${rel}/${e.name}` : e.name
    const self: Node = { rel: path, name: e.name, isDir: e.isDir, depth }
    if (!e.isDir || depth >= COUNT_DEPTH) return [self]
    return [self, ...(await walk(io, `${dir}/${e.name}`, path, depth + 1, budget))]
  }))
  return nodes.flat()
}

function tellsOf(nodes: readonly Node[]): readonly string[] {
  const top = nodes.filter(n => n.depth === 1)
  const names = top.map(n => n.name)
  const rules: ReadonlyArray<readonly [boolean, string]> = [
    [names.includes('.claude-plugin'), 'has .claude-plugin/ : a Claude Code plugin / mod'],
    [names.some(n => /^next\.config\./.test(n)), 'has next.config : a Next.js web app'],
    [names.includes('vercel.json') || names.includes('.vercel'), 'deployed on Vercel'],
    [names.some(n => /^vitest\.config/.test(n)), 'tests run with vitest'],
    [top.some(n => n.name === 'plugins' && n.isDir), 'has plugins/ : a monorepo-style layout'],
  ]
  return rules.filter(([hit]) => hit).map(([, text]) => text)
}

function fileTypesOf(nodes: readonly Node[]): Readonly<Record<string, number>> {
  const counts = nodes.filter(n => !n.isDir).reduce<Record<string, number>>((acc, n) => ({ ...acc, [extOf(n.name)]: (acc[extOf(n.name)] ?? 0) + 1 }), {})
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, FILE_TYPES_SHOWN)
  return Object.fromEntries(top)
}

function outlineOf(nodes: readonly Node[]): readonly string[] {
  const shown = nodes.filter(n => n.depth <= OUTLINE_DIR_DEPTH && !n.name.startsWith('.env') && (n.isDir || n.depth <= OUTLINE_FILE_DEPTH))
  return shown.map(n => `${'  '.repeat(n.depth - 1)}${n.name}${n.isDir ? '/' : ''}`).slice(0, OUTLINE_LINES)
}

/** Manifests at the top, one level down, or one more under plugins/, packages/, apps/ and services/. */
function manifestsOf(nodes: readonly Node[]): readonly Node[] {
  const rooted = /^(plugins|packages|apps|services)\//
  return nodes.filter(n => !n.isDir && /^(package\.json|pyproject\.toml|requirements[^/]*\.txt)$/.test(n.name) && (n.depth <= 2 || (n.depth === 3 && rooted.test(n.rel))))
}

function depNames(name: string, text: string): readonly string[] {
  if (name === 'package.json') {
    try {
      const json = JSON.parse(text) as { dependencies?: object; devDependencies?: object }
      return Object.keys({ ...json.dependencies, ...json.devDependencies })
    } catch {
      return []
    }
  }
  return text.split('\n').flatMap(l => {
    const m = l.match(/^\s*"?([A-Za-z0-9_.-]+)"?\s*(==|>=|<=|~=|\[|$|,|<|>)/)
    return m?.[1] ? [m[1]] : []
  })
}

async function depsOf(io: ScanIo, nodes: readonly Node[]): Promise<readonly string[]> {
  const found = await Promise.all(manifestsOf(nodes).map(async n => depNames(n.name, (await io.read(`${io.cwd}/${n.rel}`)) ?? '')))
  return [...new Set(found.flat())].slice(0, DEPS_SHOWN)
}

/** A path an instruction file imports with `@file.md`, kept inside the project. */
const safeImport = (path: string) => !path.startsWith('/') && !path.split('/').includes('..')

async function instructionsOf(io: ScanIo): Promise<string> {
  const sections = await Promise.all(['CLAUDE.md', 'AGENTS.md'].map(async file => {
    const text = firstLines(await io.read(`${io.cwd}/${file}`), DOC_LINES)
    if (!text) return []
    const imports = [...text.matchAll(/^@([\w./-]+\.md)\s*$/gm)].flatMap(m => (m[1] ? [m[1]] : [])).filter(p => p !== file && safeImport(p))
    const imported = await Promise.all(imports.map(async p => {
      const body = firstLines(await io.read(`${io.cwd}/${p}`), IMPORT_LINES).slice(0, IMPORT_CHARS)
      return body ? `--- ${p} (imported)\n${body}` : ''
    }))
    return [`--- ${file}\n${text.slice(0, DOC_CHARS)}`, ...imported.filter(Boolean)]
  }))
  return sections.flat().join('\n')
}

/** A quiet look at the project folder. Always answers; a folder that cannot be read gives empty facts. */
export async function projectFacts(io: ScanIo): Promise<ProjectFacts> {
  const nodes = await walk(io, io.cwd, '', 1, { left: MAX_FOLDERS })
  const [deps, readme, instructions] = await Promise.all([depsOf(io, nodes), io.read(`${io.cwd}/README.md`), instructionsOf(io)])
  return {
    tells: tellsOf(nodes),
    fileTypes: fileTypesOf(nodes),
    outline: outlineOf(nodes),
    deps,
    readmeHead: firstLines(readme, README_LINES),
    instructions,
    codeFiles: nodes.filter(n => !n.isDir && CODE.has(extOf(n.name))).length,
  }
}

type Hint = { readonly words: Readonly<Record<string, number>>; readonly exts: readonly string[] }
/** What each role looks like: words (dependencies, signs, names of past helpers) with a weight, and file types. */
const HINTS: Readonly<Record<string, Hint>> = {
  'Web developer': {
    words: { next: 4, react: 2, 'react-dom': 3, vue: 4, svelte: 4, astro: 4, angular: 4, '@angular/core': 4, tailwindcss: 3, vite: 2, frontend: 3, css: 2, nextjs: 3 },
    exts: ['.tsx', '.jsx', '.vue', '.svelte', '.html', '.css', '.scss'],
  },
  'Data / ML': {
    words: { pandas: 4, numpy: 3, torch: 5, tensorflow: 5, 'scikit-learn': 4, sklearn: 4, jupyter: 4, transformers: 4, matplotlib: 3, scipy: 3, polars: 4, pytorch: 3, ml: 2 },
    exts: ['.ipynb'],
  },
  'Mobile developer': {
    words: { 'react-native': 8, expo: 6, flutter: 8, swiftui: 6, swift: 4, kotlin: 3, android: 4, ios: 4, mobile: 3 },
    exts: ['.swift', '.kt', '.dart'],
  },
  'Tool or plugin builder': { words: { plugin: 4, mod: 4, commander: 3, yargs: 3, oclif: 4, mcp: 3, modelcontextprotocol: 4, cli: 2 }, exts: [] },
  'Writer or researcher': { words: { writing: 3, research: 2, essay: 3, thesis: 3, paper: 2, article: 2 }, exts: ['.md', '.txt', '.tex', '.docx', '.pdf', '.rst', '.bib'] },
}
const BASELINE = 1
const WRITER_MAX_CODE = 5
const THIN_CODE_FILES = 5

const tokensOf = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

function signalsOf(facts: ProjectFacts, past: PastUse): ReadonlySet<string> {
  const named = [...Object.keys(past.agents), ...Object.keys(past.skills)]
  return new Set([...facts.deps.map(d => d.toLowerCase()), ...tokensOf([...facts.tells, ...named].join(' '))])
}

function scoreOf(role: string, hint: Hint, facts: ProjectFacts, signals: ReadonlySet<string>): number {
  if (role === 'Writer or researcher' && facts.codeFiles >= WRITER_MAX_CODE) return 0
  const wordPoints = Object.entries(hint.words).reduce((sum, [word, weight]) => sum + (signals.has(word) ? weight : 0), 0)
  const total = Object.values(facts.fileTypes).reduce((a, b) => a + b, 0)
  const matching = hint.exts.reduce((sum, ext) => sum + (facts.fileTypes[ext] ?? 0), 0)
  return wordPoints + (total > 0 ? Math.round((4 * matching) / total) : 0)
}

/**
 * Guesses the person's role from the facts and past use; nothing is asked.
 * `isThin` means the evidence is too little to trust (under 5 code files, no instruction files, no past use), so the flow can ask.
 */
export function guessRole(facts: ProjectFacts, past: PastUse): RoleGuess {
  const signals = signalsOf(facts, past)
  const scored = Object.entries(HINTS).map(([role, hint]) => ({ role, score: scoreOf(role, hint, facts, signals) }))
  const best = scored.reduce((top, s) => (s.score > top.score ? s : top), { role: 'Software engineer', score: BASELINE })
  const hasPast = past.files > 0 || Object.keys(past.agents).length + Object.keys(past.skills).length > 0
  const isThin = facts.codeFiles < THIN_CODE_FILES && facts.instructions.trim() === '' && !hasPast
  return { role: best.role, isThin }
}
