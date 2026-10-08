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
 * SQL with each closed block comment read as the space it stands for,
 * found by a scan: a regex over the comments backtracks exponentially on a
 * run of them.
 */
const uncommentedOf = (sql: string): string => {
  let text = ''
  let at = 0
  for (;;) {
    const open = sql.indexOf('/*', at)
    const close = open === -1 ? -1 : sql.indexOf('*/', open + 2)
    if (close === -1) {
      return text + sql.slice(at)
    }
    text += `${sql.slice(at, open)} `
    at = close + 2
  }
}

/**
 * The charges, in the order the court tries them; the first that fits is
 * read out. Matching is by spelling and best effort: a command assembled at
 * run time is not seen, such as a flag from a variable (`rm $F src`),
 * `eval "$CMD"`, `source <(curl ...)`, an alias, or a script file a shell is
 * given by name (`bash x.sh`).
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
      // read with its comments and without: MySQL runs a /*! or /*+ body
      [words.join(' '), uncommentedOf(words.join(' '))].some(sql => /\b(drop\s+(table|database|schema)|truncate)\b/i.test(sql)),
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

/**
 * The charge for a script a shell or SQL client reads that the line does
 * not spell: a file, a download, an expansion (`curl ... | sh`, `bash <
 * x.sh`, `psql -f drop.sql`). What it would run is unknown, so it is tried.
 */
const UNREAD: Omit<Charge, 'command'> = { id: 'unread-script', label: 'unread script' }

/**
 * The options that name a file of SQL for a client to run.
 */
const SQL_FILE_OPTIONS = new Map<string, readonly string[]>([
  ['psql', ['-f', '--file']],
  ['cockroach', ['-f', '--file']],
  ['duckdb', ['-f', '-init']],
  ['sqlite3', ['-init']],
  ['sqlcmd', ['-i', '--input-file']],
  ['clickhouse-client', ['--queries-file']],
])

/**
 * Programs that run the command in the words after their own options and
 * operands; `watch` and `parallel` hand those words to a shell as a script.
 */
const WRAPPERS = new Set([
  'sudo', 'env', 'nice', 'time', 'command', 'builtin', 'exec', 'nohup', 'xargs', 'timeout', 'stdbuf', 'chroot', 'doas',
  'setsid', 'ionice', 'taskset', 'flock', 'caffeinate', 'watch', 'parallel', 'busybox', 'noglob', 'nocorrect',
])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'fish'])

/**
 * Programs that run the value of their `-c` / `--command` option as a shell
 * script (`su -c '...'`, `sg staff -c '...'`, `script -c '...'`).
 */
const RUNNERS = new Set(['su', 'sg', 'script'])

/**
 * Reserved words that lead a simple command inside a compound one
 * (`if x; then rm ...`, `{ rm ...; }`, `! rm ...`, `coproc rm ...`).
 */
const KEYWORDS = new Set(['!', '{', 'if', 'then', 'else', 'elif', 'while', 'until', 'do', 'coproc'])

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
  ['timeout', ['-s', '-k', '--signal', '--kill-after']],
  ['stdbuf', ['-i', '-o', '-e', '--input', '--output', '--error']],
  ['chroot', ['--userspec', '--groups']],
  ['doas', ['-u', '-C']],
  ['ionice', ['-c', '-n', '-p', '-P', '-u', '--class', '--classdata', '--pid', '--pgid', '--uid']],
  ['flock', ['-w', '-E', '--wait', '--timeout', '--conflict-exit-code']],
  ['caffeinate', ['-w', '-t']],
  ['watch', ['-n', '--interval']],
  ['parallel', ['-j', '-S', '-n', '-N', '-L', '-I', '-d', '-a', '-E', '--jobs', '--sshlogin', '--arg-file', '--delimiter', '--max-args', '--colsep', '--joblog', '--results', '--env', '--tmpdir', '--timeout']],
  [
    'xargs',
    ['-I', '-n', '-L', '-P', '-s', '-d', '-E', '-a', '--arg-file', '--delimiter', '--max-args', '--max-lines', '--max-procs', '--max-chars'],
  ],
])

/**
 * How many operands a wrapper takes before the command: the duration of
 * `timeout 5 rm`, the root of `chroot / rm`, the mask of `taskset 1 rm` and
 * the lock file of `flock /tmp/lock rm`.
 */
const WRAPPER_OPERANDS = new Map([
  ['timeout', 1],
  ['chroot', 1],
  ['taskset', 1],
  ['flock', 1],
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
const redirectionAt = (line: string, at: number): { length: number; target: boolean; input?: Input['kind'] } | undefined => {
  const match = /^&?(<<<|<<-?|<>|>>|>\||[<>])(&(?:\d+|-))?/.exec(line.slice(at))
  const input = match?.[2] === undefined ? INPUTS[match?.[1] ?? ''] : undefined
  return match === null ? undefined : { length: match[0].length, target: match[2] === undefined, ...(input === undefined ? {} : { input }) }
}

/**
 * What a command reads on its input from a redirection: a here-string's
 * word, the here-document after the line, or a file.
 */
type Input = { kind: 'string'; word: Word } | { kind: 'document' } | { kind: 'file' }

const INPUTS: Readonly<Record<string, Input['kind']>> = { '<<<': 'string', '<<': 'document', '<<-': 'document', '<': 'file' }

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
 * their targets left out, the commands its substitutions run, where a `(`
 * or `)` opens or ends a group or a case pattern (`(x)`, `x)`, `f()`), as
 * the count of words before it (the words after start a command of their
 * own), and what its input is redirected from. A quote left dangling by a
 * separator split inside quotes (`bash -c 'cd app` and `git reset --hard'`)
 * is dropped, so the halves still match a charge.
 */
const lexOf = (line: string): { words: Word[]; scripts: string[]; breaks: number[]; input?: Input } => {
  const words: Word[] = []
  const scripts: string[] = []
  const breaks: number[] = []
  let word: Word | undefined
  let target = false
  let input: Input | undefined
  const end = () => {
    if (word !== undefined && !target) words.push(word)
    if (word !== undefined && target && input?.kind === 'string' && input.word.text === '') input = { kind: 'string', word }
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
      if (redirection.input !== undefined) input = redirection.input === 'string' ? { kind: 'string', word: { text: '', exact: true } } : { kind: redirection.input }
      at += redirection.length
    } else if (/[\s()&]/.test(char)) {
      end()
      if (char === '(' || char === ')') breaks.push(words.length)
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
  return { words, scripts, breaks, ...(input === undefined ? {} : { input }) }
}

/**
 * The program a command word names, read case-blind as a case-blind file
 * system (the macOS default) runs it: a path read as its last part
 * (`/bin/rm`), and zsh's `=rm` as `rm`. Undefined when the shell only
 * resolves it at run time.
 */
const programOf = (word: Word): string | undefined =>
  word.exact ? word.text.slice(word.text.lastIndexOf('/') + 1).replace(/^=(?=.)/, '').toLowerCase() : undefined

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
 * A segment of a command line, with what feeds its input: the segment
 * piped into it (`a | b`), and the here-document its `<<` reads.
 */
type Part = { text: string; from?: Part; document?: Document }

/**
 * A here-document: its body, whether the body is read as written (its
 * delimiter quoted, or nothing in it to expand), and the whole of it as
 * written, from the end of the line that opens it.
 */
type Document = { body: string; exact: boolean; spelling: string }

const HEREDOC = /^<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|(\\?[^\s;&|<>()]+))/

/**
 * The here-document a `<<` at `at` opens, with the newline it starts after
 * and where it ends.
 */
const documentAt = (line: string, at: number): { newline: number; end: number; document: Document } | undefined => {
  const match = line[at - 1] === '<' ? null : HEREDOC.exec(line.slice(at))
  const newline = line.indexOf('\n', at)
  if (match === null || match[0].startsWith('<<<') || newline === -1) {
    return undefined
  }
  const delimiter = match[2] ?? match[3] ?? (match[4] ?? '').replace(/^\\/, '')
  const lines = line.slice(newline + 1).split('\n')
  const close = lines.findIndex(body => (match[1] === '-' ? body.replace(/^\t+/, '') : body) === delimiter)
  const body = (close === -1 ? lines : lines.slice(0, close)).join('\n')
  const end = close === -1 ? line.length : newline + 1 + lines.slice(0, close + 1).join('\n').length
  const isQuoted = match[2] !== undefined || match[3] !== undefined || (match[4] ?? '').startsWith('\\')
  return { newline, end, document: { body, exact: isQuoted || !/[$`\\]/.test(body), spelling: line.slice(newline, end) } }
}

/**
 * A command line split at the separators outside quotes, as the shell
 * splits it, so a nested script (`bash -c "a; \"rm\" -rf x"`) stays whole,
 * each segment with the segment piped into it and the here-document it
 * reads; a here-document's body is input, not commands.
 */
const shellSplitOf = (line: string): Part[] => {
  const parts: Part[] = []
  let start = 0
  let from: Part | undefined
  let document: ReturnType<typeof documentAt>
  let isOwn = false
  const push = (end: number, separator: string) => {
    const part = { text: line.slice(start, end), ...(from === undefined ? {} : { from }), ...(isOwn && document ? { document: document.document } : {}) }
    parts.push(part)
    from = separator === '|' || separator === '|&' ? part : undefined
    isOwn = false
  }
  for (let at = 0; at < line.length; ) {
    const char = line[at] ?? ''
    const separator = SEPARATOR.exec(line.slice(at))?.[0]
    const opened = char === '<' && document === undefined ? documentAt(line, at) : undefined
    if (opened !== undefined) {
      document = opened
      isOwn = true
      at += 2
    } else if (char === '\\') {
      at += 2
    } else if (char === "'" || char === '"') {
      const close = closingQuoteOf(line, at, char === '"')
      at = close === -1 ? at + 1 : close + 1
    } else if (separator === undefined || line[at - 1] === '<' || line[at - 1] === '>') {
      at += 1
    } else {
      push(at, separator)
      at = at === document?.newline ? document.end : at + separator.length
      document = at === document?.end ? undefined : document
      start = at
    }
  }
  push(line.length, '')
  return parts
}

/**
 * Splits a command line into simple commands at `&&`, `||`, `;`, `|`, `&`
 * and newlines, a line continuation joined first: once as the shell splits
 * it, then again at every separator, inside quotes too. The second reading
 * can only put more commands on trial, never fewer.
 */
const segmentsOf = (command: string): Part[] => {
  const line = command.replace(/\\\n/g, '')
  return [...shellSplitOf(line), ...line.split(/&&|\|\||(?<![<>|])&(?!>)|[;|\n]/).map(text => ({ text }))]
}

type Simple = {
  /** What a charge is matched against: wrappers and quotes removed. */
  words: string[]
  /** Whether the command name is only resolved at run time. */
  open: boolean
  /** The simple command as the model wrote it, for the court to read out. */
  text: string
  /**
   * The words of the command that runs this one for each file (`find ...
   * -exec`), to stand for it in place of `words` once charged.
   */
  whole?: string[]
  /** Whether this is a script the court cannot read, charged as such. */
  unread?: boolean
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
 * The script a wrapper runs from the words at `at`: what `env -S` splits,
 * the value of `flock -c`, or every word left for `watch` and `parallel`
 * (its `:::` arguments included: each is added to the command).
 */
const wrapperScriptOf = (wrapper: string, words: readonly Word[], at: number): string | undefined => {
  const texts = words.map(word => word.text)
  if (wrapper === 'env') {
    return splitStringOf(words, at)
  }
  if (wrapper === 'flock') {
    return commandOptionOf(texts, at)
  }
  const isScript = (wrapper === 'watch' || wrapper === 'parallel') && !(texts[at] ?? '').startsWith('-')
  return isScript ? texts.slice(at).join(' ') : undefined
}

/**
 * Where the command starts past leading env assignments, keywords and
 * wrappers with their options and operands, or the script a wrapper runs
 * instead.
 */
const commandStartOf = (words: readonly Word[]): { at: number; script?: string } => {
  let at = 0
  let wrapper: string | undefined
  let operands = 0
  while (at < words.length) {
    const word = words[at] ?? { text: '', exact: true }
    const program = programOf(word)
    const script = wrapper === undefined ? undefined : wrapperScriptOf(wrapper, words, at)
    if (script !== undefined) {
      return { at, script }
    }
    if (word.exact && (word.text === 'function' || (word.text === 'coproc' && words[at + 2]?.text === '{'))) {
      // a function's or a named coproc's name
      at += 2
    } else if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word.text) || (word.exact && KEYWORDS.has(word.text))) {
      at += 1
    } else if (program !== undefined && WRAPPERS.has(program)) {
      wrapper = program
      operands = WRAPPER_OPERANDS.get(program) ?? 0
      at += 1
    } else if (wrapper !== undefined && word.text.startsWith('-')) {
      at += WRAPPER_VALUES.get(wrapper)?.includes(word.text) ? 2 : 1
    } else if (operands > 0) {
      operands -= 1
      at += 1
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
const commandsOf = (part: Part, depth = 0): Simple[] => {
  const nested = (script: string) =>
    depth < 3 ? segmentsOf(script).flatMap(inner => commandsOf(inner, depth + 1)) : []
  const { words, scripts, breaks, input } = lexOf(part.text.trim())
  const ends = [...breaks, words.length]
  const groups = [0, ...breaks].map((from, index) => words.slice(from, ends[index]))
  return [...groups.flatMap(group => simpleOf(group, { part, input, nested })), ...scripts.flatMap(nested)]
}

/**
 * Where a group of words stands: its segment, what its input is
 * redirected from, and how to read a script it runs.
 */
type Context = { part: Part; input: Input | undefined; nested: (script: string) => Simple[] }

/**
 * The simple command of one group of words, or the commands of the script
 * it runs, with those of a script it reads on its input.
 */
const simpleOf = (words: readonly Word[], context: Context): Simple[] => {
  const start = commandStartOf(words)
  const [head, ...args] = words.slice(start.at)
  const program = head === undefined ? undefined : programOf(head)
  const rest = head === undefined ? [] : [program ?? head.text, ...args.map(word => word.text)]
  const inner = start.script ?? innerScriptOf(rest)
  const open = head !== undefined && program === undefined
  const own = inner === undefined ? [{ words: rest, open, text: spellingOf(context.part.text) }] : context.nested(inner)
  const fed = inner === undefined ? fedOf(rest, context) : []
  const perFile = program === 'find' ? execsOf(args) : []
  return [...own, ...fed, ...perFile.flatMap(command => simpleOf(command, context).map(simple => ({ ...simple, whole: rest })))]
}

/**
 * The script a command reads on its input: from a here-string, its
 * here-document, or the segment piped into it; `unread` for a file or
 * anything else the line does not spell; undefined for no input.
 */
const inputOf = (part: Part, input: Input | undefined): { script: string; exact: boolean } | 'unread' | undefined => {
  if (input?.kind === 'string') {
    return { script: input.word.text, exact: input.word.exact }
  }
  if (input?.kind === 'document') {
    // a segment split inside quotes knows no here-document; the shell's own split does
    return part.document === undefined ? undefined : { script: part.document.body, exact: part.document.exact }
  }
  if (input?.kind === 'file') {
    return 'unread'
  }
  return part.from === undefined ? undefined : outputOf(part.from)
}

/**
 * What a segment writes to a pipe when the line spells it: the words of
 * `echo` or `printf` (`\n` read as a new line), or the input `cat` passes
 * on; `unread` for any other program.
 */
const outputOf = (part: Part): ReturnType<typeof inputOf> => {
  const { words, input } = lexOf(part.text.trim())
  const [head, ...args] = words.slice(commandStartOf(words).at)
  const program = head === undefined ? undefined : programOf(head)
  if (program === 'echo' || program === 'printf') {
    const shown = program === 'echo' ? args.filter((word, at) => !args.slice(0, at + 1).every(one => /^-[neE]+$/.test(one.text))) : args
    const script = shown.map(word => word.text).join(program === 'echo' ? ' ' : '\n').replaceAll('\\n', '\n')
    return { script, exact: shown.every(word => word.exact) }
  }
  return program === 'cat' && args.every(word => word.text.startsWith('-')) ? inputOf(part, input) : 'unread'
}

/**
 * The commands of a script a shell or SQL client reads on its input or
 * from a file it names, and the script charged as unread when the line
 * does not spell all of it. Read out with what feeds it.
 */
const fedOf = (rest: readonly string[], { part, input, nested }: Context): Simple[] => {
  const program = rest[0] ?? ''
  const isSql = SQL_CLIENTS.has(program)
  const isShell = SHELLS.has(program) && shellReadingOf(rest) === 'input'
  const read = isSql || isShell ? inputOf(part, input) : undefined
  const fromText = input === undefined && part.from !== undefined ? `${spellingOf(part.from.text)} | ` : ''
  const text = `${fromText}${spellingOf(part.text)}${input?.kind === 'document' ? (part.document?.spelling ?? '') : ''}`
  const unread: Simple = { words: text.split(/\s+/), open: false, text, unread: true }
  const options = SQL_FILE_OPTIONS.get(program) ?? []
  if (rest.slice(1).some(word => options.some(option => word === option || word.startsWith(option.startsWith('--') ? `${option}=` : option)))) {
    return [unread]
  }
  if (read === undefined || read === 'unread') {
    return read === undefined ? [] : [unread]
  }
  const commands = isShell ? nested(read.script) : [{ words: [...rest, ...read.script.split(/\s+/)], open: false, text }]
  return read.exact ? commands : [...commands, unread]
}

const EXEC_ACTIONS = new Set(['-exec', '-execdir', '-ok', '-okdir'])

/**
 * The commands a find runs for each file: the words after `-exec`,
 * `-execdir`, `-ok` or `-okdir`, up to `;` or `+`.
 */
const execsOf = (words: readonly Word[]): Word[][] => {
  const commands: Word[][] = []
  let command: Word[] | undefined
  for (const word of words) {
    if (command === undefined) {
      command = EXEC_ACTIONS.has(word.text) ? [] : undefined
    } else if (word.text === ';' || word.text === '+') {
      commands.push(command)
      command = undefined
    } else {
      command.push(word)
    }
  }
  return command === undefined ? commands : [...commands, command]
}

/**
 * The value of a `-c` (bundled or not: `-lc`) or `--command` option at
 * `at`, or undefined when that word is no such option.
 */
const commandOptionOf = (words: readonly string[], at: number): string | undefined => {
  const word = words[at] ?? ''
  const long = /^--command(?:=([\s\S]*))?$/.exec(word)
  if (long !== null) {
    return long[1] ?? words[at + 1] ?? ''
  }
  return /^-[A-Za-z]*c$/.test(word) ? (words[at + 1] ?? '') : undefined
}

/**
 * The script a shell runs from its first operand: with `-c` in any of its
 * flags (`bash -lc`, `sh -ec`, `bash -c -x`), or `--command` (fish);
 * `input` when it reads its script on its input (no operand, or `-s`);
 * undefined when it runs a script file.
 */
const shellReadingOf = (words: readonly string[]): { script: string } | 'input' | undefined => {
  let isCommand = false
  let isInput = false
  let at = 1
  while (at < words.length && /^[-+]./.test(words[at] ?? '') && words[at] !== '--') {
    const word = words[at] ?? ''
    const script = word.startsWith('--') ? commandOptionOf(words, at) : undefined
    if (script !== undefined) {
      return { script }
    }
    isCommand ||= /^-[A-Za-z]*c/.test(word)
    isInput ||= /^-[A-Za-z]*s/.test(word)
    // -o / -O name an option in the next word; so do --rcfile and --init-file
    at += /^[-+][A-Za-z]*[oO]$|^--(rcfile|init-file)$/.test(word) ? 2 : 1
  }
  at += words[at] === '--' || words[at] === '-' ? 1 : 0
  if (isCommand) {
    return { script: words[at] ?? '' }
  }
  return isInput || at >= words.length ? 'input' : undefined
}

/**
 * The script a runner takes from `-c` or `--command`; `sg` also runs the
 * operand after its group without one.
 */
const runnerScriptOf = (words: readonly string[]): string | undefined => {
  for (let at = 1; at < words.length; at += 1) {
    const script = commandOptionOf(words, at)
    if (script !== undefined) {
      return script
    }
  }
  return words[0] === 'sg' ? words.slice(1).filter(word => !word.startsWith('-'))[1] : undefined
}

/**
 * git's options that take the next word as their value.
 */
const GIT_VALUES = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix'])

/**
 * What a git alias set on the command line (`git -c alias.x=...`) runs when
 * the subcommand names it: a `!` alias is a shell script given the words
 * after it, any other is git with its words in place of the subcommand.
 */
const gitAliasScriptOf = (words: readonly string[]): string | undefined => {
  const aliases = new Map<string, string>()
  let at = 1
  while ((words[at] ?? '').startsWith('-')) {
    const alias = words[at] === '-c' ? /^alias\.([^=]+)=([\s\S]*)$/i.exec(words[at + 1] ?? '') : null
    if (alias !== null) aliases.set((alias[1] ?? '').toLowerCase(), alias[2] ?? '')
    at += GIT_VALUES.has(words[at] ?? '') ? 2 : 1
  }
  const body = aliases.get((words[at] ?? '').toLowerCase())
  const args = words.slice(at + 1)
  if (body === undefined) {
    return undefined
  }
  return body.startsWith('!') ? [body.slice(1), ...args].join(' ') : ['git', body, ...args].join(' ')
}

const innerScriptOf = (words: readonly string[]): string | undefined => {
  if (words[0] === 'eval') {
    return words.slice(1).join(' ')
  }
  if (words[0] === 'git') {
    return gitAliasScriptOf(words)
  }
  if (SHELLS.has(words[0] ?? '')) {
    const reading = shellReadingOf(words)
    return typeof reading === 'object' ? reading.script : undefined
  }
  return RUNNERS.has(words[0] ?? '') ? runnerScriptOf(words) : undefined
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

const NOT_SIMPLE_HEADS = new Set([...WRAPPERS, ...SHELLS, ...RUNNERS, 'eval', 'source', '.', 'coproc'])

/**
 * Whether a whole command line is one simple command of plain words: no
 * compound operator, substitution, variable, glob, brace or tilde
 * expansion, redirection, quoting, env assignment, wrapper or nested shell.
 * Anything the check cannot read as plain is not simple.
 *
 * @param command the Bash tool's `command`, as the model wrote it
 */
export const isSimpleCommand = (command: string): boolean => {
  const [head, ...rest] = command.trim().split(/\s+/)
  const trial = trialOf(command)
  return (
    PLAIN_LINE.test(command) &&
    !TILDE.test(command) &&
    head !== undefined &&
    head !== '' &&
    !head.includes('=') &&
    !NOT_SIMPLE_HEADS.has(nameOf(head)) &&
    // charged on its own words, never on a command it runs (`find -exec`)
    // or a script it reads (`psql -f drop.sql`)
    (trial === undefined || (trial.charge.id !== UNREAD.id && trial.matched.join(' ') === [nameOf(head), ...rest].join(' ')))
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
  const trial = trialOf(command)
  return trial === undefined ? undefined : { charge: trial.charge, words: trial.words }
}

/**
 * The charge, the words that stand for the charged command, and the words
 * the charge was matched on (those of the command run per file, for a
 * `find -exec`).
 */
const trialOf = (command: string): { charge: Charge; words: readonly string[]; matched: readonly string[] } | undefined => {
  for (const { words, open, text, whole, unread } of segmentsOf(command).flatMap(segment => commandsOf(segment))) {
    if (unread === true) {
      return { charge: { ...UNREAD, command: text }, words, matched: words }
    }
    const tried = open ? PROGRAMS.map(program => [program, ...words.slice(1)]) : [words]
    for (const one of tried) {
      const rule = RULES.find(candidate => candidate.test(one))
      if (rule) {
        return { charge: { id: rule.id, label: rule.label, command: text }, words: whole ?? one, matched: one }
      }
    }
  }
  return undefined
}
