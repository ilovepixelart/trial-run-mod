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

export type ExhibitKind = 'inside' | 'behind' | 'ahead' | 'authors' | 'pushconfig' | 'tracked' | 'untracked' | 'ignored' | 'indexed'

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
  /** Commits on the upstream branch this branch lacks. */
  behind?: number
  /** Local commits not on the upstream branch. */
  ahead?: number
  /** Distinct authors of the upstream commits this branch lacks (up to 20). */
  upstreamAuthors?: number
  /** Whether each delete target is tracked by git. */
  tracked?: Record<string, boolean>
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

/**
 * The facts precedent compares: where git ran (repository, directory,
 * branch), whether the upstream branch moved, and whether each target is
 * still tracked.
 */
export type MaterialFacts = Pick<Facts, 'top' | 'prefix' | 'branch' | 'behind' | 'tracked' | 'untracked' | 'ignoredIn' | 'modifiedIn'>

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

const INSIDE = query(
  'inside',
  git('rev-parse', '--is-inside-work-tree', '--show-toplevel', '--show-prefix', '--abbrev-ref', 'HEAD', '--git-path', 'index'),
)

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
 * The targets git can be asked about exactly as `rm` will remove them: at
 * most three, none ending in `/` (which follows a symlink to a directory
 * git never looks into). Otherwise none, and the targets are unknown.
 */
const readableTargetsOf = (words: readonly string[]): string[] => {
  const targets = targetsOf(words)
  return targets.length > MAX_TARGETS || targets.some(target => target.endsWith('/')) ? [] : targets
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
    INSIDE,
    query('behind', git('rev-list', '--count', '--end-of-options', range)),
    query('authors', git('log', '-20', '--no-show-signature', '--format=%ae', '--end-of-options', range)),
    // a remote's push or mirror config changes what `push origin main` sends
    query('pushconfig', git('config', '--get-regexp', `^remote\\.${remote.replaceAll('.', '\\.')}\\.(push|mirror)$`)),
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
      return words[1] === 'reset' ? [INSIDE, query('ahead', git('rev-list', '--count', '@{upstream}..HEAD'))] : []
    case 'recursive-delete':
      return words[0] !== 'rm'
        ? [INSIDE]
        : [
            INSIDE,
            ...readableTargetsOf(words).flatMap(target => [
              query('tracked', git('ls-files', '--error-unmatch', '--', target), target),
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
            INSIDE,
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
  /^ {2}size: (\d+)\tflags: [0-9a-f]+$/,
] as const

/**
 * The entries `ls-files --debug` prints, read strictly: each a path line
 * then exactly the five stat lines. A quoted path (a name git escapes
 * even with core.quotePath off: a newline, a quote, a control character),
 * an indented or empty path, or any other line means the read is not
 * exact, and the answer is undefined.
 */
const entriesOf = (stdout: string): IndexEntry[] | undefined => {
  const lines = stdout.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  const entries: IndexEntry[] = []
  for (let at = 0; at < lines.length; at += 6) {
    const path = lines[at] ?? ''
    const stats = STAT_LINES.map((line, offset) => line.exec(lines[at + 1 + offset] ?? ''))
    const [, mtime, , , size] = stats
    if (path === '' || /^\s/.test(path) || path.startsWith('"') || !mtime || !size || stats.includes(null)) {
      return undefined
    }
    entries.push({ path, size: Number(size[1]), mtimeMs: Number(mtime[1]) * 1000 + Number(mtime[2]) / 1e6 })
  }
  return entries
}

const countOf = (stdout: string) => stdout.split('\n').filter(line => line.trim() !== '').length

/**
 * What the court learned: each result read only when it means something,
 * so a failed, timed out or garbled result adds no fact.
 *
 * @param plan the commands, as `planOf` gave them
 * @param results each command's result, in the same order
 */
export const factsOf = (plan: readonly ExhibitQuery[], results: readonly ExhibitResult[]): Facts => {
  const facts: Facts = {}
  // a push is read only once its remote is known to push plainly
  let isPushPlain = !plan.some(one => one.kind === 'pushconfig')
  plan.forEach((one, at) => {
    const result = results[at]
    if (result === undefined) {
      return
    }
    const out = result.stdout.trim()
    switch (one.kind) {
      case 'inside': {
        const [inside, top = '', prefix, branch = '', indexPath = ''] = result.stdout.split('\n')
        facts.isRepo = result.exitCode === 0 && inside === 'true'
        if (facts.isRepo && indexPath !== '') {
          facts.indexPath = indexPath
        }
        // a detached HEAD prints HEAD for every commit: it names no branch
        if (facts.isRepo && top !== '' && prefix !== undefined && branch !== '' && branch !== 'HEAD') {
          Object.assign(facts, { top, prefix, branch })
        }
        break
      }
      case 'pushconfig':
        isPushPlain = result.exitCode === 1
        break
      case 'behind':
      case 'ahead':
        if (result.exitCode === 0 && /^\d+$/.test(out)) {
          facts[one.kind] = Number(out)
        }
        break
      case 'authors': {
        const authors = new Set(out.split('\n').filter(line => line.includes('@')))
        if (result.exitCode === 0 && authors.size > 0) {
          facts.upstreamAuthors = authors.size
        }
        break
      }
      case 'tracked':
        if (one.target !== undefined && (result.exitCode === 0 || result.exitCode === 1)) {
          facts.tracked = { ...facts.tracked, [one.target]: result.exitCode === 0 }
        }
        break
      case 'untracked':
        if (result.exitCode === 0) {
          facts.untracked = { ...facts.untracked, [one.target ?? '.']: countOf(out) }
        }
        break
      case 'indexed': {
        const entries = result.exitCode === 0 ? entriesOf(result.stdout) : undefined
        if (entries !== undefined && one.target !== undefined) {
          facts.indexed = { ...facts.indexed, [one.target]: entries }
        }
        break
      }
      case 'ignored':
        if (result.exitCode === 0 && one.target !== undefined) {
          facts.ignoredIn = { ...facts.ignoredIn, [one.target]: countOf(out) }
        } else if (result.exitCode === 0) {
          facts.ignored = countOf(out)
        }
        break
    }
  })
  // the targets are read together or not at all: one unread leaves every
  // target unknown, never a partial picture
  const targets = plan.filter(one => one.target !== undefined)
  // every per-target read is required; a kind not listed here reads as unread
  const readFor: Partial<Record<ExhibitKind, Record<string, unknown> | undefined>> = {
    tracked: facts.tracked,
    untracked: facts.untracked,
    ignored: facts.ignoredIn,
    indexed: facts.indexed,
  }
  const isEveryTargetRead = targets.every(one => {
    const read = readFor[one.kind] ?? {}
    return Object.hasOwn(read, one.target ?? '') && read[one.target ?? ''] !== undefined
  })
  if (!isEveryTargetRead) {
    delete facts.tracked
    delete facts.untracked
    delete facts.ignoredIn
    delete facts.indexed
  }
  if (!isPushPlain) {
    delete facts.behind
    delete facts.upstreamAuthors
  }
  return facts.isRepo === false ? { isRepo: false } : facts
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
 * The facts with every fact about the delete targets removed.
 */
export const withoutTargets = (facts: Facts): Facts => {
  const { tracked, untracked, ignoredIn, indexed, modifiedIn, ...rest } = facts
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
 * The exhibits as the court enters them, lettered A, B, C. They name counts
 * and states only, never an author's address.
 */
export const exhibitLinesOf = (facts: Facts): string[] => {
  const said: string[] = []
  if (facts.isRepo === false) {
    said.push('this is not a git repository.')
  }
  if (facts.behind !== undefined) {
    said.push(
      facts.behind === 0
        ? 'the upstream branch has no commits this branch lacks.'
        : `the upstream branch has ${plural(facts.behind, 'commit', 'commits')} this branch does not` +
            (facts.upstreamAuthors === undefined ? '.' : `, by ${plural(facts.upstreamAuthors, 'author', 'authors')}.`),
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
  for (const [target, isTracked] of Object.entries(facts.tracked ?? {})) {
    const name = sanitizedOf(target, NAME_CELLS)
    said.push(isTracked ? `${name} is tracked by git, so history keeps it.` : `${name} is not tracked by git, so history does not keep it.`)
  }
  for (const [target, count] of Object.entries(facts.untracked ?? {})) {
    if (target === '.') {
      said.push(count === 0 ? 'the repository holds no untracked files.' : `the repository holds ${plural(count, 'untracked file', 'untracked files')}.`)
    } else if (count > 0) {
      said.push(`${sanitizedOf(target, NAME_CELLS)} holds ${plural(count, 'untracked file', 'untracked files')}.`)
    }
  }
  for (const [target, count] of Object.entries(facts.modifiedIn ?? {})) {
    if (count > 0) {
      said.push(`${sanitizedOf(target, NAME_CELLS)} holds ${plural(count, 'file', 'files')} changed since git last recorded them, which history does not keep.`)
    }
  }
  for (const [target, count] of Object.entries(facts.ignoredIn ?? {})) {
    if (count > 0) {
      said.push(`${sanitizedOf(target, NAME_CELLS)} holds ${plural(count, 'ignored file', 'ignored files')}, which history does not keep.`)
    }
  }
  if (facts.ignored !== undefined) {
    said.push(`the repository holds ${plural(facts.ignored, 'ignored file', 'ignored files')}.`)
  }
  return said.map((line, at) => `Exhibit ${String.fromCharCode(65 + at)}: ${line}`)
}

/**
 * The facts precedent compares, only when every one the plan asks for was
 * read in a repository: undefined when any is unknown (no git, not a
 * repository, no upstream, a timeout, unreadable output) or the charge has
 * none, so a failed exhibit can never stand in for a known one.
 *
 * @param plan the commands, as `planOf` gave them
 * @param facts what they returned, as `factsOf` read it
 */
export const materialOf = (plan: readonly ExhibitQuery[], facts: Facts): MaterialFacts | undefined => {
  const asked = plan.filter(one => one.kind === 'behind' || one.kind === 'tracked')
  const isRead = (one: ExhibitQuery) =>
    one.kind === 'behind' ? facts.behind !== undefined : one.target !== undefined && Object.hasOwn(facts.tracked ?? {}, one.target) && facts.tracked?.[one.target] !== undefined
  const isPlaced = facts.top !== undefined && facts.prefix !== undefined && facts.branch !== undefined
  return asked.length > 0 && facts.isRepo === true && isPlaced && asked.every(isRead) && isEveryTargetClean(facts)
    ? materialFactsOf(facts)
    : undefined
}

/**
 * The facts precedent compares.
 */
export const materialFactsOf = (facts: Facts): MaterialFacts => ({
  ...(facts.untracked === undefined ? {} : { untracked: facts.untracked }),
  ...(facts.ignoredIn === undefined ? {} : { ignoredIn: facts.ignoredIn }),
  ...(facts.modifiedIn === undefined ? {} : { modifiedIn: facts.modifiedIn }),
  ...(facts.top === undefined ? {} : { top: facts.top }),
  ...(facts.prefix === undefined ? {} : { prefix: facts.prefix }),
  ...(facts.branch === undefined ? {} : { branch: facts.branch }),
  ...(facts.behind === undefined ? {} : { behind: facts.behind }),
  ...(facts.tracked === undefined ? {} : { tracked: facts.tracked }),
})

const trackedOf = (facts: MaterialFacts) =>
  JSON.stringify(Object.entries(facts.tracked ?? {}).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

const isKnown = (facts: MaterialFacts) => facts.behind !== undefined || Object.keys(facts.tracked ?? {}).length > 0

/**
 * Whether every delete target was read clean: no untracked, ignored or
 * changed file under it, each count known. A target with any of them holds
 * work a delete loses that its tracked state does not show.
 */
const isEveryTargetClean = (facts: MaterialFacts) =>
  Object.keys(facts.tracked ?? {}).every(
    target => facts.untracked?.[target] === 0 && facts.ignoredIn?.[target] === 0 && facts.modifiedIn?.[target] === 0,
  )

const isPlacedNow = (facts: MaterialFacts) =>
  facts.top !== undefined && facts.prefix !== undefined && facts.branch !== undefined

/**
 * Whether the facts that matter are the same then and now: where git ran
 * was read now and is the same, a fact about the target was read
 * (unknown never equals unknown), no upstream commits this branch lacks in
 * either, and every target tracked or not as before. `now` comes from
 * `materialOf`, so it holds every fact its charge asks for; equality
 * makes `then` hold the same.
 */
export const isSameMaterial = (then: MaterialFacts, now: MaterialFacts): boolean =>
  isPlacedNow(now) &&
  isKnown(now) &&
  isEveryTargetClean(then) &&
  isEveryTargetClean(now) &&
  then.top === now.top &&
  then.prefix === now.prefix &&
  then.branch === now.branch &&
  then.behind === now.behind &&
  (now.behind === undefined || now.behind === 0) &&
  trackedOf(then) === trackedOf(now)
