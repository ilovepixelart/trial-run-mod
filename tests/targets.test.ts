import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { gitSaid, plainStat, seatCourt, verdictBench } from './fixtures/court'
import { memoryStore } from './fixtures/store'

tier('user')

const GUILTY = 'VERDICT: GUILTY\nREASON: it erases the whole home folder'
const ACQUITTED = 'VERDICT: NOT GUILTY\nREASON: build output is disposable'
const check = (command: string) => ({ tool: 'Bash', input: { command } })

/**
 * What the first query prints in /work/app on main: inside, the top level,
 * the directory within it (none) and the branch.
 */
const HERE = 'true\n/work/app\n\nmain\n.git/index\n'

describe('targets the shell reads differently', () => {
  // git that calls every path tracked: the reassuring answer, were it asked
  const reassuring = (argv: readonly string[]) =>
    argv.includes('rev-parse')
      ? gitSaid(HERE)
      : argv.includes('rev-list')
        ? gitSaid('0\n')
        : argv.includes('--error-unmatch')
          ? gitSaid('x\n')
          : argv.includes('config')
            ? gitSaid('', 1)
            : gitSaid('')

  for (const command of [
    'rm -rf "build" src',
    'rm -rf build\\ src',
    'rm -rf ~/x',
    'rm -rf $HOME',
    'rm -rf {dist,src}',
    'rm -rf src/*',
    'rm -rf a b c d',
    'rm -rf build/',
    'cd app && rm -rf build',
    'git push --force origin HEAD:main',
    'git push --force',
    'git -C ../other push --force origin main',
  ]) {
    test(`${command}: tried, with no exhibit`, async ($, on) => {
      mock.clock(on)
      memoryStore(on)
      const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: reassuring })

      await $.tool.check(check(command))

      expect(seen.calls).toHaveLength(3)
      for (const role of ['prosecutor', 'defense', 'judge'] as const) {
        expect(seen.prompts[role], role).not.toContain('<exhibit>')
      }
    })
  }

  test('a plain target, a path after --, and a push naming its branch keep their exhibits', async ($, on) => {
    mock.clock(on)
    memoryStore(on)
    const seen = seatCourt(on, { ...verdictBench(GUILTY), git: reassuring })

    await $.tool.check(check('rm -rf node_modules'))
    expect(seen.prompts.judge).toContain('<exhibit>Exhibit A: node_modules is tracked by git, so history keeps it.</exhibit>')
    await $.tool.check(check('rm -rf -- -x'))
    expect(seen.prompts.judge).toContain('<exhibit>Exhibit A: -x is tracked by git, so history keeps it.</exhibit>')
    await $.tool.check(check('git push --force origin main'))
    expect(seen.prompts.judge).toContain('<exhibit>Exhibit A: the upstream branch has no commits this branch lacks, as of the last fetch.</exhibit>')
  })
})

describe('work under a tracked target', () => {
  type Tree = { untracked: string; ignored: string; size: number }
  // the index file was written after every file under src last changed
  const fileAt = (path: string, size: number) => ({
    kind: 'file' as const, size, mtimeMs: path.endsWith('/.git/index') ? 200_000 : 100_250, isLink: false,
  })
  const clean: Tree = { untracked: '', ignored: '', size: 5 }
  const treeGit = (tree: () => Tree) => (argv: readonly string[]) => {
    if (argv.includes('rev-parse')) {
      return gitSaid(HERE)
    }
    if (argv.includes('--error-unmatch')) {
      return gitSaid('src/a.txt\n')
    }
    if (argv.includes('--debug')) {
      return gitSaid('src/a.txt\n  ctime: 100:0\n  mtime: 100:250000000\n  dev: 1\tino: 2\n  uid: 1\tgid: 1\n  size: 5\tflags: 0\n')
    }
    if (argv.includes('--ignored')) {
      return gitSaid(tree().ignored)
    }
    return gitSaid(argv.includes('--others') ? tree().untracked : '')
  }
  const NOT_CHECKED = '<exhibit>Exhibit A: src is tracked by git, so history keeps its last commit; uncommitted changes under it were not checked.</exhibit>'

  const changes: [string, Partial<Tree>, string][] = [
    ['an untracked file under it', { untracked: 'src/precious-new.ts\n' }, 'src holds 1 untracked file.'],
    ['a tracked file under it with uncommitted edits', { size: 17 }, 'src holds 1 file changed since git last recorded them, which history does not keep.'],
    ['an ignored file under it', { ignored: 'src/prod.env\n' }, 'src holds 1 ignored file, which history does not keep.'],
  ]
  for (const [name, change, line] of changes) {
    test(`${name} is entered as an exhibit`, async ($, on) => {
      mock.clock(on)
      memoryStore(on)
      const tree = { ...clean, ...change }
      const fs = (path: string, resolve: boolean) => plainStat(path, resolve, fileAt(path, tree.size))
      const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: treeGit(() => tree), fs })

      await $.tool.check(check('rm -rf src'))

      expect(seen.prompts.judge).toContain(`<exhibit>Exhibit B: ${line}</exhibit>`)
    })
  }

  test('a file as new as the index is racily clean: its changes are not checked', async ($, on) => {
    mock.clock(on)
    memoryStore(on)
    const racy = (path: string, resolve: boolean) => plainStat(path, resolve, { kind: 'file', size: 5, mtimeMs: 100_250, isLink: false })
    const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: treeGit(() => clean), fs: racy })

    await $.tool.check(check('rm -rf src'))

    expect(seen.prompts.judge).toContain(NOT_CHECKED)
    expect(seen.prompts.judge).not.toContain('so history keeps it.')
  })

  test('an index file the court cannot stat leaves the changes not checked', async ($, on) => {
    mock.clock(on)
    memoryStore(on)
    const fs = (path: string, resolve: boolean) => (path.endsWith('/.git/index') ? undefined : plainStat(path, resolve, fileAt(path, 5)))
    const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: treeGit(() => clean), fs })

    await $.tool.check(check('rm -rf src'))

    expect(seen.prompts.judge).toContain(NOT_CHECKED)
  })

  test('a file the court cannot stat leaves the changes not checked', async ($, on) => {
    mock.clock(on)
    memoryStore(on)
    // the targets resolve, but no tracked file under them will stat
    const fs = (path: string, resolve: boolean) => (resolve ? plainStat(path, resolve) : undefined)
    const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: treeGit(() => clean), fs })

    await $.tool.check(check('rm -rf src'))

    expect(seen.prompts.judge).toContain(NOT_CHECKED)
  })

  describe('a target git reads elsewhere than rm deletes', () => {
    // $.fs.stat as Bun's realpath answers it: `..` folded by spelling
    const folded = (path: string) => {
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
    const realFs = (path: string, resolve: boolean) => plainStat(resolve ? folded(path) : path, resolve, fileAt(path, 5))
    // git that matches spellings exactly: only `src` is tracked, and only it holds a.txt
    const exactGit = (argv: readonly string[]) => {
      const target = argv.at(-1)
      if (argv.includes('rev-parse')) {
        return gitSaid(HERE)
      }
      if (argv.includes('--error-unmatch')) {
        return target === 'src' ? gitSaid('src/a.txt\n') : gitSaid('', 1)
      }
      return argv.includes('--debug') && target === 'src'
        ? gitSaid('src/a.txt\n  ctime: 100:0\n  mtime: 100:250000000\n  dev: 1\tino: 2\n  uid: 1\tgid: 1\n  size: 5\tflags: 0\n')
        : gitSaid('')
    }
    // a case-insensitive file system: any spelling opens src and keeps its
    // own spelling in realPath, but the directory lists it as src
    const caseless = (path: string) => (path.toLowerCase().endsWith('/src') ? ['a.txt'] : ['src', '.git'])
    const attacks: [string, string, (argv: readonly string[]) => ReturnType<typeof gitSaid>][] = [
      // git reads the repository's src; the kernel follows lnk, then `..`
      ['a .. part', 'rm -rf lnk/../src', treeGit(() => clean)],
      ['the repository store', 'rm -rf .git', exactGit],
      ['inside the repository store', 'rm -rf .git/refs', exactGit],
      ['the repository store beside a plain target', 'rm -rf src .git', treeGit(() => clean)],
      ['the top level by its absolute path', 'rm -rf /work/app', treeGit(() => clean)],
      ['an ancestor of the top level', 'rm -rf /work', treeGit(() => clean)],
      ['the working directory at the top level', 'rm -rf .', treeGit(() => clean)],
      ['a case alias of a tracked folder', 'rm -rf SRC', exactGit],
      ['a case alias of the repository store', 'rm -rf .GIT', exactGit],
    ]
    for (const [name, command, git] of attacks) {
      test(`${name} (${command}): no exhibit about it`, async ($, on) => {
        mock.clock(on)
        memoryStore(on)
        const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git, fs: realFs, list: caseless })

        await $.tool.check(check(command))

        expect(seen.calls).toHaveLength(3)
        expect(seen.prompts.judge).not.toContain('<exhibit>')
      })
    }

    for (const command of ['rm -rf src', 'rm -rf ./src', 'rm -rf /work/app/src']) {
      test(`${command}, spelled as listed, keeps its exhibit`, async ($, on) => {
        mock.clock(on)
        memoryStore(on)
        const listing = (path: string) => (path.toLowerCase().endsWith('/src') ? ['a.txt'] : ['src', '.git'])
        const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: treeGit(() => clean), fs: realFs, list: listing })

        await $.tool.check(check(command))

        expect(seen.prompts.judge).toContain(`<exhibit>Exhibit A: ${command.slice(7)} is tracked by git, so history keeps it.</exhibit>`)
      })
    }

    test('a directory that will not list leaves the target unknown', async ($, on) => {
      mock.clock(on)
      memoryStore(on)
      const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: treeGit(() => clean), fs: realFs, list: () => undefined })

      await $.tool.check(check('rm -rf src'))

      expect(seen.calls).toHaveLength(3)
      expect(seen.prompts.judge).not.toContain('<exhibit>')
    })
  })
})

describe('a target behind a symbolic link', () => {
  // cache is an untracked link: git reads nothing under it, wherever it points
  const linkedGit = (argv: readonly string[]) =>
    argv.includes('rev-parse') ? gitSaid(HERE) : argv.includes('--error-unmatch') ? gitSaid('', 1) : gitSaid('')
  const linked = (pointsAt: () => string) => (path: string, resolve: boolean) =>
    path.includes('/cache/') && resolve
      ? { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, realPath: `${pointsAt()}/${path.slice(path.indexOf('/cache/') + 7)}` }
      : plainStat(path, resolve)

  test('a target through a link: no exhibit about it', async ($, on) => {
    mock.clock(on)
    memoryStore(on)
    const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: linkedGit, fs: linked(() => '/home/me/thesis') })

    await $.tool.check(check('rm -rf cache/data'))

    expect(seen.calls).toHaveLength(3)
    expect(seen.prompts.judge).not.toContain('<exhibit>')
  })

  test('a target the court cannot resolve is unknown: no exhibit about it', async ($, on) => {
    mock.clock(on)
    memoryStore(on)
    const fs = (path: string, resolve: boolean) => (path.endsWith('/build') ? undefined : plainStat(path, resolve))
    const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: linkedGit, fs })

    await $.tool.check(check('rm -rf build'))

    expect(seen.calls).toHaveLength(3)
    expect(seen.prompts.judge).not.toContain('<exhibit>')
  })

  test('a plain target beside a link keeps its exhibit', async ($, on) => {
    mock.clock(on)
    memoryStore(on)
    const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: linkedGit, fs: linked(() => '/work/scratch') })

    await $.tool.check(check('rm -rf build'))

    expect(seen.prompts.judge).toContain('<exhibit>Exhibit A: build is not tracked by git, so history does not keep it.</exhibit>')
  })
})
