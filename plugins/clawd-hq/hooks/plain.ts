// Marks that draw nothing or reorder the text around them, the one list the model-given text of this plugin is cleaned with.
// Written as escapes, so a reader can see them. The `u` flag is for the tag characters, which lie beyond the first plane.
export const HIDDEN_MARKS = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/gu
