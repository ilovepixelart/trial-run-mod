import { describe, expect, test, tier } from 'claude-code/testing'

import { GIT_ENV, GIT_HARDENING, exhibitLinesOf, factsOf, isSameMaterial, materialFactsOf, materialOf, planOf, sanitizedOf } from '../hooks/exhibits'
import type { ExhibitQuery } from '../hooks/exhibits'

tier('user')

const ran = (exitCode: number, stdout = '') => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

/**
 * The git subcommand and its own arguments, the hardening flags set aside.
 */
const subcommandOf = (query: ExhibitQuery) => query.argv.slice(1 + GIT_HARDENING.length)

const ALLOWED = [
  ['rev-parse', '--is-inside-work-tree', '--show-toplevel', '--show-prefix', '--abbrev-ref', 'HEAD'],
  ['rev-list', '--count', '@{upstream}..HEAD'],
]

/**
 * A range between two plain ref names, as a named push reads it.
 */
const RANGE = /^refs\/heads\/[A-Za-z0-9._\/-]+\.\.refs\/remotes\/[A-Za-z0-9._\/-]+$/

const isPushConfigQuery = (args: readonly string[]) =>
  args.length === 3 && args[0] === 'config' && args[1] === '--get-regexp' && /^\^remote\\\.[A-Za-z0-9_\\./-]+\\\.\(push\|mirror\)\$$/.test(args[2] ?? '')

const isRangeQuery = (args: readonly string[]) =>
  ((args.length === 4 && args[0] === 'rev-list' && args[1] === '--count') ||
    (args.length === 6 && args[0] === 'log' && args[1] === '-20' && args[2] === '--no-show-signature' && args[3] === '--format=%ae')) &&
  args.at(-2) === '--end-of-options' &&
  RANGE.test(args.at(-1) ?? '')

const isAllowed = (args: readonly string[]) =>
  ALLOWED.some(allowed => allowed.length === args.length && allowed.every((word, i) => word === args[i])) ||
  isRangeQuery(args) ||
  isPushConfigQuery(args) ||
  (args[0] === 'ls-files' && args.at(-2) === '--' &&
    [['--error-unmatch'], ['--others', '--exclude-standard'], ['--others', '--ignored', '--exclude-standard']].some(
      flags => flags.length === args.length - 3 && flags.every((flag, i) => flag === args[i + 1]),
    )) ||
  (args[0] === 'ls-files' &&
    [['--others', '--exclude-standard'], ['--others', '--ignored', '--exclude-standard']].some(
      flags => flags.length === args.length - 1 && flags.every((flag, i) => flag === args[i + 1]),
    ))

const COMMANDS = [
  'rm -rf src',
  'rm -rf -- -rf "a b" $(touch x)',
  'git push --force origin main',
  'git push -f',
  'git push -f origin main',
  'git reset --hard HEAD~3',
  'git clean -fdx',
  'git clean -fd',
  "psql -c 'DROP TABLE users'",
  'kubectl delete pod web',
  'terraform destroy',
  'find . -name x -delete',
]

describe('exhibits', () => {
  test('only allowlisted git argv run, every one hardened, for every charge', () => {
    const seen = new Set<string>()
    for (const command of COMMANDS) {
      for (const query of planOf(command)) {
        expect(query.argv[0], command).toBe('git')
        expect(query.argv.slice(1, 1 + GIT_HARDENING.length), command).toEqual([...GIT_HARDENING])
        expect(isAllowed(subcommandOf(query)), `${command}: ${subcommandOf(query).join(' ')}`).toBe(true)
        seen.add(subcommandOf(query)[0] ?? '')
      }
    }
    expect([...seen].toSorted()).toEqual(['config', 'log', 'ls-files', 'rev-list', 'rev-parse'])
  })

  test('the hardening turns off fsmonitor, hooks, the untracked cache, signatures and the pager, and the env drops system and global config and every askpass program', () => {
    expect(GIT_HARDENING).toEqual([
      '-c', 'core.fsmonitor=false',
      '-c', 'core.hooksPath=/dev/null',
      '-c', 'core.untrackedCache=false',
      '-c', 'log.showSignature=false',
      '--no-optional-locks',
      '--no-pager',
    ])
    expect(GIT_ENV).toEqual({
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_PAGER: 'cat',
      PAGER: 'cat',
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
      LC_ALL: 'C',
    })
  })

  test('a delete target is always passed after --, so a path cannot become an option', () => {
    for (const query of planOf('rm -rf -- -rf --output=/tmp/x')) {
      const args = subcommandOf(query)
      if (args[0] === 'ls-files' && query.target !== undefined) {
        expect(args.at(-2)).toBe('--')
        expect(args.at(-1)).toBe(query.target)
      }
    }
    expect(planOf('rm -rf -- -rf --output=/tmp/x').map(query => query.target).filter(Boolean)).toEqual([
      '-rf', '-rf', '--output=/tmp/x', '--output=/tmp/x',
    ])
  })

  test('each charge gathers the facts that bear on it', () => {
    const kinds = (command: string) => planOf(command).map(query => query.kind)
    expect(kinds('git push --force origin main')).toEqual(['inside', 'behind', 'authors', 'pushconfig'])
    expect(kinds('git reset --hard HEAD~3')).toEqual(['inside', 'ahead'])
    expect(kinds('rm -rf src')).toEqual(['inside', 'tracked', 'untracked'])
    // more targets than the court reads: none are read, never a partial picture
    expect(kinds('rm -rf a b c d')).toEqual(['inside'])
    expect(kinds('git clean -fd')).toEqual(['inside', 'untracked'])
    expect(kinds('git clean -fdx')).toEqual(['inside', 'untracked', 'ignored'])
    expect(kinds('git clean -fdX')).toEqual(['inside', 'untracked', 'ignored'])
    expect(kinds('terraform destroy')).toEqual([])
    expect(kinds("psql -c 'DROP TABLE users'")).toEqual([])
  })

  test('results become facts: counts, tracked state, distinct authors, and nothing from a failed or missing result', () => {
    const plan = planOf('git push --force origin main')
    const facts = factsOf(plan, [ran(0, 'true\n'), ran(0, '3\n'), ran(0, 'a@x\nb@y\na@x\n'), ran(1)])
    expect(facts).toEqual({ isRepo: true, behind: 3, upstreamAuthors: 2 })

    const deleted = planOf('rm -rf src')
    expect(factsOf(deleted, [ran(0, 'true\n'), ran(1), ran(0, 'src/a\nsrc/b\n')])).toEqual({
      isRepo: true,
      tracked: { src: false },
      untracked: { src: 2 },
    })
    expect(factsOf(deleted, [ran(0, 'true\n'), ran(0, 'src/a\n'), ran(0, '')])).toEqual({
      isRepo: true,
      tracked: { src: true },
      untracked: { src: 0 },
    })
    expect(factsOf(deleted, [ran(0, 'true\n'), ran(128), ran(128)])).toEqual({ isRepo: true })
    expect(factsOf(plan, [undefined, ran(128, ''), ran(0, 'not a number')])).toEqual({})
    expect(factsOf(plan, [ran(128), undefined, undefined])).toEqual({ isRepo: false })
    expect(factsOf(plan, [ran(128), ran(0, '3\n'), ran(0, 'a@x\n')])).toEqual({ isRepo: false })
  })

  test('sanitising strips control characters, cuts long text, and keeps plain text', () => {
    expect(sanitizedOf('src\u001b[31m\u0007\nx', 40)).toBe('src[31mx')
    expect(sanitizedOf('a'.repeat(100), 10)).toBe('aaaaaaa...')
    expect(sanitizedOf('plain/path.txt', 40)).toBe('plain/path.txt')
  })

  test('exhibit lines are lettered, name only counts and states, never author emails', () => {
    expect(exhibitLinesOf({ isRepo: true, behind: 3, upstreamAuthors: 2 })).toEqual([
      'Exhibit A: the upstream branch has 3 commits this branch does not, by 2 authors.',
    ])
    expect(exhibitLinesOf({ isRepo: true, behind: 0, upstreamAuthors: 1 })).toEqual([
      'Exhibit A: the upstream branch has no commits this branch lacks.',
    ])
    expect(exhibitLinesOf({ isRepo: true, ahead: 2 })).toEqual([
      'Exhibit A: 2 local commits are not on the upstream branch.',
    ])
    expect(exhibitLinesOf({ isRepo: true, tracked: { src: true, 'tmp\u0007x': false }, untracked: { src: 0, 'tmp\u0007x': 4 } })).toEqual([
      'Exhibit A: src is tracked by git, so history keeps it.',
      'Exhibit B: tmpx is not tracked by git, so history does not keep it.',
      'Exhibit C: tmpx holds 4 untracked files.',
    ])
    expect(exhibitLinesOf({ isRepo: true, untracked: { '.': 5 }, ignored: 9 })).toEqual([
      'Exhibit A: the repository holds 5 untracked files.',
      'Exhibit B: the repository holds 9 ignored files.',
    ])
    expect(exhibitLinesOf({ isRepo: false })).toEqual(['Exhibit A: this is not a git repository.'])
    expect(exhibitLinesOf({})).toEqual([])
    expect(exhibitLinesOf({ isRepo: true, behind: 1, upstreamAuthors: 3 }).join(' ')).not.toContain('@')
  })

  test('the facts that matter for precedent: upstream ahead and each target tracked or not', () => {
    expect(materialFactsOf({ isRepo: true, behind: 0, upstreamAuthors: 4, untracked: { src: 3 } })).toEqual({ behind: 0 })
    expect(materialFactsOf({ isRepo: true, tracked: { src: true }, untracked: { src: 1 } })).toEqual({ tracked: { src: true } })
    expect(materialFactsOf({})).toEqual({})
  })

  test('material facts exist only when every one the plan asks for was read', () => {
    const push = planOf('git push --force origin main')
    const here = { top: '/work/app', prefix: '', branch: 'main' }
    expect(materialOf(push, { isRepo: true, ...here, behind: 0, upstreamAuthors: 1 })).toEqual({ ...here, behind: 0 })
    expect(materialOf(push, { isRepo: true, behind: 0 })).toBeUndefined()
    expect(materialOf(push, { isRepo: true, top: '/work/app', prefix: '', behind: 0 })).toBeUndefined()
    expect(materialOf(push, { isRepo: true, ...here, upstreamAuthors: 1 })).toBeUndefined()
    expect(materialOf(push, { isRepo: false })).toBeUndefined()
    expect(materialOf(push, { behind: 0 })).toBeUndefined()
    const rm = planOf('rm -rf a b')
    expect(materialOf(rm, { isRepo: true, ...here, tracked: { a: false, b: true } })).toEqual({ ...here, tracked: { a: false, b: true } })
    expect(materialOf(rm, { isRepo: true, ...here, tracked: { a: false } })).toBeUndefined()
    expect(materialOf(planOf('git clean -fd'), { isRepo: true, untracked: { '.': 0 } })).toBeUndefined()
    expect(materialOf(planOf('git reset --hard HEAD~1'), { isRepo: true, ahead: 0 })).toBeUndefined()
    expect(materialOf(planOf('terraform destroy'), {})).toBeUndefined()
    expect(materialOf(planOf('rm -rf'), { isRepo: true })).toBeUndefined()
  })

  test('unknown never equals unknown: facts match only when something was known and is the same', () => {
    expect(isSameMaterial({}, {})).toBe(false)
    expect(isSameMaterial({ tracked: {} }, { tracked: {} })).toBe(false)
    // without where git ran, a fact names no place: unknown on both sides never matches
    expect(isSameMaterial({ behind: 0 }, { behind: 0 })).toBe(false)
    expect(isSameMaterial({ tracked: { a: false } }, { tracked: { a: false } })).toBe(false)
    const here = { top: '/work/app', prefix: 'sub/', branch: 'main', tracked: { a: false } }
    expect(isSameMaterial({ ...here, top: undefined }, { ...here, top: undefined })).toBe(false)
    expect(isSameMaterial({ ...here, prefix: undefined }, { ...here, prefix: undefined })).toBe(false)
    expect(isSameMaterial({ ...here, branch: undefined }, { ...here, branch: undefined })).toBe(false)
    expect(isSameMaterial({ ...here, tracked: undefined }, { ...here, tracked: undefined })).toBe(false)
    expect(isSameMaterial({ ...here, tracked: undefined, behind: 0 }, { ...here, tracked: undefined, behind: 0 })).toBe(true)
    expect(isSameMaterial(here, { ...here })).toBe(true)
    expect(isSameMaterial(here, { ...here, top: '/work/other' })).toBe(false)
    expect(isSameMaterial(here, { ...here, prefix: '' })).toBe(false)
    expect(isSameMaterial(here, { ...here, branch: 'dev' })).toBe(false)
    expect(isSameMaterial({ tracked: { a: false } }, here)).toBe(false)
    expect(isSameMaterial({}, { tracked: { a: false } })).toBe(false)
  })

  test('a push is read for the branch it names, by name, and only in the one form that names it exactly', () => {
    const argsOf = (command: string) => planOf(command).map(subcommandOf)
    expect(argsOf('git push --force origin main')).toEqual([
      ['rev-parse', '--is-inside-work-tree', '--show-toplevel', '--show-prefix', '--abbrev-ref', 'HEAD'],
      ['rev-list', '--count', '--end-of-options', 'refs/heads/main..refs/remotes/origin/main'],
      ['log', '-20', '--no-show-signature', '--format=%ae', '--end-of-options', 'refs/heads/main..refs/remotes/origin/main'],
      ['config', '--get-regexp', '^remote\\.origin\\.(push|mirror)$'],
    ])
    expect(argsOf('git push -f up.stream release/1.2')[1]).toEqual([
      'rev-list', '--count', '--end-of-options', 'refs/heads/release/1.2..refs/remotes/up.stream/release/1.2',
    ])
    expect(argsOf('git push -f up.stream release/1.2')[3]).toEqual(['config', '--get-regexp', '^remote\\.up\\.stream\\.(push|mirror)$'])
    for (const command of [
      'git push --force',
      'git push -f',
      'git push --force origin',
      'git push --force origin HEAD:main',
      'git push --force origin HEAD',
      'git push --force origin @{u}',
      'git push --force origin feature:main',
      'git push --force origin +main',
      'git push --force origin main dev',
      'git push --force --all origin',
      'git push --force --tags origin main',
      'git push --force -u origin main',
      'git push --force origin ../main',
      'git push --force origin main..x',
      'git push --force origin -main',
      'git -C ../other push --force origin main',
      'git --no-pager push -f main',
    ]) {
      expect(planOf(command), command).toEqual([])
    }
  })

  test('a target the shell would read differently, or a line run elsewhere, gets no exhibit at all', () => {
    for (const command of [
      'rm -rf "build" src',
      'rm -rf build\\ src',
      'rm -rf ~/x',
      'rm -rf $HOME',
      'rm -rf {dist,src}',
      'rm -rf src/*',
      'cd app && rm -rf build',
      'git -C ../other clean -fdx',
      'git -C ../other reset --hard',
    ]) {
      expect(planOf(command), command).toEqual([])
    }
    expect(planOf('rm -rf a b c d').map(query => query.kind)).toEqual(['inside'])
    expect(planOf('rm -rf build/').map(query => query.kind)).toEqual(['inside'])
    expect(planOf('rm -rf -- -x').map(query => query.target)).toEqual([undefined, '-x', '-x'])
    expect(planOf('rm -rf node_modules').map(query => query.kind)).toEqual(['inside', 'tracked', 'untracked'])
  })

  test('one unread target removes every target fact', () => {
    const plan = planOf('rm -rf a b')
    expect(factsOf(plan, [ran(0, 'true\n'), ran(0, 'a\n'), ran(0, ''), ran(128), ran(0, '')])).toEqual({ isRepo: true })
    expect(factsOf(plan, [ran(0, 'true\n'), ran(0, 'a\n'), ran(0, ''), ran(1), undefined])).toEqual({ isRepo: true })
    expect(factsOf(plan, [ran(0, 'true\n'), ran(0, 'a\n'), ran(0, ''), ran(1), ran(0, 'b/x\n')])).toEqual({
      isRepo: true,
      tracked: { a: true, b: false },
      untracked: { a: 0, b: 1 },
    })
  })

  test('the repository, the directory within it and the branch are read with the first query', () => {
    const plan = planOf('rm -rf build')
    expect(factsOf(plan, [ran(0, 'true\n/work/app\nsub/\nmain\n'), ran(1), ran(0, '')])).toEqual({
      isRepo: true, top: '/work/app', prefix: 'sub/', branch: 'main', tracked: { build: false }, untracked: { build: 0 },
    })
    expect(factsOf(plan, [ran(0, 'true\n/work/app\n\nmain\n'), ran(1), ran(0, '')]).prefix).toBe('')
    expect(factsOf(plan, [ran(0, 'true\n'), ran(1), ran(0, '')]).top).toBeUndefined()
    expect(factsOf(plan, [ran(0, 'true\n\n\nmain\n'), ran(1), ran(0, '')]).top).toBeUndefined()
  })

  test('a remote whose config rewrites or mirrors pushes leaves the push unknown', () => {
    const plan = planOf('git push --force origin main')
    const inside = ran(0, 'true\n/work/app\n\nmain\n')
    expect(factsOf(plan, [inside, ran(0, '0\n'), ran(0, ''), ran(1)]).behind).toBe(0)
    expect(factsOf(plan, [inside, ran(0, '0\n'), ran(0, ''), ran(0, 'remote.origin.push refs/heads/*:refs/heads/x/*\n')]).behind).toBeUndefined()
    expect(factsOf(plan, [inside, ran(0, '0\n'), ran(0, 'a@x\n'), ran(128)]).behind).toBeUndefined()
    expect(factsOf(plan, [inside, ran(0, '0\n'), ran(0, 'a@x\n'), undefined]).upstreamAuthors).toBeUndefined()
  })

  test('a detached HEAD names no branch, so the place is unknown', () => {
    const plan = planOf('rm -rf build')
    const facts = factsOf(plan, [ran(0, 'true\n/work/app\n\nHEAD\n'), ran(1), ran(0, '')])
    expect(facts.branch).toBeUndefined()
    expect(facts.top).toBeUndefined()
    expect(materialOf(plan, facts)).toBeUndefined()
  })
})

