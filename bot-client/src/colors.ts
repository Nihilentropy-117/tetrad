// ANSI helpers: humans act in green, the bot thinks/talks in blue, the bot
// acts in orange. Disabled when not a TTY or NO_COLOR is set.

const enabled = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

const paint = (code: string) => (s: string) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);

export const green = paint("32"); // human actions
export const blue = paint("94"); // bot thinking / talking
export const orange = paint("38;5;208"); // bot actions & commands
export const dim = paint("2"); // neutral game bookkeeping
