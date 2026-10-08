import { describe, expect, test, tier } from 'claude-code/testing'

import { GIT_ENV, GIT_HARDENING, exhibitLinesOf, factsOf, namesAlong, planOf, sanitizedOf, isLexicalPath, statPathsOf, targetsIn, withModified, withoutTargets } from '../hooks/exhibits'
import type { ExhibitQuery } from '../hooks/exhibits'

tier('user')

const ran = (exitCode: number, stdout = '') => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

const OID = 'a'.repeat(40)
/** What `ls-files --stage -z` prints for paths the index holds. */
const staged = (...paths: string[]) => paths.map(path => `100644 ${OID} 0\t${path}\0`).join('')
/** What `ls-tree -r -z HEAD` prints for the same paths, as HEAD holds them. */
const inHead = (...paths: string[]) => paths.map(path => `100644 blob ${OID}\t${path}\0`).join('')
/** HEAD names a commit on main. */
const MAIN = ran(0, 'main\n')

/**
 * The git subcommand and its own arguments, the hardening flags set aside.
 */
const subcommandOf = (query: ExhibitQuery) => query.argv.slice(1 + GIT_HARDENING.length)

/**
 * The subcommand's name, past any `-c name=value` the query adds.
 */
const nameOf = (args: readonly string[]): string => (args[0] === '-c' ? nameOf(args.slice(2)) : args[0] ?? '')

const ALLOWED = [
  ['rev-parse', '--is-inside-work-tree', '--show-toplevel', '--show-prefix', '--git-path', 'index'],
  ['rev-parse', '--abbrev-ref', '--verify', '--quiet', 'HEAD'],
  ['rev-list', '--count', '@{upstream}..HEAD'],
]

/**
 * A range between two plain ref names, as a named push reads it.
 */
const RANGE = /^refs\/heads\/[A-Za-z0-9._\/-]+\.\.refs\/remotes\/[A-Za-z0-9._\/-]+$/

const isPushConfigQuery = (args: readonly string[]) =>
  args.length === 3 && args[0] === 'config' && args[1] === '--get-regexp' && /^\^\(remote\\\.[A-Za-z0-9_\\./-]+\\\.\(push\|pushurl\|mirror\)\|url\\\.\.\*\\\.pushinsteadof\)\$$/.test(args[2] ?? '')

const isRangeQuery = (args: readonly string[]) =>
  ((args.length === 4 && args[0] === 'rev-list' && args[1] === '--count') ||
    (args.length === 6 && args[0] === 'log' && args[1] === '-20' && args[2] === '--no-show-signature' && args[3] === '--format=%ae')) &&
  args.at(-2) === '--end-of-options' &&
  RANGE.test(args.at(-1) ?? '')

const isAllowed = (args: readonly string[]) =>
  ALLOWED.some(allowed => allowed.length === args.length && allowed.every((word, i) => word === args[i])) ||
  isRangeQuery(args) ||
  (args.length === 6 && args[0] === '-c' && args[1] === 'core.quotePath=false' && args[2] === 'ls-files' && args[3] === '--debug' && args[4] === '--') ||
  isPushConfigQuery(args) ||
  (args.length === 6 && ['ls-tree', '-r', '-z', 'HEAD', '--'].every((word, i) => word === args[i])) ||
  (args[0] === 'ls-files' && args.at(-2) === '--' &&
    [['--stage', '-z'], ['--others', '--exclude-standard'], ['--others', '--ignored', '--exclude-standard']].some(
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
        seen.add(nameOf(subcommandOf(query)))
      }
    }
    expect([...seen].toSorted()).toEqual(['config', 'log', 'ls-files', 'ls-tree', 'rev-list', 'rev-parse'])
  })

  test('the hardening turns off fsmonitor, hooks, the untracked cache, signatures, pathspec magic and the pager, and the env drops system and global config and every askpass program', () => {
    expect(GIT_HARDENING).toEqual([
      '-c', 'core.fsmonitor=false',
      '-c', 'core.hooksPath=/dev/null',
      '-c', 'core.untrackedCache=false',
      '-c', 'log.showSignature=false',
      '--literal-pathspecs',
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
      if (query.target !== undefined) {
        expect(args.at(-2)).toBe('--')
        expect(args.at(-1)).toBe(query.target)
      }
    }
    expect(planOf('rm -rf -- -rf --output=/tmp/x').map(query => query.target).filter(Boolean)).toEqual([
      ...Array(5).fill('-rf'), ...Array(5).fill('--output=/tmp/x'),
    ])
  })

  test('each charge gathers the facts that bear on it', () => {
    const kinds = (command: string) => planOf(command).map(query => query.kind)
    expect(kinds('git push --force origin main')).toEqual(['inside', 'head', 'behind', 'authors', 'pushconfig'])
    expect(kinds('git reset --hard HEAD~3')).toEqual(['inside', 'head', 'ahead'])
    expect(kinds('rm -rf src')).toEqual(['inside', 'head', 'tracked', 'committed', 'untracked', 'ignored', 'indexed'])
    // more targets than the court reads: none are read, never a partial picture
    expect(kinds('rm -rf a b c d')).toEqual(['inside', 'head'])
    expect(kinds('git clean -fd')).toEqual(['inside', 'head', 'untracked'])
    expect(kinds('git clean -fdx')).toEqual(['inside', 'head', 'untracked', 'ignored'])
    expect(kinds('git clean -fdX')).toEqual(['inside', 'head', 'untracked', 'ignored'])
    expect(kinds('terraform destroy')).toEqual([])
    expect(kinds("psql -c 'DROP TABLE users'")).toEqual([])
  })

  test('results become facts: counts, tracked state, distinct authors, and nothing from a failed or missing result', () => {
    const plan = planOf('git push --force origin main')
    const facts = factsOf(plan, [ran(0, 'true\n'), MAIN, ran(0, '3\n'), ran(0, 'a@x\nb@y\na@x\n'), ran(1)])
    expect(facts).toEqual({ isRepo: true, hasCommits: true, behind: 3, upstreamAuthors: 2 })

    const deleted = planOf('rm -rf src')
    expect(factsOf(deleted, [ran(0, 'true\n'), MAIN, ran(0, ''), ran(0, ''), ran(0, 'src/a\nsrc/b\n'), ran(0, ''), ran(0, '')])).toEqual({
      isRepo: true,
      hasCommits: true,
      tracked: { src: false },
      committed: { src: true },
      untracked: { src: 2 },
      ignoredIn: { src: 0 },
      indexed: { src: [] },
    })
    expect(factsOf(deleted, [ran(0, 'true\n'), MAIN, ran(0, staged('src/a')), ran(0, inHead('src/a')), ran(0, ''), ran(0, 'src/prod.env\n'), ran(0, '')])).toEqual({
      isRepo: true,
      hasCommits: true,
      tracked: { src: true },
      committed: { src: true },
      untracked: { src: 0 },
      ignoredIn: { src: 1 },
      indexed: { src: [] },
    })
    expect(factsOf(deleted, [ran(0, 'true\n'), MAIN, ran(128), ran(128), ran(128), ran(128), ran(128)])).toEqual({ isRepo: true, hasCommits: true })
    expect(factsOf(deleted, [ran(0, 'true\n'), MAIN, ran(0, staged('src/a')), ran(0, inHead('src/a')), ran(0, ''), ran(128), ran(0, '')])).toEqual({ isRepo: true, hasCommits: true })
    expect(factsOf(plan, [undefined, undefined, ran(128, ''), ran(0, 'not a number')])).toEqual({})
    expect(factsOf(plan, [ran(128), undefined, undefined])).toEqual({ isRepo: false })
    expect(factsOf(plan, [ran(128), ran(128), ran(0, '3\n'), ran(0, 'a@x\n')])).toEqual({ isRepo: false })
  })

  test('sanitising strips control characters, cuts long text, and keeps plain text', () => {
    expect(sanitizedOf('src\u001b[31m\u0007\nx', 40)).toBe('src[31mx')
    expect(sanitizedOf('a'.repeat(100), 10)).toBe('aaaaaaa...')
    expect(sanitizedOf('plain/path.txt', 40)).toBe('plain/path.txt')
  })

  test('exhibit lines are lettered, name only counts and states, never author emails', () => {
    expect(exhibitLinesOf({ isRepo: true, behind: 3, upstreamAuthors: 2 })).toEqual([
      'Exhibit A: the upstream branch has 3 commits this branch does not, by 2 authors, as of the last fetch.',
    ])
    expect(exhibitLinesOf({ isRepo: true, behind: 0, upstreamAuthors: 1 })).toEqual([
      'Exhibit A: the upstream branch has no commits this branch lacks, as of the last fetch.',
    ])
    // git cannot read uncommitted changes without running the repository's own
    // filters, so a reset's exhibit says it did not look, never reassures alone
    expect(exhibitLinesOf({ isRepo: true, ahead: 2 })).toEqual([
      'Exhibit A: 2 local commits are not on the upstream branch; uncommitted changes were not checked.',
    ])
    expect(exhibitLinesOf({ isRepo: true, ahead: 0 })).toEqual([
      'Exhibit A: every local commit is on the upstream branch; uncommitted changes were not checked.',
    ])
    expect(exhibitLinesOf({ isRepo: true, tracked: { src: true, 'tmp\u0007x': false }, committed: { src: true, 'tmp\u0007x': true }, untracked: { src: 0, 'tmp\u0007x': 4 }, modifiedIn: { src: 0 } })).toEqual([
      'Exhibit A: src is tracked by git, so history keeps it.',
      'Exhibit B: tmpx is not tracked by git, so history does not keep it.',
      'Exhibit C: tmpx holds 4 untracked files.',
    ])
    // ignored files under a target are named: a delete takes them, and history never had them
    expect(exhibitLinesOf({ isRepo: true, tracked: { src: true }, committed: { src: true }, untracked: { src: 0 }, ignoredIn: { src: 1 }, modifiedIn: { src: 0 } })).toEqual([
      'Exhibit A: src is tracked by git, so history keeps it.',
      'Exhibit B: src holds 1 ignored file, which history does not keep.',
    ])
    expect(exhibitLinesOf({ isRepo: true, tracked: { a: false }, untracked: { a: 2 }, ignoredIn: { a: 0 } })).toEqual([
      'Exhibit A: a is not tracked by git, so history does not keep it.',
      'Exhibit B: a holds 2 untracked files.',
    ])
    expect(exhibitLinesOf({ isRepo: true, untracked: { '.': 5 }, ignored: 9 })).toEqual([
      'Exhibit A: the repository holds 5 untracked files.',
      'Exhibit B: the repository holds 9 ignored files.',
    ])
    expect(exhibitLinesOf({ isRepo: false })).toEqual(['Exhibit A: this is not a git repository.'])
    expect(exhibitLinesOf({})).toEqual([])
    expect(exhibitLinesOf({ isRepo: true, behind: 1, upstreamAuthors: 3 }).join(' ')).not.toContain('@')
  })

  test('a tracked target whose changes were not counted never reassures alone', () => {
    // a file as new as the index, or more files than the court stats
    expect(exhibitLinesOf({ isRepo: true, tracked: { src: true }, committed: { src: true }, untracked: { src: 0 }, ignoredIn: { src: 0 } })).toEqual([
      'Exhibit A: src is tracked by git, so history keeps its last commit; uncommitted changes under it were not checked.',
    ])
    expect(exhibitLinesOf({ isRepo: true, tracked: { src: true }, committed: { src: true }, untracked: { src: 0 }, ignoredIn: { src: 0 }, modifiedIn: { src: 0 } })).toEqual([
      'Exhibit A: src is tracked by git, so history keeps it.',
    ])
    // an untracked target has no index entries to count: history keeps none of it either way
    expect(exhibitLinesOf({ isRepo: true, tracked: { a: false }, untracked: { a: 0 } })).toEqual([
      'Exhibit A: a is not tracked by git, so history does not keep it.',
    ])
  })

  test('a push is read for the branch it names, by name, and only in the one form that names it exactly', () => {
    const argsOf = (command: string) => planOf(command).map(subcommandOf)
    expect(argsOf('git push --force origin main')).toEqual([
      ['rev-parse', '--is-inside-work-tree', '--show-toplevel', '--show-prefix', '--git-path', 'index'],
      ['rev-parse', '--abbrev-ref', '--verify', '--quiet', 'HEAD'],
      ['rev-list', '--count', '--end-of-options', 'refs/heads/main..refs/remotes/origin/main'],
      ['log', '-20', '--no-show-signature', '--format=%ae', '--end-of-options', 'refs/heads/main..refs/remotes/origin/main'],
      ['config', '--get-regexp', '^(remote\\.origin\\.(push|pushurl|mirror)|url\\..*\\.pushinsteadof)$'],
    ])
    expect(argsOf('git push -f up.stream release/1.2')[2]).toEqual([
      'rev-list', '--count', '--end-of-options', 'refs/heads/release/1.2..refs/remotes/up.stream/release/1.2',
    ])
    expect(argsOf('git push -f up.stream release/1.2')[4]).toEqual(['config', '--get-regexp', '^(remote\\.up\\.stream\\.(push|pushurl|mirror)|url\\..*\\.pushinsteadof)$'])
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
    expect(planOf('rm -rf a b c d').map(query => query.kind)).toEqual(['inside', 'head'])
    expect(planOf('rm -rf build/').map(query => query.kind)).toEqual(['inside', 'head'])
    expect(planOf('rm -rf -- -x').map(query => query.target)).toEqual([undefined, undefined, '-x', '-x', '-x', '-x', '-x'])
    expect(planOf('rm -rf node_modules').map(query => query.kind)).toEqual(['inside', 'head', 'tracked', 'committed', 'untracked', 'ignored', 'indexed'])
  })

  test('a target with a .. part, or in the repository store, gets no target query', () => {
    // git reads `lnk/../src` as src; the kernel follows lnk first. `.git` is
    // never tracked or listed, so it reads as an empty, clean folder
    for (const command of ['rm -rf lnk/../src', 'rm -rf ../app/src', 'rm -rf src/..', 'rm -rf .git', 'rm -rf .git/refs', 'rm -rf src .git', 'rm -rf vendor/lib/.git']) {
      expect(planOf(command).map(query => query.kind), command).toEqual(['inside', 'head'])
    }
    // a name that only contains them is a name like any other
    for (const command of ['rm -rf src..old', 'rm -rf .github', 'rm -rf .gitignore', 'rm -rf a.git', 'rm -rf ./src']) {
      expect(targetsIn(planOf(command)), command).toHaveLength(1)
    }
  })

  test('one unread target removes every target fact', () => {
    const plan = planOf('rm -rf a b')
    const here = [ran(0, 'true\n'), MAIN]
    // per target: tracked, committed, untracked, ignored, indexed
    const a = [ran(0, staged('a')), ran(0, inHead('a')), ran(0, ''), ran(0, ''), ran(0, '')]
    expect(factsOf(plan, [...here, ...a, ran(128), ran(0, ''), ran(0, ''), ran(0, ''), ran(0, '')])).toEqual({ isRepo: true, hasCommits: true })
    expect(factsOf(plan, [...here, ...a, ran(0, ''), undefined, ran(0, ''), ran(0, ''), ran(0, '')])).toEqual({ isRepo: true, hasCommits: true })
    expect(factsOf(plan, [...here, ...a, ran(0, ''), ran(0, ''), undefined, ran(0, ''), ran(0, '')])).toEqual({ isRepo: true, hasCommits: true })
    expect(factsOf(plan, [...here, ...a, ran(0, ''), ran(0, ''), ran(0, 'b/x\n'), undefined, ran(0, '')])).toEqual({ isRepo: true, hasCommits: true })
    expect(factsOf(plan, [...here, ...a, ran(0, ''), ran(0, ''), ran(0, 'b/x\n'), ran(0, 'b/y.log\n'), undefined])).toEqual({ isRepo: true, hasCommits: true })
    expect(factsOf(plan, [...here, ...a, ran(0, ''), ran(0, ''), ran(0, 'b/x\n'), ran(0, 'b/y.log\n'), ran(0, '')])).toEqual({
      isRepo: true,
      hasCommits: true,
      tracked: { a: true, b: false },
      committed: { a: true, b: true },
      untracked: { a: 0, b: 1 },
      ignoredIn: { a: 0, b: 1 },
      indexed: { a: [], b: [] },
    })
  })

  test('a target named like an Object.prototype member with no read result is unknown, not read', () => {
    const here = { top: '/work/app', prefix: '', branch: 'main' }
    for (const name of ['constructor', '__proto__', 'toString']) {
      const plan = planOf(`rm -rf src ${name}`)
      expect(plan.map(query => query.target), name).toEqual([undefined, undefined, ...Array(5).fill('src'), ...Array(5).fill(name)])
      // src reads in full; the named target's reads fail or never come back
      const src = [ran(0, staged('src/a')), ran(0, inHead('src/a')), ran(0, ''), ran(0, ''), ran(0, '')]
      const facts = factsOf(plan, [ran(0, 'true\n/work/app\n\n.git/index\n'), MAIN, ...src, ran(128), undefined, ran(128), undefined, ran(128)])
      expect(facts, name).toEqual({ isRepo: true, hasCommits: true, indexPath: '.git/index', ...here })
      expect(exhibitLinesOf(facts), name).toEqual([])
    }
  })

  test('a target named like an Object.prototype member is a fact like any other once read', () => {
    const plan = planOf('rm -rf __proto__')
    const facts = factsOf(plan, [ran(0, 'true\n/work/app\n\n.git/index\n'), MAIN, ran(0, ''), ran(0, ''), ran(0, ''), ran(0, ''), ran(0, '')])
    expect(Object.hasOwn(facts.tracked ?? {}, '__proto__')).toBe(true)
    expect(Object.hasOwn(facts.committed ?? {}, '__proto__')).toBe(true)
    expect(exhibitLinesOf(facts)).toEqual(['Exhibit A: __proto__ is not tracked by git, so history does not keep it.'])
  })

  test('the repository, the directory within it and the branch are read with the first two queries', () => {
    const plan = planOf('rm -rf build')
    const untracked = [ran(0, ''), ran(0, ''), ran(0, ''), ran(0, ''), ran(0, '')]
    expect(factsOf(plan, [ran(0, 'true\n/work/app\nsub/\n../.git/index\n'), MAIN, ...untracked])).toEqual({
      isRepo: true, hasCommits: true, top: '/work/app', prefix: 'sub/', branch: 'main', indexPath: '../.git/index',
      tracked: { build: false }, committed: { build: true }, untracked: { build: 0 }, ignoredIn: { build: 0 }, indexed: { build: [] },
    })
    expect(factsOf(plan, [ran(0, 'true\n/work/app\n\n.git/index\n'), MAIN, ...untracked]).prefix).toBe('')
    expect(factsOf(plan, [ran(0, 'true\n'), MAIN, ...untracked]).top).toBeUndefined()
    expect(factsOf(plan, [ran(0, 'true\n\n\n.git/index\n'), MAIN, ...untracked]).top).toBeUndefined()
    // HEAD that will not read names no branch, so the place is unknown
    expect(factsOf(plan, [ran(0, 'true\n/work/app\n\n.git/index\n'), undefined, ...untracked]).top).toBeUndefined()
    expect(factsOf(plan, [ran(0, 'true\n/work/app\n\n.git/index\n'), ran(0, 'main\nother\n'), ...untracked]).top).toBeUndefined()
  })

  test('a remote whose config rewrites or mirrors pushes leaves the push unknown', () => {
    const plan = planOf('git push --force origin main')
    const inside = ran(0, 'true\n/work/app\n\n.git/index\n')
    expect(factsOf(plan, [inside, MAIN, ran(0, '0\n'), ran(0, ''), ran(1)]).behind).toBe(0)
    expect(factsOf(plan, [inside, MAIN, ran(0, '0\n'), ran(0, ''), ran(0, 'remote.origin.push refs/heads/*:refs/heads/x/*\n')]).behind).toBeUndefined()
    expect(factsOf(plan, [inside, MAIN, ran(0, '0\n'), ran(0, 'a@x\n'), ran(128)]).behind).toBeUndefined()
    expect(factsOf(plan, [inside, MAIN, ran(0, '0\n'), ran(0, 'a@x\n'), undefined]).upstreamAuthors).toBeUndefined()
  })

  test('a detached HEAD names no branch, so the place is unknown', () => {
    const plan = planOf('rm -rf build')
    const facts = factsOf(plan, [ran(0, 'true\n/work/app\n\n.git/index\n'), ran(0, 'HEAD\n'), ran(0, ''), ran(0, ''), ran(0, '')])
    expect(facts.branch).toBeUndefined()
    expect(facts.top).toBeUndefined()
    expect(facts.hasCommits).toBe(true)
  })

  describe('a clean target', () => {
    const HERE = 'true\n/work/app\n\n.git/index\n'
    const entry = (path: string, size: number) => `${path}\n  ctime: 100:0\n  mtime: 100:250000000\n  dev: 1\tino: 2\n  uid: 1\tgid: 1\n  size: ${size}\tflags: 0\n`
    const plan = planOf('rm -rf src')
    const read = (untracked = '', ignored = '', debug = entry('src/a.txt', 5)) =>
      factsOf(plan, [ran(0, HERE), MAIN, ran(0, staged('src/a.txt')), ran(0, inHead('src/a.txt')), ran(0, untracked), ran(0, ignored), ran(0, debug)])
    const same = { kind: 'file' as const, size: 5, mtimeMs: 100_250, isLink: false }
    // the index file was written after every file under src last changed
    const statted = (facts: ReturnType<typeof read>, stat: typeof same | undefined, indexMs: number | undefined = 200_000) =>
      withModified(facts, new Map(statPathsOf(facts).map(path => [path, stat])), indexMs)

    test('the index entries under a target are read, and each is compared with the file by size and time', () => {
      expect(statPathsOf(read())).toEqual(['src/a.txt'])
      expect(statted(read(), same).modifiedIn).toEqual({ src: 0 })
      expect(statted(read(), { ...same, size: 6 }).modifiedIn).toEqual({ src: 1 })
      expect(statted(read(), { ...same, mtimeMs: 100_251 }).modifiedIn).toEqual({ src: 1 })
      expect(statted(read(), { ...same, isLink: true }).modifiedIn).toEqual({ src: 1 })
      expect(statted(read(), { ...same, kind: 'dir' as never }).modifiedIn).toEqual({ src: 1 })
      // a file the court cannot stat is unknown, never claimed changed
      expect(statted(read(), undefined).modifiedIn).toBeUndefined()
    })

    test('a target with more index entries than the court reads leaves its changes unknown', () => {
      const many = Array.from({ length: 201 }, (_, at) => entry(`src/f${at}`, 1)).join('')
      expect(statPathsOf(read('', '', many))).toEqual([])
      expect(statted(read('', '', many), same).modifiedIn).toBeUndefined()
    })

    test('changed files under a target are named as evidence', () => {
      expect(exhibitLinesOf({ isRepo: true, tracked: { src: true }, committed: { src: true }, untracked: { src: 0 }, ignoredIn: { src: 0 }, modifiedIn: { src: 2 } })).toEqual([
        'Exhibit A: src is tracked by git, so history keeps it.',
        'Exhibit B: src holds 2 files changed since git last recorded them, which history does not keep.',
      ])
    })
  })

  describe('what history keeps of a tracked target', () => {
    const HERE = ran(0, 'true\n/work/app\n\n.git/index\n')
    const debug = (path: string, flags = '0') => `${path}\n  ctime: 100:0\n  mtime: 100:250000000\n  dev: 1\tino: 2\n  uid: 1\tgid: 1\n  size: 5\tflags: ${flags}\n`
    const plan = planOf('rm -rf src')
    const read = ({ head = MAIN, index = staged('src/a'), tree = ran(0, inHead('src/a')), untracked = '', ignored = '', indexed = debug('src/a') } = {}) =>
      factsOf(plan, [HERE, head, ran(0, index), tree, ran(0, untracked), ran(0, ignored), ran(0, indexed)])

    test('a target is committed only when every index entry is in HEAD with the same mode and object', () => {
      expect(read().committed).toEqual({ src: true })
      // staged and never committed: an object HEAD does not hold, a mode it does not, a path it lacks
      expect(read({ index: `100644 ${'b'.repeat(40)} 0\tsrc/a\0` }).committed).toEqual({ src: false })
      expect(read({ index: `100755 ${OID} 0\tsrc/a\0` }).committed).toEqual({ src: false })
      expect(read({ index: staged('src/a', 'src/new'), indexed: debug('src/a') + debug('src/new') }).committed).toEqual({ src: false })
      // a file HEAD holds that the index no longer does is still in history
      expect(read({ tree: ran(0, inHead('src/a', 'src/gone')) }).committed).toEqual({ src: true })
    })

    test('an intent to add is never committed, even where HEAD holds the empty file it records', () => {
      const empty = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'
      const index = `100644 ${empty} 0\tsrc/a\0`
      const tree = ran(0, `100644 blob ${empty}\tsrc/a\0`)
      expect(read({ index, tree }).committed).toEqual({ src: true })
      expect(read({ index, tree, indexed: debug('src/a', '20004000') }).committed).toEqual({ src: false })
    })

    test('a gitlink, or a directory a listing names whole, is a nested repository', () => {
      expect(read().nested).toBeUndefined()
      expect(read({ index: `160000 ${OID} 0\tsrc\0`, tree: ran(0, `160000 commit ${OID}\tsrc\0`), indexed: debug('src') }).nested).toEqual({ src: true })
      expect(read({ untracked: 'src/inner/\nsrc/b\n' }).nested).toEqual({ src: true })
      expect(read({ ignored: 'src/wt/\n' }).nested).toEqual({ src: true })
      // git quotes a name with a quote or a control character, slash and all
      expect(read({ untracked: '"src/in\\"ner/"\n' }).nested).toEqual({ src: true })
      expect(read({ untracked: '"src/a\\"b"\n' }).nested).toBeUndefined()
      // a name with no trailing slash is a file
      expect(read({ untracked: 'src/b\nsrc/c.d\n' }).nested).toBeUndefined()
      const clean = planOf('git clean -fdx')
      expect(factsOf(clean, [HERE, MAIN, ran(0, 'a\nvendor/lib/\n'), ran(0, 'x.log\n')]).nested).toEqual({ '.': true })
    })

    test('a listing the court cannot read exactly leaves every target unknown', () => {
      // a merge conflict, a quoted or cut record, a tree entry of another type
      for (const index of [`100644 ${OID} 2\tsrc/a\0`, `100644 ${OID} 0 src/a\0`, `100644 ${OID.slice(1)} 0\tsrc/a\0`, 'src/a\n']) {
        expect(read({ index }).tracked, index).toBeUndefined()
      }
      for (const tree of [ran(0, `040000 tree ${OID}\tsrc\0`), ran(0, 'src/a\n'), ran(128), undefined]) {
        expect(factsOf(plan, [HERE, MAIN, ran(0, staged('src/a')), tree, ran(0, ''), ran(0, ''), ran(0, debug('src/a'))]).tracked).toBeUndefined()
      }
    })

    test('a branch with no commits is a repository whose HEAD lists nothing', () => {
      const facts = read({ head: ran(1), tree: ran(128) })
      expect(facts).toMatchObject({ isRepo: true, hasCommits: false, tracked: { src: true }, committed: { src: false } })
      // a HEAD that fails some other way says nothing about commits
      expect(read({ head: ran(128), tree: ran(128) }).hasCommits).toBeUndefined()
      expect(read({ head: ran(128), tree: ran(128) }).tracked).toBeUndefined()
      expect(read({ head: ran(1, 'main\n'), tree: ran(128) }).hasCommits).toBeUndefined()
    })

    test('history keeps a target only when it is committed, holds no nested repository and every change was counted', () => {
      const base = { isRepo: true, tracked: { src: true }, committed: { src: true }, untracked: { src: 0 }, ignoredIn: { src: 0 }, modifiedIn: { src: 0 } }
      expect(exhibitLinesOf(base)).toEqual(['Exhibit A: src is tracked by git, so history keeps it.'])
      expect(exhibitLinesOf({ ...base, committed: { src: false } })).toEqual([
        'Exhibit A: src is tracked by git, but not all of it is committed, so history does not keep all of it.',
      ])
      expect(exhibitLinesOf({ ...base, committed: undefined })).toEqual([
        'Exhibit A: src is tracked by git, but not all of it is committed, so history does not keep all of it.',
      ])
      // what a nested repository holds is never counted short
      expect(exhibitLinesOf({ ...base, nested: { src: true }, untracked: { src: 2 }, ignoredIn: { src: 3 }, modifiedIn: { src: 1 } })).toEqual([
        'Exhibit A: src is tracked by git, but holds a nested repository, whose contents were not checked.',
      ])
      expect(exhibitLinesOf({ isRepo: true, tracked: { vendor: false }, committed: { vendor: true }, untracked: { vendor: 2 }, ignoredIn: { vendor: 0 }, nested: { vendor: true } })).toEqual([
        'Exhibit A: vendor is not tracked by git, so history does not keep it.',
        'Exhibit B: vendor holds a nested repository, whose contents were not checked.',
      ])
      expect(exhibitLinesOf({ isRepo: true, untracked: { '.': 5 }, ignored: 9, nested: { '.': true } })).toEqual([
        'Exhibit A: the repository holds a nested repository, whose files were not counted.',
      ])
      expect(exhibitLinesOf({ ...base, hasCommits: false, committed: { src: false } })).toEqual([
        'Exhibit A: this repository has no commits on its current branch.',
        'Exhibit B: src is tracked by git, but not all of it is committed, so history does not keep all of it.',
      ])
    })

    test('the nested and committed state go with every other target fact', () => {
      expect(withoutTargets({ ...read(), nested: { src: true } })).toEqual({ isRepo: true, hasCommits: true, top: '/work/app', prefix: '', branch: 'main', indexPath: '.git/index' })
    })
  })

  describe('a target behind a symbolic link', () => {
    test('a target is plain only when it lands where its spelling says, from the real working directory', () => {
      expect(isLexicalPath('/work/app', 'src', '/work/app/src')).toBe(true)
      expect(isLexicalPath('/work/app', './src/../src', '/work/app/src')).toBe(true)
      expect(isLexicalPath('/work/app', '/work/app/src', '/work/app/src')).toBe(true)
      expect(isLexicalPath('/work/app', '-x', '/work/app/-x')).toBe(true)
      expect(isLexicalPath('/work/app', '../lib', '/work/lib')).toBe(true)
      expect(isLexicalPath('/work/app', 'cache/data', '/work/scratch/data')).toBe(false)
      expect(isLexicalPath('/work/app', 'link', '/elsewhere')).toBe(false)
      expect(isLexicalPath('/work/app', 'src', undefined)).toBe(false)
    })

    test('the targets a plan reads are the ones checked, and an unplain one removes every target fact', () => {
      const plan = planOf('rm -rf src cache/data')
      expect(targetsIn(plan)).toEqual(['src', 'cache/data'])
      expect(targetsIn(planOf('git push --force origin main'))).toEqual([])
      const facts = {
        isRepo: true, top: '/work/app', prefix: '', branch: 'main',
        tracked: { src: true }, untracked: { src: 0 }, ignoredIn: { src: 0 }, indexed: { src: [] }, modifiedIn: { src: 0 },
      }
      expect(withoutTargets(facts)).toEqual({ isRepo: true, top: '/work/app', prefix: '', branch: 'main' })
    })
  })

  describe('the names a target passes through', () => {
    test('each name is checked in the directory that must list it by that spelling', () => {
      expect(namesAlong('src', undefined)).toEqual([{ dir: '.', name: 'src' }])
      expect(namesAlong('./src//a', undefined)).toEqual([{ dir: '.', name: 'src' }, { dir: 'src', name: 'a' }])
      expect(namesAlong('/work/app/src/a', '/work/app')).toEqual([{ dir: '/work/app', name: 'src' }, { dir: '/work/app/src', name: 'a' }])
      expect(namesAlong('/r', '/')).toEqual([{ dir: '/', name: 'r' }])
    })

    test('the working directory, the top level, an ancestor of it or a path elsewhere has none', () => {
      const none: [string, string | undefined][] = [
        ['.', '/work/app'], ['./.', '/work/app'], ['/work/app', '/work/app'], ['/work/app/./', '/work/app'], ['/work', '/work/app'],
        ['/', '/work/app'], ['/work/application/src', '/work/app'], ['/work/other/src', '/work/app'], ['/work/app/src', undefined],
      ]
      for (const [target, top] of none) {
        expect(namesAlong(target, top), target).toBeUndefined()
      }
    })
  })

  describe('reading the index entries strictly', () => {
    const HERE = 'true\n/work/app\n\n.git/index\n'
    const stats = (path: string) => `${path}\n  ctime: 100:0\n  mtime: 100:250000000\n  dev: 1\tino: 2\n  uid: 1\tgid: 1\n  size: 5\tflags: 0\n`
    const plan = planOf('rm -rf src')
    const read = (debug: string | undefined) =>
      factsOf(plan, [ran(0, HERE), MAIN, ran(0, staged('src/a')), ran(0, inHead('src/a')), ran(0, ''), ran(0, ''), debug === undefined ? ran(128) : ran(0, debug)])

    test('every per-target read is required: a failed index read leaves every target fact unknown', () => {
      expect(read(undefined).tracked).toBeUndefined()
      expect(read(stats('src/a.txt')).tracked).toEqual({ src: true })
      // a per-target kind the reader does not know is unread, never skipped
      const unknown = [...plan, { kind: 'authors' as const, argv: ['git'], target: 'src' }]
      expect(factsOf(unknown, [ran(0, HERE), MAIN, ran(0, staged('src/a')), ran(0, inHead('src/a')), ran(0, ''), ran(0, ''), ran(0, stats('src/a.txt')), ran(0, 'x@y\n')]).tracked).toBeUndefined()
    })

    test('the index read keeps names raw and refuses what it cannot read exactly', () => {
      expect(plan.find(query => query.kind === 'indexed')?.argv).toContain('core.quotePath=false')
      expect(read(stats('src/spéc.txt')).indexed).toEqual({ src: [{ path: 'src/spéc.txt', size: 5, mtimeMs: 100_250 }] })
      expect(read(stats('"src/new\\nline.txt"')).tracked).toBeUndefined()
      expect(read(stats('"src/qu\\"ote.txt"')).tracked).toBeUndefined()
      expect(read('  mtime: 1:0\n').tracked).toBeUndefined()
      // a whole block whose path line is indented, or whose ctime line is malformed
      expect(read(stats('  src/a.txt')).tracked).toBeUndefined()
      expect(read(stats('src/a.txt').replace('ctime: 100:0', 'ctime: soon')).tracked).toBeUndefined()
      expect(read(`${stats('src/a.txt')}src/b.txt\n`).tracked).toBeUndefined()
      expect(read('src/a.txt\n  ctime: 100:0\n  mtime: 100:250000000\n  dev: 1\tino: 2\n  uid: 1\tgid: 1\n').tracked).toBeUndefined()
      expect(read(stats('src/a.txt').replace('  size: 5', '  size: five')).tracked).toBeUndefined()
      expect(read('').indexed).toEqual({ src: [] })
    })

    test('the index file is located with the first query', () => {
      expect(read(stats('src/a.txt')).indexPath).toBe('.git/index')
    })

    test('a file not strictly older than the index is racily clean: its target is unknown', () => {
      const facts = read(stats('src/a.txt'))
      const same = { kind: 'file' as const, size: 5, mtimeMs: 100_250, isLink: false }
      const counted = (indexMs: number | undefined, stat = same) => withModified(facts, new Map([['src/a.txt', stat]]), indexMs).modifiedIn
      expect(counted(200_000)).toEqual({ src: 0 })
      expect(counted(100_250)).toBeUndefined()
      expect(counted(100_100)).toBeUndefined()
      expect(counted(undefined)).toBeUndefined()
      // an edit after the index was written keeps size and second: still unknown, never unchanged
      expect(counted(100_250, { ...same, mtimeMs: 100_900 })).toBeUndefined()
      expect(withModified(read(''), new Map(), undefined).modifiedIn).toEqual({ src: 0 })
    })
  })
})

