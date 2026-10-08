import type { FsStat } from 'claude-code'

import { chargedOf, isSimpleCommand } from './risky'

/**
 * Flags every exhibit runs git with. A repository's own config can name
 * programs git runs on its behalf; these turn off the ones the allowlisted
 * commands could reach: the filesystem monitor (`ls-files` runs it), hooks,
 * the untracked cache, signature verification in `log`, and the pager.
 * `--literal-pathspecs` reads every path as written: without it `:src` or
 * `:/src` names `src`, not the path `rm` deletes.
 * `status` and `diff` are not on the allowlist at all: they run a
 * repository's clean filters and external diff, which no flag here turns
 * off. `tests/hostile/git.hostile.mjs` runs every plan against such a
 * repository.
 */
export const GIT_HARDENING = [
  '-c', 'core.fsmonitor=false',
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.untrackedCache=false',
  '-c', 'log.showSignature=false',
  '--literal-pathspecs',
  '--no-optional-locks',
  '--no-pager',
] as const

/**
 * The environment every exhibit runs git in: no system or global config, no
 * prompts, no lock files, no pager, plain output. An empty askpass is no
 * program at all, where an unset one would fall back to `core.askPass`.
 */
export const GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  GIT_ASKPASS: '',
  SSH_ASKPASS: '',
  LC_ALL: 'C',
} as const

export type ExhibitKind = 'inside' | 'head' | 'behind' | 'ahead' | 'authors' | 'pushconfig' | 'tracked' | 'committed' | 'untracked' | 'ignored' | 'indexed'

/**
 * One read-only git command the court runs for a fact, by argument vector.
 */
export type ExhibitQuery = { kind: ExhibitKind; argv: readonly string[]; target?: string }

/**
 * What a git command returned, as `$.process.run` resolves it; undefined
 * for one that failed to start, timed out or was refused.
 */
export type ExhibitResult = { exitCode: number; stdout: string } | undefined

/**
 * The facts the court learned from the repository.
 */
export type Facts = {
  isRepo?: boolean
  /** Where git ran: the repository's top level, the directory within it, and the branch checked out. */
  top?: string
  prefix?: string
  branch?: string
  /** The index file, as git names it from the working directory. */
  indexPath?: string
  /** Whether HEAD names a commit: false on a branch with no commits yet. */
  hasCommits?: boolean
  /** Commits on the upstream branch this branch lacks. */
  behind?: number
  /** Local commits not on the upstream branch. */
  ahead?: number
  /** Distinct authors of the upstream commits this branch lacks (up to 20). */
  upstreamAuthors?: number
  /** Whether each delete target is tracked by git. */
  tracked?: Record<string, boolean>
  /**
   * Whether every index entry under each delete target is in HEAD with the
   * same mode and object, and none is an intent to add.
   */
  committed?: Record<string, boolean>
  /**
   * Whether each delete target, `.` for the whole repository, holds a
   * nested repository or worktree: a gitlink in the index, or a directory
   * the untracked or ignored listing names whole. What is inside is unread.
   */
  nested?: Record<string, boolean>
  /** Untracked files under each target, `.` for the whole repository. */
  untracked?: Record<string, number>
  /** Ignored files in the whole repository. */
  ignored?: number
  /** Ignored files under each delete target. */
  ignoredIn?: Record<string, number>
  /** The index entries under each delete target. */
  indexed?: Record<string, IndexEntry[]>
  /** Tracked files under each delete target whose size or time differs from the index. */
  modifiedIn?: Record<string, number>
}

/**
 * One file as the index last recorded it.
 */
export type IndexEntry = { path: string; size: number; mtimeMs: number }

const MAX_TARGETS = 3

/**
 * The most index entries the court compares with the files: one stat
 * each, within the exhibits' bound. A target with more is unknown.
 */
const MAX_INDEXED = 200
const NAME_CELLS = 60

const git = (...args: string[]): readonly string[] => ['git', ...GIT_HARDENING, ...args]

const query = (kind: ExhibitKind, argv: readonly string[], target?: string): ExhibitQuery =>
  target === undefined ? { kind, argv } : { kind, argv, target }

/**
 * Where git runs, and HEAD on its own: a branch with no commits fails any
 * read of HEAD, which must not make the whole repository unread.
 */
const HERE = [
  query('inside', git('rev-parse', '--is-inside-work-tree', '--show-toplevel', '--show-prefix', '--git-path', 'index')),
  query('head', git('rev-parse', '--abbrev-ref', '--verify', '--quiet', 'HEAD')),
]

/**
 * The operands of an `rm`: its words after the command that are not flags,
 * and every word after `--`.
 */
const targetsOf = (words: readonly string[]): string[] => {
  const targets: string[] = []
  let isOptionsDone = false
  for (const word of words.slice(1)) {
    if (!isOptionsDone && word === '--') {
      isOptionsDone = true
    } else if (isOptionsDone || !word.startsWith('-')) {
      targets.push(word)
    }
  }
  return targets
}

/**
 * Whether git can be asked about a target exactly as `rm` will remove it:
 * not ending in `/` (which follows a symlink to a directory git never
 * looks into), with no `..` part (git folds `lnk/..` by spelling, the
 * kernel follows `lnk` first) and no `.git` part (the repository's own
 * store, which git never lists, so it reads as an empty, clean folder).
 */
const isReadableTarget = (target: string) =>
  !target.endsWith('/') && !target.split('/').some(part => part === '..' || part === '.git')

/**
 * The targets git can be asked about exactly as `rm` will remove them: at
 * most three, each readable. Otherwise none, and the targets are unknown.
 */
const readableTargetsOf = (words: readonly string[]): string[] => {
  const targets = targetsOf(words)
  return targets.length > MAX_TARGETS || !targets.every(isReadableTarget) ? [] : targets
}

/**
 * A remote or branch name git reads as that name and nothing else.
 */
const PLAIN_REF = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/

const isPlainRef = (name: string) =>
  PLAIN_REF.test(name) &&
  name !== 'HEAD' &&
  !name.includes('..') &&
  !name.includes('//') &&
  !name.endsWith('/') &&
  !name.endsWith('.lock')

/**
 * The commands for a force push that names exactly one remote and one
 * branch (`git push --force origin main`): the branch against that remote's
 * copy of it, by name. Any other form (no remote or branch, a refspec with
 * `:` or `+`, several branches, another option) pushes something these
 * would not describe, so it gets none.
 */
const pushPlanOf = (words: readonly string[]): ExhibitQuery[] => {
  const rest = words.slice(2)
  const flags = rest.filter(word => word.startsWith('-'))
  const named = rest.filter(word => !word.startsWith('-'))
  const [remote = '', branch = ''] = named
  if (flags.some(flag => flag !== '--force' && flag !== '-f') || named.length !== 2 || !isPlainRef(remote) || !isPlainRef(branch)) {
    return []
  }
  // full ref names: a tag or another ref of the same short name is never read
  const range = `refs/heads/${branch}..refs/remotes/${remote}/${branch}`
  return [
    ...HERE,
    query('behind', git('rev-list', '--count', '--end-of-options', range)),
    query('authors', git('log', '-20', '--no-show-signature', '--format=%ae', '--end-of-options', range)),
    // a remote's push, push url or mirror config, or any push rewrite of a
    // URL, changes what `push origin main` sends or where it goes
    query(
      'pushconfig',
      git('config', '--get-regexp', `^(remote\\.${remote.replaceAll('.', '\\.')}\\.(push|pushurl|mirror)|url\\..*\\.pushinsteadof)$`),
    ),
  ]
}

const hasShortFlag = (words: readonly string[], letter: string) =>
  words.some(word => /^-[a-zA-Z]+$/.test(word) && word.includes(letter))

/**
 * The git commands the court runs for a charged command, from a fixed
 * allowlist; every path is passed after `--` and every ref after
 * `--end-of-options`, so neither is ever an option. Only a simple command
 * line is read: one the shell runs in this directory with every word as
 * written, so the facts are about what it will touch. Any other line, and
 * a `git` with options before its subcommand (`git -C dir`), gets none.
 *
 * @param command the Bash tool's `command`, as the model wrote it
 */
export const planOf = (command: string): ExhibitQuery[] => {
  const charged = isSimpleCommand(command) ? chargedOf(command) : undefined
  if (charged === undefined) {
    return []
  }
  const { charge, words } = charged
  switch (charge.id) {
    case 'force-push':
      return words[1] === 'push' ? pushPlanOf(words) : []
    case 'hard-reset':
      return words[1] === 'reset' ? [...HERE, query('ahead', git('rev-list', '--count', '@{upstream}..HEAD'))] : []
    case 'recursive-delete':
      return words[0] !== 'rm'
        ? HERE
        : [
            ...HERE,
            ...readableTargetsOf(words).flatMap(target => [
              // the index's and HEAD's mode and object for each file, names raw
              query('tracked', git('ls-files', '--stage', '-z', '--', target), target),
              query('committed', git('ls-tree', '-r', '-z', 'HEAD', '--', target), target),
              query('untracked', git('ls-files', '--others', '--exclude-standard', '--', target), target),
              query('ignored', git('ls-files', '--others', '--ignored', '--exclude-standard', '--', target), target),
              // the index's own record of each file, never the files: every git
              // that compares them can run the repository's filters
              query('indexed', git('-c', 'core.quotePath=false', 'ls-files', '--debug', '--', target), target),
            ]),
          ]
    case 'git-clean':
      return words[1] === 'clean'
        ? [
            ...HERE,
            query('untracked', git('ls-files', '--others', '--exclude-standard')),
            ...(hasShortFlag(words, 'x') || hasShortFlag(words, 'X')
              ? [query('ignored', git('ls-files', '--others', '--ignored', '--exclude-standard'))]
              : []),
          ]
        : []
    default:
      return []
  }
}

/**
 * The five lines `ls-files --debug` prints under each path, in order.
 */
const STAT_LINES = [
  /^ {2}ctime: \d+:\d+$/,
  /^ {2}mtime: (\d+):(\d+)$/,
  /^ {2}dev: \d+\tino: \d+$/,
  /^ {2}uid: \d+\tgid: \d+$/,
  /^ {2}size: (\d+)\tflags: ([0-9a-f]+)$/,
] as const

/**
 * The index entry flag git sets on a path added with `git add -N`: the
 * entry holds no content, only the promise of some.
 */
const CE_INTENT_TO_ADD = 0x20000000

/**
 * The entries `ls-files --debug` prints, read strictly: each a path line
 * then exactly the five stat lines. A quoted path (a name git escapes
 * even with core.quotePath off: a newline, a quote, a control character),
 * an indented or empty path, or any other line means the read is not
 * exact, and the answer is undefined. Also the paths added with intent to add.
 */
const entriesOf = (stdout: string): { entries: IndexEntry[]; intents: Set<string> } | undefined => {
  const lines = stdout.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  const entries: IndexEntry[] = []
  const intents = new Set<string>()
  for (let at = 0; at < lines.length; at += 6) {
    const path = lines[at] ?? ''
    const stats = STAT_LINES.map((line, offset) => line.exec(lines[at + 1 + offset] ?? ''))
    const [, mtime, , , size] = stats
    if (path === '' || /^\s/.test(path) || path.startsWith('"') || !mtime || !size || stats.includes(null)) {
      return undefined
    }
    entries.push({ path, size: Number(size[1]), mtimeMs: Number(mtime[1]) * 1000 + Number(mtime[2]) / 1e6 })
    if ((Number.parseInt(size[2] ?? '', 16) & CE_INTENT_TO_ADD) !== 0) {
      intents.add(path)
    }
  }
  return { entries, intents }
}

/**
 * The records of a `-z` listing as `mode object` by raw path, or undefined
 * when any record does not match `line` exactly.
 */
const recordsOf = (stdout: string, line: RegExp): Map<string, string> | undefined => {
  const records = stdout.split('\0')
  if (records.at(-1) === '') {
    records.pop()
  }
  const read = new Map<string, string>()
  for (const record of records) {
    const [, mode, oid, path] = line.exec(record) ?? []
    if (mode === undefined || oid === undefined || path === undefined) {
      return undefined
    }
    read.set(path, `${mode} ${oid}`)
  }
  return read
}

/**
 * One `ls-files --stage -z` record: mode, object, stage 0, path. An entry
 * at another stage is a merge conflict, which no commit holds as it is.
 */
const STAGED = /^([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) 0\t([^]+)$/

/** One `ls-tree -r -z` record: mode, a file or gitlink, object, path. */
const IN_TREE = /^([0-7]{6}) (?:blob|commit) ([0-9a-f]{40}|[0-9a-f]{64})\t([^]+)$/

const GITLINK = '160000 '

/**
 * Whether a listing of untracked or ignored files names a directory whole:
 * git does so for a nested repository or worktree, whose files it never lists.
 * A name git quotes keeps its `/` inside the closing quote.
 */
const hasNestedOf = (stdout: string) => stdout.split('\n').some(line => line.endsWith('/') || line.endsWith('/"'))

const countOf = (stdout: string) => stdout.split('\n').filter(line => line.trim() !== '').length

/**
 * The per-target reads that become facts only together: the index's and
 * HEAD's records and the paths added with intent to add, by target.
 */
type TargetReads = {
  staged: Map<string, ReadonlyMap<string, string>>
  head: Map<string, ReadonlyMap<string, string>>
  intents: Map<string, ReadonlySet<string>>
  nested: Map<string, boolean>
}

const withEntry = <T>(record: Record<string, T> | undefined, key: string, value: T): Record<string, T> => ({ ...record, [key]: value })

/**
 * One result about where git runs, HEAD or a push, read into `facts`.
 * Returns the branch HEAD names, if this result names one.
 */
const readHere = (facts: Facts, kind: ExhibitKind, result: { exitCode: number; stdout: string }): string | undefined => {
  const out = result.stdout.trim()
  switch (kind) {
    case 'inside': {
      const [inside, top = '', prefix, indexPath = ''] = result.stdout.split('\n')
      facts.isRepo = result.exitCode === 0 && inside === 'true'
      if (facts.isRepo && indexPath !== '') {
        facts.indexPath = indexPath
      }
      if (facts.isRepo && top !== '' && prefix !== undefined) {
        Object.assign(facts, { top, prefix })
      }
      return undefined
    }
    case 'head':
      // --verify --quiet exits 1 with nothing printed when HEAD names no commit
      if (result.exitCode === 0 && /^[^\n]+$/.test(out)) {
        facts.hasCommits = true
        return out
      }
      if (result.exitCode === 1 && out === '') {
        facts.hasCommits = false
      }
      return undefined
    case 'behind':
    case 'ahead':
      if (result.exitCode === 0 && /^\d+$/.test(out)) {
        facts[kind] = Number(out)
      }
      return undefined
    case 'authors': {
      const authors = new Set(out.split('\n').filter(line => line.includes('@')))
      if (result.exitCode === 0 && authors.size > 0) {
        facts.upstreamAuthors = authors.size
      }
      return undefined
    }
    default:
      return undefined
  }
}

/**
 * One listing of untracked or ignored files read into `facts`, under the
 * target it lists or `.` for the whole repository.
 */
const readListing = (facts: Facts, reads: TargetReads, one: ExhibitQuery, stdout: string) => {
  const key = one.target ?? '.'
  if (hasNestedOf(stdout)) {
    reads.nested.set(key, true)
  }
  if (one.kind === 'untracked') {
    facts.untracked = withEntry(facts.untracked, key, countOf(stdout))
  } else if (one.target === undefined) {
    facts.ignored = countOf(stdout)
  } else {
    facts.ignoredIn = withEntry(facts.ignoredIn, key, countOf(stdout))
  }
}

/**
 * One per-target result read into `facts` and `reads`; a result that is
 * not exact adds nothing, which leaves every target unread.
 */
const readTarget = (facts: Facts, reads: TargetReads, one: ExhibitQuery, result: { exitCode: number; stdout: string }) => {
  const target = one.target ?? ''
  switch (one.kind) {
    case 'tracked': {
      const staged = result.exitCode === 0 ? recordsOf(result.stdout, STAGED) : undefined
      if (staged !== undefined) {
        reads.staged.set(target, staged)
        facts.tracked = withEntry(facts.tracked, target, staged.size > 0)
      }
      break
    }
    case 'committed': {
      // a branch with no commits has no HEAD to list: nothing is committed
      const head = result.exitCode === 0 ? recordsOf(result.stdout, IN_TREE) : facts.hasCommits === false ? new Map<string, string>() : undefined
      if (head !== undefined) {
        reads.head.set(target, head)
      }
      break
    }
    case 'indexed': {
      const read = result.exitCode === 0 ? entriesOf(result.stdout) : undefined
      if (read !== undefined) {
        facts.indexed = withEntry(facts.indexed, target, read.entries)
        reads.intents.set(target, read.intents)
      }
      break
    }
    default:
      break
  }
}

/**
 * Whether every index entry is in HEAD with the same mode and object, and
 * none is an intent to add: an entry git records as the empty file, which
 * matches an empty file in HEAD while the file itself holds anything.
 */
const isCommitted = (staged: ReadonlyMap<string, string>, head: ReadonlyMap<string, string>, intents: ReadonlySet<string>) =>
  [...staged].every(([path, record]) => !intents.has(path) && head.get(path) === record)

/**
 * The facts with each target's committed and nested state, from reads
 * every target is known to have.
 */
const withTargetState = (facts: Facts, targets: readonly string[], reads: TargetReads): Facts => {
  const committed = targets.map(target => [
    target,
    isCommitted(reads.staged.get(target) ?? new Map(), reads.head.get(target) ?? new Map(), reads.intents.get(target) ?? new Set()),
  ])
  for (const target of targets) {
    if ([...(reads.staged.get(target)?.values() ?? [])].some(record => record.startsWith(GITLINK))) {
      reads.nested.set(target, true)
    }
  }
  return {
    ...facts,
    ...(targets.length === 0 ? {} : { committed: Object.fromEntries(committed) }),
    ...(reads.nested.size === 0 ? {} : { nested: Object.fromEntries(reads.nested) }),
  }
}

/**
 * What the court learned: each result read only when it means something,
 * so a failed, timed out or garbled result adds no fact.
 *
 * @param plan the commands, as `planOf` gave them
 * @param results each command's result, in the same order
 */
export const factsOf = (plan: readonly ExhibitQuery[], results: readonly ExhibitResult[]): Facts => {
  const facts: Facts = {}
  const reads: TargetReads = { staged: new Map(), head: new Map(), intents: new Map(), nested: new Map() }
  // a push is read only once its remote is known to push plainly
  let isPushPlain = !plan.some(one => one.kind === 'pushconfig')
  let branch: string | undefined
  plan.forEach((one, at) => {
    const result = results[at]
    if (result === undefined) {
      return
    }
    if (one.kind === 'pushconfig') {
      isPushPlain = result.exitCode === 1
    } else if ((one.kind === 'untracked' || one.kind === 'ignored') && result.exitCode === 0) {
      readListing(facts, reads, one, result.stdout)
    } else if (one.target !== undefined) {
      readTarget(facts, reads, one, result)
    } else {
      branch = readHere(facts, one.kind, result) ?? branch
    }
  })
  // the place is the top level, the directory within it and the branch, all
  // or none; a detached HEAD prints HEAD for every commit: it names no branch
  if (facts.top === undefined || branch === undefined || branch === 'HEAD') {
    delete facts.top
    delete facts.prefix
  } else {
    facts.branch = branch
  }
  // the targets are read together or not at all: one unread leaves every
  // target unknown, never a partial picture
  const targets = plan.filter(one => one.target !== undefined)
  // every per-target read is required; a kind not listed here reads as unread
  const readFor: Partial<Record<ExhibitKind, ReadonlyMap<string, unknown>>> = {
    tracked: reads.staged,
    committed: reads.head,
    untracked: new Map(Object.entries(facts.untracked ?? {})),
    ignored: new Map(Object.entries(facts.ignoredIn ?? {})),
    indexed: reads.intents,
  }
  const isEveryTargetRead = targets.every(one => readFor[one.kind]?.has(one.target ?? '') === true)
  if (!isPushPlain) {
    delete facts.behind
    delete facts.upstreamAuthors
  }
  const read = isEveryTargetRead ? withTargetState(facts, targetsIn(plan), reads) : withoutTargets(facts)
  return read.isRepo === false ? { isRepo: false } : read
}

/**
 * The delete targets a plan reads, each once, in order.
 */
export const targetsIn = (plan: readonly ExhibitQuery[]): string[] => [
  ...new Set(plan.flatMap(one => (one.target === undefined ? [] : [one.target]))),
]

/**
 * A path with `.` and `..` folded and repeated `/` dropped, by spelling.
 */
const foldedOf = (path: string) => {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') {
      parts.pop()
    } else if (part !== '' && part !== '.') {
      parts.push(part)
    }
  }
  return `/${parts.join('/')}`
}

/**
 * Whether a target lands where its spelling says, from the real working
 * directory: false when a symbolic link in any component sends it
 * elsewhere, where git never looks, or when it does not resolve.
 *
 * @param here the working directory with every link followed
 * @param target the path as the command names it
 * @param real where it lands with every link followed, if anywhere
 */
export const isLexicalPath = (here: string, target: string, real: string | undefined): boolean =>
  real !== undefined && real === foldedOf(target.startsWith('/') ? target : `${here}/${target}`)

/**
 * Each name a target's spelling passes through, with the directory that
 * must list it by that exact spelling: on a case-insensitive file system
 * `SRC` opens `src`, while git, matching spellings, reads nothing there. A
 * relative target is listed from the working directory, an absolute one
 * from the repository's top level. Undefined when the target is the
 * working directory itself, or an absolute path not strictly inside the
 * top level by its spelling (the top level, an ancestor of it, anywhere
 * else): a delete there takes the repository's history with it.
 *
 * @param target the path as the command names it
 * @param top the repository's top level, as git reported it
 */
export const namesAlong = (target: string, top: string | undefined): { dir: string; name: string }[] | undefined => {
  const partsOf = (path: string) => path.split('/').filter(part => part !== '' && part !== '.')
  const isAbsolute = target.startsWith('/')
  const above = isAbsolute ? partsOf(top ?? '') : []
  const parts = partsOf(target)
  const isInside = (!isAbsolute || top !== undefined) && parts.length > above.length && above.every((part, at) => parts[at] === part)
  return isInside
    ? parts.slice(above.length).map((name, at) => {
        const dir = parts.slice(0, above.length + at).join('/')
        return { dir: isAbsolute ? `/${dir}` : dir === '' ? '.' : dir, name }
      })
    : undefined
}

/**
 * The facts with every fact about the delete targets removed.
 */
export const withoutTargets = (facts: Facts): Facts => {
  const { tracked, committed, nested, untracked, ignoredIn, indexed, modifiedIn, ...rest } = facts
  return rest
}

/**
 * The files to stat for the targets' changes: every index entry under
 * them, or none when there are more than the court reads, which leaves
 * every target's changes unknown.
 */
export const statPathsOf = (facts: Facts): string[] => {
  const paths = Object.values(facts.indexed ?? {}).flatMap(entries => entries.map(entry => entry.path))
  return paths.length > MAX_INDEXED ? [] : paths
}

const isUnchanged = (entry: IndexEntry, stat: FsStat) =>
  !stat.isLink &&
  stat.kind === 'file' &&
  stat.size === entry.size &&
  Math.floor(stat.mtimeMs) === Math.floor(entry.mtimeMs)

/**
 * The facts with each target's changed files counted: an index entry whose
 * file differs in size or time, is a link, or is not a file. A target is
 * left unknown, never claimed changed, when an entry could not be stat'd,
 * when the index file's own time is unknown, or when a file is not
 * strictly older than the index file: git's racily clean case, where an
 * edit keeping size and time looks unchanged.
 *
 * @param stats each path's stat, undefined where it could not be read
 * @param indexMs the index file's mtime, undefined where unknown
 */
export const withModified = (facts: Facts, stats: ReadonlyMap<string, FsStat | undefined>, indexMs: number | undefined): Facts => {
  const counted = Object.entries(facts.indexed ?? {}).flatMap(([target, entries]) => {
    const statted = entries.map(entry => [entry, stats.get(entry.path)] as const)
    const isReadable = statted.every(
      ([, stat]) => stat !== undefined && indexMs !== undefined && Math.floor(stat.mtimeMs) < Math.floor(indexMs),
    )
    return isReadable
      ? [[target, statted.filter(([entry, stat]) => stat === undefined || !isUnchanged(entry, stat)).length] as const]
      : []
  })
  return counted.length === 0 ? facts : { ...facts, modifiedIn: Object.fromEntries(counted) }
}

/**
 * Text from the repository as the court may quote it: control characters
 * (escapes, newlines, bells) removed and cut to `cells`.
 */
export const sanitizedOf = (text: string, cells: number): string => {
  // eslint-disable-next-line no-control-regex
  const plain = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
  return plain.length <= cells ? plain : `${plain.slice(0, Math.max(1, cells - 3))}...`
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/**
 * The line for one delete target's tracked state. History keeps a target
 * only when the index holds nothing HEAD lacks and every change under it was
 * counted; otherwise the line says what history does not keep or what was
 * not checked.
 */
const trackedLineOf = (facts: Facts, target: string, isTracked: boolean): string => {
  const name = sanitizedOf(target, NAME_CELLS)
  if (!isTracked) {
    return `${name} is not tracked by git, so history does not keep it.`
  }
  if (facts.nested?.[target] === true) {
    return `${name} is tracked by git, but holds a nested repository, whose contents were not checked.`
  }
  if (facts.committed?.[target] !== true) {
    return `${name} is tracked by git, but not all of it is committed, so history does not keep all of it.`
  }
  // changes under a tracked target go uncounted when a file is as new as
  // the index or there are too many: the line says so rather than reassure
  return facts.modifiedIn?.[target] === undefined
    ? `${name} is tracked by git, so history keeps its last commit; uncommitted changes under it were not checked.`
    : `${name} is tracked by git, so history keeps it.`
}

/**
 * The exhibits as the court enters them, lettered A, B, C. They name counts
 * and states only, never an author's address.
 */
export const exhibitLinesOf = (facts: Facts): string[] => {
  const said: string[] = []
  if (facts.isRepo === false) {
    said.push('this is not a git repository.')
  }
  if (facts.hasCommits === false) {
    said.push('this repository has no commits on its current branch.')
  }
  if (facts.behind !== undefined) {
    said.push(
      facts.behind === 0
        ? 'the upstream branch has no commits this branch lacks, as of the last fetch.'
        : `the upstream branch has ${plural(facts.behind, 'commit', 'commits')} this branch does not` +
            (facts.upstreamAuthors === undefined ? '' : `, by ${plural(facts.upstreamAuthors, 'author', 'authors')}`) +
            ', as of the last fetch.',
    )
  }
  if (facts.ahead !== undefined) {
    // uncommitted changes go unread: every git that reads them can run the
    // repository's own filters, so the line says so rather than reassure
    said.push(
      facts.ahead === 0
        ? 'every local commit is on the upstream branch; uncommitted changes were not checked.'
        : `${plural(facts.ahead, 'local commit is', 'local commits are')} not on the upstream branch; uncommitted changes were not checked.`,
    )
  }
  // what a nested repository or worktree holds is never listed: a count
  // under it would understate what a delete takes
  const isNested = (target: string) => facts.nested?.[target] === true
  for (const [target, isTracked] of Object.entries(facts.tracked ?? {})) {
    said.push(trackedLineOf(facts, target, isTracked))
  }
  for (const [target, count] of Object.entries(facts.untracked ?? {})) {
    if (isNested(target)) {
      if (target === '.') {
        said.push('the repository holds a nested repository, whose files were not counted.')
      } else if (facts.tracked?.[target] !== true) {
        said.push(`${sanitizedOf(target, NAME_CELLS)} holds a nested repository, whose contents were not checked.`)
      }
    } else if (target === '.') {
      said.push(count === 0 ? 'the repository holds no untracked files.' : `the repository holds ${plural(count, 'untracked file', 'untracked files')}.`)
    } else if (count > 0) {
      said.push(`${sanitizedOf(target, NAME_CELLS)} holds ${plural(count, 'untracked file', 'untracked files')}.`)
    }
  }
  for (const [target, count] of Object.entries(facts.modifiedIn ?? {})) {
    if (count > 0 && !isNested(target)) {
      said.push(`${sanitizedOf(target, NAME_CELLS)} holds ${plural(count, 'file', 'files')} changed since git last recorded them, which history does not keep.`)
    }
  }
  for (const [target, count] of Object.entries(facts.ignoredIn ?? {})) {
    if (count > 0 && !isNested(target)) {
      said.push(`${sanitizedOf(target, NAME_CELLS)} holds ${plural(count, 'ignored file', 'ignored files')}, which history does not keep.`)
    }
  }
  if (facts.ignored !== undefined && !isNested('.')) {
    said.push(`the repository holds ${plural(facts.ignored, 'ignored file', 'ignored files')}.`)
  }
  return said.map((line, at) => `Exhibit ${String.fromCharCode(65 + at)}: ${line}`)
}
