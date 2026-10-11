// What a specialist is doing right now, as one plain sentence built from its last tool call. Pure: no model is asked.
// A Bash command's own text is never used (it can hold secrets); only the description its caller wrote for it.
import { oneLine } from './desk'

/** A sentence is one line this long at most. */
export const MAX_SENTENCE = 80
const QUOTED_CHARS = 30

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
const quoted = (value: string) => `“${oneLine(value, QUOTED_CHARS)}”`
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

/** One line, at most 80 characters, saying what this tool call does. */
export const sentenceOf = (tool: string, input: Input): string => oneLine(describe(tool, input), MAX_SENTENCE)
