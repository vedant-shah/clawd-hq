/** The six items the person saw listed in Left undone that were all false: notes about the feature itself, a checklist of what to try, and README prose. None may ever be listed. */
export const MUST_NOT_FLAG = [
  'lines in an answer that put something off, like "I\'ll do that later"',
  'whether a TODO you write shows up with the right line',
  'Files: new text written by Edit, Write, MultiEdit or NotebookEdit is checked for TODO/FIXME comments',
  'Items are merged when about 70% of their words match',
  'A real Edit or Write on a file with a TODO shows the right file:line',
  '- It keeps a "Left undone" list on the Office tab, for each project folder: work Claude or a specialist put off. Items come from `TODO` and `FIXME` comments, skipped tests (`it.skip`) and "not implemented" lines.',
] as const
