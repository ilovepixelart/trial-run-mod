/**
 * A charge: why a shell command goes to trial.
 */
export type Charge = {
  id: string
  /**
   * The simple command the charge fits, as tried: wrappers, env assignments
   * and the rest of a compound command left out.
   */
  command: string
  /**
   * What the court reads out, in a few words.
   */
  label: string
}

type Rule = Omit<Charge, 'command'> & {
  /**
   * Whether one simple command (its words, wrappers and env assignments
   * already stripped) is this charge.
   */
  test: (words: readonly string[]) => boolean
}

const SQL_CLIENTS = new Set([
  'psql',
  'mysql',
  'mariadb',
  'sqlite3',
  'sqlcmd',
  'duckdb',
  'clickhouse-client',
  'cockroach',
])

const hasShortFlag = (words: readonly string[], letter: string) =>
  words.some(word => /^-[a-zA-Z]+$/.test(word) && word.includes(letter))

const isGit = (words: readonly string[], sub: string) =>
  words[0] === 'git' && words.includes(sub)

/**
 * The charges, in the order the court tries them; the first that fits is
 * read out. Matching is by spelling and best effort: a command assembled at
 * run time (a variable, a script file) is not seen.
 */
export const RULES: readonly Rule[] = [
  {
    id: 'recursive-delete',
    label: 'recursive delete',
    test: words =>
      (words[0] === 'rm' &&
        (hasShortFlag(words, 'r') ||
          hasShortFlag(words, 'R') ||
          words.includes('--recursive'))) ||
      (words[0] === 'find' && words.includes('-delete')),
  },
  {
    id: 'force-push',
    label: 'force push',
    test: words =>
      isGit(words, 'push') &&
      (words.some(word => word.startsWith('--force')) ||
        hasShortFlag(words.slice(2), 'f') ||
        words.slice(2).some(word => /^\+[^\s]/.test(word))),
  },
  {
    id: 'hard-reset',
    label: 'hard reset',
    test: words => isGit(words, 'reset') && words.includes('--hard'),
  },
  {
    id: 'git-clean',
    label: 'git clean',
    // -n / --dry-run only lists what would go
    test: words =>
      isGit(words, 'clean') &&
      (words.includes('--force') || hasShortFlag(words.slice(2), 'f')) &&
      !(words.includes('--dry-run') || hasShortFlag(words.slice(2), 'n')),
  },
  {
    id: 'drop-table',
    label: 'dropped or truncated data',
    test: words =>
      SQL_CLIENTS.has(words[0] ?? '') &&
      /\b(drop\s+(table|database|schema)|truncate)\b/i.test(words.join(' ')),
  },
  {
    id: 'kubectl-delete',
    label: 'kubectl delete',
    test: words => words[0] === 'kubectl' && words.slice(1).includes('delete'),
  },
  {
    id: 'terraform-destroy',
    label: 'terraform destroy',
    test: words =>
      (words[0] === 'terraform' || words[0] === 'tofu') &&
      (words.slice(1).includes('destroy') ||
        (words.slice(1).includes('apply') && words.includes('-destroy'))),
  },
]

const WRAPPERS = new Set(['sudo', 'env', 'nice', 'time', 'command', 'exec', 'nohup', 'xargs'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash'])

const wordsOf = (segment: string): string[] =>
  segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []

const unquoted = (word: string) => word.replace(/^(["'])([\s\S]*)\1$/, '$2')

/**
 * A word with a quote left dangling by a separator split inside quotes
 * (`bash -c 'cd app; git reset --hard'` splits into `... 'cd app` and
 * `git reset --hard'`) dropped, so the halves still match a charge.
 */
const bare = (word: string) => unquoted(word).replace(/^["']|["']$/g, '')

/**
 * Splits a command line into simple commands at `&&`, `||`, `;`, `|` and
 * newlines. A separator inside quotes splits too: that can only put more
 * commands on trial, never fewer.
 */
const segmentsOf = (command: string): string[] =>
  command.split(/&&|\|\||[;|\n]/)

type Simple = {
  /** What a charge is matched against: wrappers and quotes removed. */
  words: string[]
  /** The simple command as the model wrote it, for the court to read out. */
  text: string
}

/**
 * A segment as written, less a quote left dangling by a split inside quotes.
 */
const spellingOf = (segment: string) => {
  const text = segment.trim()
  const balanced = (quote: string) => (text.split(quote).length - 1) % 2 === 0
  return text
    .replace(/^(["'])/, (q: string) => (balanced(q) ? q : ''))
    .replace(/(["'])$/, (q: string) => (balanced(q) ? q : ''))
}

/**
 * The simple commands of one segment, each with its leading env assignments
 * and wrappers (`sudo`, `env`, `xargs`, ...) removed from the words it is
 * matched on; for `bash -c '...'` and `eval '...'`, the commands inside instead.
 */
const commandsOf = (segment: string, depth = 0): Simple[] => {
  const words = wordsOf(segment.trim())
  let at = 0
  while (at < words.length) {
    const word = words[at] ?? ''
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || WRAPPERS.has(word)) {
      at += 1
    } else if (at > 0 && WRAPPERS.has(words[at - 1] ?? '') && word.startsWith('-')) {
      at += 1
    } else {
      break
    }
  }
  const rest = words.slice(at)
  const inner = innerScriptOf(rest)
  if (inner !== undefined && depth < 3) {
    return segmentsOf(inner).flatMap(part => commandsOf(part, depth + 1))
  }
  return [{ words: rest.map(bare), text: spellingOf(segment) }]
}

const innerScriptOf = (words: readonly string[]): string | undefined => {
  if (words[0] === 'eval') {
    return words.slice(1).map(unquoted).join(' ')
  }
  const flag = words.indexOf('-c')
  if (SHELLS.has(words[0] ?? '') && flag > 0) {
    return unquoted(words[flag + 1] ?? '')
  }
  return undefined
}

/**
 * The charge a shell command is tried on, or undefined to let it pass
 * without a trial.
 *
 * @param command the Bash tool's `command`, as the model wrote it
 */
export const chargeOf = (command: string): Charge | undefined => chargedOf(command)?.charge

/**
 * The charge a shell command is tried on, with the charged simple
 * command's own words (wrappers and quotes set aside), or undefined.
 *
 * @param command the Bash tool's `command`, as the model wrote it
 */
export const chargedOf = (command: string): { charge: Charge; words: readonly string[] } | undefined => {
  for (const { words, text } of segmentsOf(command).flatMap(segment => commandsOf(segment))) {
    const rule = RULES.find(one => one.test(words))
    if (rule) {
      return { charge: { id: rule.id, label: rule.label, command: text }, words }
    }
  }
  return undefined
}
