// A plan file as a person might leave it after editing by hand, shared by the plan tests: notes, odd spacing, unknown lines, a step with
// no id, indented lines under steps, a second Later heading and blank lines of spaces.
export const HAND_EDITED = [
  '# Goal with   odd   spacing ', '', 'Some words the person wrote about the goal.', '',
  '- [ ] First step  <!-- s1 -->', 'A note between steps, kept in place.', '-   [ ]  Not a step the parser knows',
  '- [ ] Added by hand', '  - [ ] indented, so not a step', '    deeper note of mine', '* [ ] star bullet', '- [x]no space', '- [ ]', '',
  '<!-- a comment of the person\'s -->', '- [X] Done by hand  <!-- s9 -->', '  - Decided:   spaced choice', '  - decided: lower case',
  '  - Decided: second choice', '', '## later', '- [ ] Lower case heading is a step', '## Later', '- [ ] Real later  <!-- l3 -->', '  - Decided: not a choice here',
  '## Later', '- [ ] After a second heading', '', '\t', '',
].join('\n')
