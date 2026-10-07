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

const WRAPPERS = new Set(['sudo', 'env', 'nice', 'time', 'command', 'builtin', 'exec', 'nohup', 'xargs'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash'])

/**
 * Reserved words that lead a simple command inside a compound one
 * (`if x; then rm ...`, `{ rm ...; }`, `! rm ...`).
 */
const KEYWORDS = new Set(['!', '{', 'if', 'then', 'else', 'elif', 'while', 'until', 'do'])

/**
 * Every program a charge names: a command name the shell only resolves at
 * run time (`$RM`, `"$(echo rm)"`, `/bin/r?`) is tried as each of them.
 */
const PROGRAMS = ['rm', 'find', 'git', 'kubectl', 'terraform', 'tofu', ...SQL_CLIENTS]

/**
 * A wrapper's options that take the next word as their value, so that word
 * is not read as the command (`nice -n 10 rm`, `sudo -u root rm`).
 */
const WRAPPER_VALUES = new Map<string, readonly string[]>([
  [
    'sudo',
    ['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-T', '--user', '--group', '--host', '--prompt', '--chdir', '--role', '--type', '--other-user'],
  ],
  ['env', ['-u', '-C', '--unset', '--chdir']],
  ['nice', ['-n', '--adjustment']],
  ['time', ['-f', '-o', '--format', '--output']],
  ['exec', ['-a']],
  [
    'xargs',
    ['-I', '-n', '-L', '-P', '-s', '-d', '-E', '-a', '--arg-file', '--delimiter', '--max-args', '--max-lines', '--max-procs', '--max-chars'],
  ],
])

/**
 * One word as the shell reads it: its text after quote removal, and whether
 * that text is exact, with no expansion, glob or escape left to run time.
 */
type Word = { text: string; exact: boolean }

const ANSI_ESCAPES: Readonly<Record<string, string>> = {
  a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v',
  '\\': '\\', "'": "'", '"': '"', '?': '?',
}

/**
 * The text of a `$'...'` body, or undefined for an escape it does not read.
 */
const ansiTextOf = (body: string): string | undefined => {
  let text = ''
  for (let at = 0; at < body.length; at += 1) {
    const rest = body.slice(at + 1)
    const code = /^x[0-9A-Fa-f]{1,2}|^[0-7]{1,3}/.exec(rest)?.[0]
    const named = ANSI_ESCAPES[rest[0] ?? '']
    if (body[at] !== '\\') {
      text += body[at]
    } else if (code !== undefined) {
      text += String.fromCharCode(code.startsWith('x') ? parseInt(code.slice(1), 16) : parseInt(code, 8))
      at += code.length
    } else if (named === undefined) {
      return undefined
    } else {
      text += named
      at += 1
    }
  }
  return text
}

/**
 * The index just past the closing `)` or `}` that matches the opening one
 * at `open`, or the end of the line when there is none.
 */
const closeOf = (line: string, open: number): number => {
  const [left, right] = line[open] === '{' ? ['{', '}'] : ['(', ')']
  let depth = 0
  for (let at = open; at < line.length; at += 1) {
    depth += line[at] === left ? 1 : line[at] === right ? -1 : 0
    if (depth === 0) {
      return at + 1
    }
  }
  return line.length
}

/**
 * The expansion that starts at `at`, if any: where it ends, and the command
 * it runs for a command substitution (`$(...)`, `` `...` ``).
 */
const expansionAt = (line: string, at: number): { end: number; script?: string } | undefined => {
  if (line[at] === '`') {
    const close = line.indexOf('`', at + 1)
    const end = close === -1 ? line.length : close + 1
    return { end, script: line.slice(at + 1, close === -1 ? end : close) }
  }
  if (line[at] !== '$') {
    return undefined
  }
  const next = line[at + 1] ?? ''
  if (next === '(' || next === '{') {
    const end = closeOf(line, at + 1)
    return next === '(' ? { end, script: line.slice(at + 2, end - 1) } : { end }
  }
  const name = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(line.slice(at + 1))?.[0]
  return name === undefined ? undefined : { end: at + 1 + name.length }
}

/**
 * The index of the quote closing the one at `open`, past escapes where
 * they apply, or -1 when it is left dangling. A quote nested in a
 * substitution closes early, which only leaves the word inexact.
 */
const closingQuoteOf = (line: string, open: number, escapes: boolean): number => {
  const quote = line[open] === "'" ? "'" : '"'
  for (let at = open + 1; at < line.length; at += 1) {
    if (escapes && line[at] === '\\') {
      at += 1
    } else if (line[at] === quote) {
      return at
    }
  }
  return -1
}

/**
 * The text of a `"..."` body: `\` escapes only `$`, `` ` ``, `"`, `\` and a
 * newline, and an expansion leaves the text inexact.
 */
const doubleQuotedOf = (body: string, scripts: string[]): Word => {
  let text = ''
  let exact = true
  for (let at = 0; at < body.length; at += 1) {
    const expansion = expansionAt(body, at)
    if (body[at] === '\\' && '$`"\\\n'.includes(body[at + 1] ?? 'x')) {
      text += body[at + 1] === '\n' ? '' : body[at + 1]
      at += 1
    } else if (expansion === undefined) {
      text += body[at]
    } else {
      text += body.slice(at, expansion.end)
      exact = false
      if (expansion.script !== undefined) scripts.push(expansion.script)
      at = expansion.end - 1
    }
  }
  return { text, exact }
}

/**
 * Whether an unquoted `*`, `?`, `[...]` or `{a,b}` at `at` is a pattern the
 * shell expands.
 */
const isPatternAt = (line: string, at: number) =>
  line[at] === '*' ||
  line[at] === '?' ||
  (line[at] === '[' && /^\[[^\s\]]+\]/.test(line.slice(at))) ||
  (line[at] === '{' && /^\{[^\s{}]*(,|\.\.)[^\s{}]*\}/.test(line.slice(at)))

/**
 * A redirection operator at `at` (`>`, `2>`, `&>`, `>>`, `<<<`, `>&2`, ...):
 * its length, and whether the next word is its target.
 */
const redirectionAt = (line: string, at: number): { length: number; target: boolean } | undefined => {
  const match = /^&?(?:<<<|<<-?|<>|>>|>\||[<>])(&(?:\d+|-))?/.exec(line.slice(at))
  return match === null ? undefined : { length: match[0].length, target: match[1] === undefined }
}

/**
 * The quoted part or expansion at `at`, read into the word: where it ends,
 * or undefined for a plain character.
 */
const quotedAt = (line: string, at: number, scripts: string[]): (Word & { end: number }) | undefined => {
  const char = line[at]
  if (char === "'" || (char === '$' && line[at + 1] === "'")) {
    const open = char === '$' ? at + 1 : at
    const close = closingQuoteOf(line, open, char === '$')
    const body = line.slice(open + 1, close)
    const text = char === '$' ? ansiTextOf(body) : body
    return close === -1
      ? { text: '', exact: true, end: open + 1 }
      : { text: text ?? body, exact: text !== undefined, end: close + 1 }
  }
  if (char === '"' || (char === '$' && line[at + 1] === '"')) {
    const open = char === '$' ? at + 1 : at
    const close = closingQuoteOf(line, open, true)
    return close === -1
      ? { text: '', exact: true, end: open + 1 }
      : { ...doubleQuotedOf(line.slice(open + 1, close), scripts), end: close + 1 }
  }
  const expansion = expansionAt(line, at)
  if (expansion?.script !== undefined) scripts.push(expansion.script)
  return expansion === undefined ? undefined : { text: line.slice(at, expansion.end), exact: false, end: expansion.end }
}

/**
 * The words of one segment as the shell reads them, with redirections and
 * their targets left out, and the commands its substitutions run. A quote
 * left dangling by a separator split inside quotes (`bash -c 'cd app` and
 * `git reset --hard'`) is dropped, so the halves still match a charge.
 */
const lexOf = (line: string): { words: Word[]; scripts: string[] } => {
  const words: Word[] = []
  const scripts: string[] = []
  let word: Word | undefined
  let target = false
  const end = () => {
    if (word !== undefined && !target) words.push(word)
    if (word !== undefined) target = false
    word = undefined
  }
  const add = (text: string, exact: boolean) => {
    word = { text: (word?.text ?? '') + text, exact: (word?.exact ?? true) && exact }
  }
  for (let at = 0; at < line.length; ) {
    const char = line[at] ?? ''
    const part = quotedAt(line, at, scripts)
    const redirection = redirectionAt(line, at)
    if (part !== undefined) {
      add(part.text, part.exact)
      at = part.end
    } else if (redirection !== undefined) {
      if (word !== undefined && /^\d+$/.test(word.text)) word = undefined
      end()
      target = redirection.target
      at += redirection.length
    } else if (/[\s()&]/.test(char)) {
      end()
      at += 1
    } else if (char === '\\') {
      add(line[at + 1] ?? '', true)
      at += 2
    } else {
      add(char, !isPatternAt(line, at))
      at += 1
    }
  }
  end()
  return { words, scripts }
}

/**
 * The program a command word names, read case-blind as a case-blind file
 * system (the macOS default) runs it: a path read as its last part
 * (`/bin/rm`). Undefined when the shell only resolves it at run time.
 */
const programOf = (word: Word): string | undefined =>
  word.exact ? word.text.slice(word.text.lastIndexOf('/') + 1).toLowerCase() : undefined

/**
 * The name a command word runs, however it is spelled: quotes, escapes and
 * case dropped, and a path (`/bin/rm`) read as its last part; the word
 * itself when the shell only resolves it at run time.
 */
export const nameOf = (word: string) => {
  const [first] = lexOf(word).words
  return (first === undefined ? undefined : programOf(first)) ?? word
}

const SEPARATOR = /^(?:&&|\|\||\|&|[;|\n]|&(?!>))/

/**
 * A command line split at the separators outside quotes, as the shell
 * splits it, so a nested script (`bash -c "a; \"rm\" -rf x"`) stays whole.
 */
const shellSplitOf = (line: string): string[] => {
  const parts: string[] = []
  let start = 0
  for (let at = 0; at < line.length; ) {
    const char = line[at] ?? ''
    const separator = SEPARATOR.exec(line.slice(at))?.[0]
    if (char === '\\') {
      at += 2
    } else if (char === "'" || char === '"') {
      const close = closingQuoteOf(line, at, char === '"')
      at = close === -1 ? at + 1 : close + 1
    } else if (separator === undefined || line[at - 1] === '<' || line[at - 1] === '>') {
      at += 1
    } else {
      parts.push(line.slice(start, at))
      at += separator.length
      start = at
    }
  }
  return [...parts, line.slice(start)]
}

/**
 * Splits a command line into simple commands at `&&`, `||`, `;`, `|`, `&`
 * and newlines, a line continuation joined first: once as the shell splits
 * it, then again at every separator, inside quotes too. The second reading
 * can only put more commands on trial, never fewer.
 */
const segmentsOf = (command: string): string[] => {
  const line = command.replace(/\\\n/g, '')
  return [...shellSplitOf(line), ...line.split(/&&|\|\||(?<![<>|])&(?!>)|[;|\n]/)]
}

type Simple = {
  /** What a charge is matched against: wrappers and quotes removed. */
  words: string[]
  /** Whether the command name is only resolved at run time. */
  open: boolean
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
 * The script `env -S` splits into a command line, with the words after it.
 */
const splitStringOf = (words: readonly Word[], at: number): string | undefined => {
  const option = words[at]?.text ?? ''
  const long = /^--split-string(=|$)/.exec(option)
  if (option === '-S' || long?.[1] === '') {
    return words.slice(at + 1).map(word => word.text).join(' ')
  }
  if (option.startsWith('-S') || long !== null) {
    const value = long === null ? option.slice(2) : option.slice(long[0].length)
    return [value, ...words.slice(at + 1).map(word => word.text)].join(' ')
  }
  return undefined
}

/**
 * Where the command starts past leading env assignments, keywords and
 * wrappers with their options, or the script an `env -S` runs instead.
 */
const commandStartOf = (words: readonly Word[]): { at: number; script?: string } => {
  let at = 0
  let wrapper: string | undefined
  while (at < words.length) {
    const word = words[at] ?? { text: '', exact: true }
    const program = programOf(word)
    const script = wrapper === 'env' ? splitStringOf(words, at) : undefined
    if (script !== undefined) {
      return { at, script }
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word.text) || (word.exact && KEYWORDS.has(word.text))) {
      at += 1
    } else if (program !== undefined && WRAPPERS.has(program)) {
      wrapper = program
      at += 1
    } else if (wrapper !== undefined && word.text.startsWith('-')) {
      at += WRAPPER_VALUES.get(wrapper)?.includes(word.text) ? 2 : 1
    } else {
      break
    }
  }
  return { at }
}

/**
 * The simple commands of one segment, each with its leading env assignments,
 * keywords and wrappers (`sudo`, `env`, `xargs`, ...) removed from the words
 * it is matched on; for `bash -c '...'`, `eval '...'` and `env -S '...'`, the
 * commands inside instead; and the commands its substitutions run.
 */
const commandsOf = (segment: string, depth = 0): Simple[] => {
  const nested = (script: string) =>
    depth < 3 ? segmentsOf(script).flatMap(part => commandsOf(part, depth + 1)) : []
  const { words, scripts } = lexOf(segment.trim())
  const start = commandStartOf(words)
  const [head, ...args] = words.slice(start.at)
  const program = head === undefined ? undefined : programOf(head)
  const rest = head === undefined ? [] : [program ?? head.text, ...args.map(word => word.text)]
  const inner = start.script ?? innerScriptOf(rest)
  const open = head !== undefined && program === undefined
  const own: Simple[] = inner === undefined ? [{ words: rest, open, text: spellingOf(segment) }] : nested(inner)
  return [...own, ...scripts.flatMap(nested)]
}

const innerScriptOf = (words: readonly string[]): string | undefined => {
  if (words[0] === 'eval') {
    return words.slice(1).join(' ')
  }
  const flag = words.indexOf('-c')
  if (SHELLS.has(words[0] ?? '') && flag > 0) {
    return words[flag + 1] ?? ''
  }
  return undefined
}

/**
 * Plain words only: no quote, escape, expansion, glob, brace, redirection,
 * operator, comment or tab can appear, so the line runs what it spells.
 */
const PLAIN_LINE = /^[A-Za-z0-9_@%+=:,./~ -]+$/

/**
 * A `~` the shell expands: at the start of a word, or after `=` or `:`.
 */
const TILDE = /(^|[ =:])~/

const NOT_SIMPLE_HEADS = new Set([...WRAPPERS, ...SHELLS, 'eval', 'source', '.'])

/**
 * Whether a whole command line is one simple command of plain words: no
 * compound operator, substitution, variable, glob, brace or tilde
 * expansion, redirection, quoting, env assignment, wrapper or nested shell.
 * Anything the check cannot read as plain is not simple.
 *
 * @param command the Bash tool's `command`, as the model wrote it
 */
export const isSimpleCommand = (command: string): boolean => {
  const head = command.trim().split(/\s+/)[0] || undefined
  return (
    PLAIN_LINE.test(command) &&
    !TILDE.test(command) &&
    head !== undefined &&
    !head.includes('=') &&
    !NOT_SIMPLE_HEADS.has(nameOf(head))
  )
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
  for (const { words, open, text } of segmentsOf(command).flatMap(segment => commandsOf(segment))) {
    const tried = open ? PROGRAMS.map(program => [program, ...words.slice(1)]) : [words]
    for (const one of tried) {
      const rule = RULES.find(candidate => candidate.test(one))
      if (rule) {
        return { charge: { id: rule.id, label: rule.label, command: text }, words: one }
      }
    }
  }
  return undefined
}
