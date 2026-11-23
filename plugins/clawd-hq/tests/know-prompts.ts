// Stand-ins for the shipped prompts/observer.md and prompts/explain.md, in their shape: the test host cannot read the real files.

/** The shape of prompts/explain.md, cut down: the body, the marker comments, the three follow-up texts, then the example. */
export const EXPLAIN = [
  '# Learn more',
  '',
  'The note the person opened:',
  '{{NOTE}}',
  '',
  '## Follow-up',
  '',
  '{{FOLLOW_UP}}',
  '',
  '<!-- The code puts one of the texts below in place of {{FOLLOW_UP}}, or an empty line for the first explanation. -->',
  '',
  '<!-- follow-up: simpler -->',
  'Say it in simpler words. Your last explanation:',
  '{{PREVIOUS}}',
  '',
  '<!-- follow-up: shorter -->',
  'Say it in 45 words or fewer. Your last explanation:',
  '{{PREVIOUS}}',
  '',
  '<!-- follow-up: more detail -->',
  'Say more, with real names in backticks. Your last explanation:',
  '{{PREVIOUS}}',
  '',
  '## Example',
  '',
  '**The school would share one limit**',
].join('\n')

/** The shape of prompts/observer.md, cut down: its two lists, then its last section. */
export const OBSERVER = '# Check\n\nNotes already shown to the person:\n{{SHOWN}}\n\nTopics the person said they already knew:\n{{KNEW}}\n\n## Last word\n\nBe brief.'
