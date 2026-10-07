import { describe, expect, test, tier } from 'claude-code/testing'

import { GIT_ENV, GIT_HARDENING, exhibitLinesOf, factsOf, materialFactsOf, planOf, sanitizedOf } from '../hooks/exhibits'
import type { ExhibitQuery } from '../hooks/exhibits'

tier('user')

const ran = (exitCode: number, stdout = '') => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

/**
 * The git subcommand and its own arguments, the hardening flags set aside.
 */
const subcommandOf = (query: ExhibitQuery) => query.argv.slice(1 + GIT_HARDENING.length)

const ALLOWED = [
  ['rev-parse', '--is-inside-work-tree'],
  ['rev-list', '--count', 'HEAD..@{upstream}'],
  ['rev-list', '--count', '@{upstream}..HEAD'],
  ['log', '-20', '--no-show-signature', '--format=%ae', 'HEAD..@{upstream}'],
]

const isAllowed = (args: readonly string[]) =>
  ALLOWED.some(allowed => allowed.length === args.length && allowed.every((word, i) => word === args[i])) ||
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
    expect([...seen].toSorted()).toEqual(['log', 'ls-files', 'rev-list', 'rev-parse'])
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
    expect(kinds('git push --force origin main')).toEqual(['inside', 'behind', 'authors'])
    expect(kinds('git reset --hard HEAD~3')).toEqual(['inside', 'ahead'])
    expect(kinds('rm -rf src')).toEqual(['inside', 'tracked', 'untracked'])
    expect(kinds('rm -rf a b c d')).toEqual(['inside', 'tracked', 'untracked', 'tracked', 'untracked', 'tracked', 'untracked'])
    expect(kinds('git clean -fd')).toEqual(['inside', 'untracked'])
    expect(kinds('git clean -fdx')).toEqual(['inside', 'untracked', 'ignored'])
    expect(kinds('terraform destroy')).toEqual([])
    expect(kinds("psql -c 'DROP TABLE users'")).toEqual([])
  })

  test('results become facts: counts, tracked state, distinct authors, and nothing from a failed or missing result', () => {
    const plan = planOf('git push --force origin main')
    const facts = factsOf(plan, [ran(0, 'true\n'), ran(0, '3\n'), ran(0, 'a@x\nb@y\na@x\n')])
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
})
