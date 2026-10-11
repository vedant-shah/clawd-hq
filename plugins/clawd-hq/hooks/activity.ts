// What a specialist is doing right now: one plain sentence built from its last tool call, and its own words from its last step.
// Pure: no model is asked. A Bash command's own text is never used (it can hold secrets); only the description its caller wrote for it.
import { fit } from './desk'

/** A tool sentence is one line this long at most; the pane wraps it, so only a runaway one is cut (at a word, with no mark). */
export const MAX_SENTENCE = 200
const QUOTED_CHARS = 40
/** What a specialist says: up to this many sentences, and this many characters in all. */
const SAID_SENTENCES = 3
const SAID_CHARS = 280

/** Between a model step and its tool call: the specialist is working something out. */
export const THINKING = 'Thinking'
/** Before anything has been seen of the run. */
export const READING_BRIEF = 'Reading the brief'

type Input = Record<string, unknown>

const text = (input: Input, key: string): string | undefined => {
  const value = input[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path
const quoted = (value: string) => `“${fit(value, QUOTED_CHARS)}”`
/** "ecc:planner" and "acme:(o_o) planner" both read "planner". */
const bareName = (name: string) => name.replace(/^[^:]+:/, '').replace(/^\([^()]*\)\s*/, '')
const withArticle = (word: string) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`

const onFile = (verb: string, input: Input) => {
  const path = text(input, 'file_path') ?? text(input, 'notebook_path')
  return `${verb} ${path ? fileName(path) : 'a file'}`
}

const onSearch = (what: string, query: string | undefined) => (query ? `${what} for ${quoted(query)}` : what)

const onPage = (input: Input) => {
  const host = /^https?:\/\/([^/?#:\s]+)/i.exec(text(input, 'url') ?? '')?.[1]
  return `Reading ${host ?? 'a web page'}`
}

function onMcp(tool: string) {
  const [server = '', ...name] = tool.slice('mcp__'.length).split('__')
  const words = name.join(' ').replace(/_/g, ' ').trim()
  return words ? `Using ${server}: ${words}` : `Using ${server}`
}

function describe(tool: string, input: Input): string {
  switch (tool) {
    case 'Read': return onFile('Reading', input)
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return onFile('Editing', input)
    case 'Write': return onFile('Writing', input)
    case 'Bash': return text(input, 'description') ?? 'Running a command'
    case 'Grep': case 'Glob': return onSearch('Searching the code', text(input, 'pattern'))
    case 'WebSearch': return onSearch('Searching the web', text(input, 'query'))
    case 'WebFetch': return onPage(input)
    case 'Agent': case 'Task': return `Briefing ${withArticle(bareName(text(input, 'subagent_type') ?? 'agent'))}`
    case 'Skill': { const skill = text(input, 'skill'); return skill ? `Using the ${bareName(skill)} skill` : 'Using a skill' }
    case 'SendMessage': return 'Sending a message'
    default: return tool.startsWith('mcp__') ? onMcp(tool) : `Using ${tool}`
  }
}

/** One line saying what this tool call does. */
export const sentenceOf = (tool: string, input: Input): string => fit(describe(tool, input), MAX_SENTENCE)

const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z“"'(\d])/
const LIST_OR_TABLE = /^\s*([-*+]\s|\d+[.)]\s|\|)/
const HEADING = /^\s*#{1,6}\s/
const FENCED = /(^|\n)[ \t]*```[\s\S]*?(\n[ \t]*```|$)/g

/**
 * What a specialist said in its last step, as plain words: the first one to three sentences of its first paragraph.
 * Code, links and marks are dropped; a heading is its own block; a list or a table is not a sentence, so the words stop where one starts.
 */
export function narrationOf(answer: string): string | undefined {
  const paragraph = answer
    .replace(FENCED, '\n\n')
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .find(p => p !== '')
  if (paragraph === undefined) return undefined
  const lines = paragraph.split('\n').filter(l => !HEADING.test(l))
  const end = lines.findIndex(l => LIST_OR_TABLE.test(l))
  const plain = (end === -1 ? lines : lines.slice(0, end)).join(' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
  const kept: string[] = []
  for (const sentence of plain.split(SENTENCE_END).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    const next = [...kept, sentence].join(' ')
    if (kept.length >= SAID_SENTENCES || (kept.length > 0 && next.length > SAID_CHARS)) break
    kept.push(sentence)
  }
  return kept.length === 0 ? undefined : fit(kept.join(' '), SAID_CHARS)
}
