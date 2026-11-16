// Fakes in the shape of keys and tokens, put together here from pieces so that no line of any file holds a whole one: a scanner for leaked
// secrets cannot tell a fake from a real key, and would flag the repository. Each is only a shape (a prefix, a length, mixed letters and digits).

/** `sk-ant-api03-`, the front of an Anthropic key. */
export const ANT_PREFIX = ['sk', 'ant', 'api03', ''].join('-')
/** A key in that shape: the prefix and a tail of letters. */
export const antKey = (tail = ['abcdefgh', 'ijklmnop'].join('')) => `${ANT_PREFIX}${tail}`
/** A GitHub token in the shape `ghp_` and letters and digits. */
export const ghpToken = (tail = ['abcdefghijklmnop', 'qrstuvwxyz0123'].join('')) => ['ghp', tail].join('_')
/** An AWS access key id: `AKIA` and sixteen capitals. */
export const AWS_KEY = ['AKIA', 'ABCDEFGH', 'IJKLMNOP'].join('')
/** A hash of 32 hex digits. */
export const HEX_HASH = ['0123456789abcdef', '0123456789abcdef'].join('')
/** A run of 36 letters and digits in both cases, as a random string looks. */
export const MIXED_RUN = ['aB3dE5fG7hI9jK1lM3nO5', 'pQ7rS9tU1vW3xY5'].join('')
/** Another, of 34. */
export const MIXED_RUN_34 = ['aB3dE5gH7jK9mN1pQ3rS5', 'tU7vW9xY1zA3c'].join('')
/** A run of 32 lower-case letters and digits, as `sk-` is followed by. */
export const LONG_ALNUM = ['abcdefghijklmnopqr', 'stuvwxyz123456'].join('')
/** `sk-` and a long run: a key in the old shape. */
export const skKey = (tail = LONG_ALNUM) => ['sk', tail].join('-')
