// Marks that draw nothing or reorder the text around them, the one list the model-given text of this plugin is cleaned with.
// Written as escapes, so a reader can see them. The `u` flag is for the tag characters, which lie beyond the first plane.
export const HIDDEN_MARKS = /[­؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿\u{e0000}-\u{e007f}]/gu
