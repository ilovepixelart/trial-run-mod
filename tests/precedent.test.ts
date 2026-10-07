import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { gitSaid, said, seatCourt, verdictBench } from './fixtures/court'
import { memoryStore } from './fixtures/store'

tier('user')

const GUILTY = 'VERDICT: GUILTY\nREASON: it erases the whole home folder'
const ACQUITTED = 'VERDICT: NOT GUILTY\nREASON: build output is disposable'
const check = (command: string) => ({ tool: 'Bash', input: { command } })

/**
 * What the first query prints in /work/app on main: inside, the top level,
 * the directory within it (none) and the branch.
 */
const HERE = 'true\n/work/app\n\nmain\n'

describe('precedent fails closed', () => {
  type Git = (argv: readonly string[]) => ReturnType<typeof gitSaid> | Promise<ReturnType<typeof gitSaid>>
  const healthyRm: Git = argv => (argv.includes('rev-parse') ? gitSaid(HERE) : argv.includes('--error-unmatch') ? gitSaid('', 1) : gitSaid(''))
  const healthyPush: Git = argv =>
    argv.includes('rev-parse') ? gitSaid(HERE) : argv.includes('rev-list') ? gitSaid('0\n') : argv.includes('config') ? gitSaid('', 1) : gitSaid('')
  const missing: Git = () => Promise.reject(new Error('spawn git ENOENT'))
  const notRepo: Git = () => gitSaid('', 128)
  const noUpstream: Git = argv => (argv.includes('rev-parse') ? gitSaid(HERE) : gitSaid('', 128))
  const garbage: Git = argv => (argv.includes('rev-parse') ? gitSaid(HERE) : gitSaid('three\n'))
  const failingLsFiles: Git = argv => (argv.includes('rev-parse') ? gitSaid(HERE) : gitSaid('', 128))

  const cases: [string, string, Git, Git][] = [
    ['git missing now', 'rm -rf build', healthyRm, missing],
    ['git missing both times', 'rm -rf build', missing, missing],
    ['not a repository', 'rm -rf build', healthyRm, notRepo],
    ['ls-files exits non-zero', 'rm -rf build', healthyRm, failingLsFiles],
    ['no upstream', 'git push --force origin main', healthyPush, noUpstream],
    ['no upstream both times', 'git push --force origin main', noUpstream, noUpstream],
    ['garbage count', 'git push --force origin main', healthyPush, garbage],
    ['a charge with no material facts', 'terraform destroy', healthyRm, healthyRm],
  ]
  for (const [name, command, first, second] of cases) {
    test(`${name}: the repeat goes to trial and cites no precedent`, async ($, on) => {
      mock.clock(on)
      const saved = memoryStore(on)
      let git = first
      const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: argv => git(argv), root: () => '/work/app' })

      await $.tool.check(check(command))
      git = second
      await $.tool.check(check(command))

      expect(seen.calls).toHaveLength(6)
      const filed = saved.get('cases') as { precedent?: number }[]
      expect(filed.map(one => one.precedent)).toEqual([undefined, undefined])
    })
  }

  test('a git that times out leaves the repeat to trial', async ($, on) => {
    const clock = mock.clock(on)
    memoryStore(on)
    let slow = false
    const seen = seatCourt(on, {
      ...verdictBench(ACQUITTED),
      git: async argv => {
        if (slow) {
          await clock.sleep(60_000)
        }
        return healthyRm(argv)
      },
      root: () => '/work/app',
    })

    await $.tool.check(check('rm -rf build'))
    slow = true
    const pending = $.tool.check(check('rm -rf build'))
    await clock.advance(500)
    await clock.advance(9_000)
    await pending

    expect(seen.calls).toHaveLength(6)
  })

  test('a stored acquittal whose facts are null binds nothing', async ($, on) => {
    mock.clock(on)
    memoryStore(on, {
      layout: 2,
      cases: [{ number: 1, command: 'rm -rf build', charge: 'recursive delete', verdict: 'acquitted', at: 1, root: '/work/app', facts: null }],
    })
    const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: healthyRm, root: () => '/work/app' })

    await $.tool.check(check('rm -rf build'))

    expect(seen.calls).toHaveLength(3)
  })

  test('a conviction whose facts were unknown still overturns an earlier acquittal', async ($, on) => {
    mock.clock(on)
    memoryStore(on)
    on('classic.SessionStart', () => ({}))
    let git: Git = healthyRm
    let judge = ACQUITTED
    const seen = seatCourt(on, {
      reply: role => said(role === 'judge' ? judge : 'Speech.'),
      git: argv => git(argv),
      root: () => '/work/app',
    })

    await $.tool.check(check('rm -rf build'))
    git = missing
    judge = GUILTY
    await $.tool.check(check('rm -rf build'))
    await $.classic.SessionStart({ source: 'clear' })
    git = healthyRm
    await $.tool.check(check('rm -rf build'))

    expect(seen.calls).toHaveLength(9)
  })

  test('the healthy repeat still binds precedent with no model call', async ($, on) => {
    mock.clock(on)
    memoryStore(on)
    const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: healthyRm, root: () => '/work/app' })

    await $.tool.check(check('rm -rf build'))
    await $.tool.check(check('rm -rf build'))

    expect(seen.calls).toHaveLength(3)
  })
})

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
    test(`${command}: tried every time, no exhibit, no precedent`, async ($, on) => {
      mock.clock(on)
      const saved = memoryStore(on)
      const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: reassuring, root: () => '/work/app' })

      await $.tool.check(check(command))
      await $.tool.check(check(command))

      expect(seen.calls).toHaveLength(6)
      for (const role of ['prosecutor', 'defense', 'judge'] as const) {
        expect(seen.prompts[role], role).not.toContain('<exhibit>')
      }
      expect((saved.get('cases') as { precedent?: number }[]).map(one => one.precedent)).toEqual([undefined, undefined])
    })
  }

  test('a plain target, a path after --, and a push naming its branch keep their exhibits', async ($, on) => {
    mock.clock(on)
    memoryStore(on)
    const seen = seatCourt(on, { ...verdictBench(GUILTY), git: reassuring, root: () => '/work/app' })

    await $.tool.check(check('rm -rf node_modules'))
    expect(seen.prompts.judge).toContain('<exhibit>Exhibit A: node_modules is tracked by git, so history keeps it.</exhibit>')
    await $.tool.check(check('rm -rf -- -x'))
    expect(seen.prompts.judge).toContain('<exhibit>Exhibit A: -x is tracked by git, so history keeps it.</exhibit>')
    await $.tool.check(check('git push --force origin main'))
    expect(seen.prompts.judge).toContain('<exhibit>Exhibit A: the upstream branch has no commits this branch lacks.</exhibit>')
  })
})

describe('the world changes between two identical commands', () => {
  type World = { top: string; prefix: string; branch: string; isTracked: boolean; behind: number }
  const start: World = { top: '/work/app', prefix: '', branch: 'main', isTracked: false, behind: 0 }
  const gitIn = (world: () => World) => (argv: readonly string[]) => {
    const now = world()
    if (argv.includes('rev-parse')) {
      return gitSaid(`true\n${now.top}\n${now.prefix}\n${now.branch}\n`)
    }
    if (argv.includes('--error-unmatch')) {
      return now.isTracked ? gitSaid('build/out.txt\n') : gitSaid('', 1)
    }
    if (argv.includes('rev-list')) {
      return gitSaid(`${now.behind}\n`)
    }
    return argv.includes('config') ? gitSaid('', 1) : gitSaid('')
  }

  const changes: [string, string, Partial<World>][] = [
    ['the file becomes tracked', 'rm -rf build', { isTracked: true }],
    ['the shell is in another repository', 'rm -rf build', { top: '/work/other' }],
    ['the shell is in a subdirectory of the same repository', 'rm -rf build', { prefix: 'packages/web/' }],
    ['the branch switches', 'rm -rf build', { branch: 'release' }],
    ['the upstream gains a commit', 'git push --force origin main', { behind: 1 }],
    ['the branch switches before a push', 'git push --force origin main', { branch: 'release' }],
  ]
  for (const [name, command, change] of changes) {
    test(`${name}: the second ${command} goes to trial`, async ($, on) => {
      mock.clock(on)
      const saved = memoryStore(on)
      let world = start
      const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: gitIn(() => world), root: () => '/work/app' })

      await $.tool.check(check(command))
      world = { ...start, ...change }
      await $.tool.check(check(command))

      expect(seen.calls).toHaveLength(6)
      expect((saved.get('cases') as { precedent?: number }[]).map(one => one.precedent)).toEqual([undefined, undefined])
    })
  }

  for (const command of ['rm -rf build', 'git push --force origin main']) {
    test(`nothing changed: the second ${command} follows precedent`, async ($, on) => {
      mock.clock(on)
      memoryStore(on)
      const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: gitIn(() => start), root: () => '/work/app' })

      await $.tool.check(check(command))
      await $.tool.check(check(command))

      expect(seen.calls).toHaveLength(3)
    })
  }

  test('a detached HEAD never follows precedent', async ($, on) => {
    mock.clock(on)
    memoryStore(on)
    const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: gitIn(() => ({ ...start, branch: 'HEAD' })), root: () => '/work/app' })

    await $.tool.check(check('rm -rf build'))
    await $.tool.check(check('rm -rf build'))

    expect(seen.calls).toHaveLength(6)
  })

  test('a stored case without its place binds nothing, even where the place is unread now too', async ($, on) => {
    mock.clock(on)
    memoryStore(on, {
      layout: 2,
      cases: [
        { number: 1, command: 'rm -rf build', charge: 'recursive delete', verdict: 'acquitted', at: 1, root: '/work/app', facts: { tracked: { build: false } } },
      ],
    })
    const unplaced = (argv: readonly string[]) => (argv.includes('rev-parse') ? gitSaid('true\n') : gitIn(() => start)(argv))
    const seen = seatCourt(on, { ...verdictBench(ACQUITTED), git: unplaced, root: () => '/work/app' })

    await $.tool.check(check('rm -rf build'))

    expect(seen.calls).toHaveLength(3)
  })
})

