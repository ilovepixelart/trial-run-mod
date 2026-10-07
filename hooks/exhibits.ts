import { chargedOf } from './risky'

/**
 * Flags every exhibit runs git with. A repository's own config can name
 * programs git runs on its behalf; these turn off the ones the allowlisted
 * commands could reach: the filesystem monitor (`ls-files` runs it), hooks,
 * the untracked cache, signature verification in `log`, and the pager.
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

export type ExhibitKind = 'inside' | 'behind' | 'ahead' | 'authors' | 'tracked' | 'untracked' | 'ignored'

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
}

/**
 * The facts precedent compares: whether the upstream branch moved, and
 * whether each target is still tracked.
 */
export type MaterialFacts = Pick<Facts, 'behind' | 'tracked'>

const MAX_TARGETS = 3
const NAME_CELLS = 60

const git = (...args: string[]): readonly string[] => ['git', ...GIT_HARDENING, ...args]

const query = (kind: ExhibitKind, argv: readonly string[], target?: string): ExhibitQuery =>
  target === undefined ? { kind, argv } : { kind, argv, target }

const INSIDE = query('inside', git('rev-parse', '--is-inside-work-tree'))

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
  return targets.slice(0, MAX_TARGETS)
}

const hasShortFlag = (words: readonly string[], letter: string) =>
  words.some(word => /^-[a-zA-Z]+$/.test(word) && word.includes(letter))

/**
 * The git commands the court runs for a charged command, from a fixed
 * allowlist; every path is passed after `--`, so it is never an option.
 *
 * @param command the Bash tool's `command`, as the model wrote it
 */
export const planOf = (command: string): ExhibitQuery[] => {
  const charged = chargedOf(command)
  if (charged === undefined) {
    return []
  }
  const { charge, words } = charged
  switch (charge.id) {
    case 'force-push':
      return [
        INSIDE,
        query('behind', git('rev-list', '--count', 'HEAD..@{upstream}')),
        query('authors', git('log', '-20', '--no-show-signature', '--format=%ae', 'HEAD..@{upstream}')),
      ]
    case 'hard-reset':
      return [INSIDE, query('ahead', git('rev-list', '--count', '@{upstream}..HEAD'))]
    case 'recursive-delete':
      return words[0] !== 'rm'
        ? [INSIDE]
        : [
            INSIDE,
            ...targetsOf(words).flatMap(target => [
              query('tracked', git('ls-files', '--error-unmatch', '--', target), target),
              query('untracked', git('ls-files', '--others', '--exclude-standard', '--', target), target),
            ]),
          ]
    case 'git-clean':
      return [
        INSIDE,
        query('untracked', git('ls-files', '--others', '--exclude-standard')),
        ...(hasShortFlag(words, 'x') ? [query('ignored', git('ls-files', '--others', '--ignored', '--exclude-standard'))] : []),
      ]
    default:
      return []
  }
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
  plan.forEach((one, at) => {
    const result = results[at]
    if (result === undefined) {
      return
    }
    const out = result.stdout.trim()
    switch (one.kind) {
      case 'inside':
        facts.isRepo = result.exitCode === 0 && out === 'true'
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
      case 'ignored':
        if (result.exitCode === 0) {
          facts.ignored = countOf(out)
        }
        break
    }
  })
  return facts.isRepo === false ? { isRepo: false } : facts
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
    said.push(
      facts.ahead === 0
        ? 'every local commit is on the upstream branch.'
        : `${plural(facts.ahead, 'local commit is', 'local commits are')} not on the upstream branch.`,
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
  if (facts.ignored !== undefined) {
    said.push(`the repository holds ${plural(facts.ignored, 'ignored file', 'ignored files')}.`)
  }
  return said.map((line, at) => `Exhibit ${String.fromCharCode(65 + at)}: ${line}`)
}

/**
 * The facts precedent compares.
 */
export const materialFactsOf = (facts: Facts): MaterialFacts => ({
  ...(facts.behind === undefined ? {} : { behind: facts.behind }),
  ...(facts.tracked === undefined ? {} : { tracked: facts.tracked }),
})

const trackedOf = (facts: MaterialFacts) =>
  JSON.stringify(Object.entries(facts.tracked ?? {}).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

/**
 * Whether the facts that matter are the same then and now: no upstream
 * commits this branch lacks in either, and every target tracked or not
 * as before.
 */
export const isSameMaterial = (then: MaterialFacts, now: MaterialFacts): boolean =>
  then.behind === now.behind && (now.behind === undefined || now.behind === 0) && trackedOf(then) === trackedOf(now)
