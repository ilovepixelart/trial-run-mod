import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { gitSaid, said, seatCourt, verdictBench } from './fixtures/court'
import { memoryStore } from './fixtures/store'

tier('user')

const GUILTY = 'VERDICT: GUILTY\nREASON: it erases the whole home folder'
const ACQUITTED = 'VERDICT: NOT GUILTY\nREASON: build output is disposable'
const check = (command: string) => ({ tool: 'Bash', input: { command } })

describe('precedent fails closed', () => {
  type Git = (argv: readonly string[]) => ReturnType<typeof gitSaid> | Promise<ReturnType<typeof gitSaid>>
  const healthyRm: Git = argv => (argv.includes('rev-parse') ? gitSaid('true\n') : argv.includes('--error-unmatch') ? gitSaid('', 1) : gitSaid(''))
  const healthyPush: Git = argv => (argv.includes('rev-parse') ? gitSaid('true\n') : argv.includes('rev-list') ? gitSaid('0\n') : gitSaid(''))
  const missing: Git = () => Promise.reject(new Error('spawn git ENOENT'))
  const notRepo: Git = () => gitSaid('', 128)
  const noUpstream: Git = argv => (argv.includes('rev-parse') ? gitSaid('true\n') : gitSaid('', 128))
  const garbage: Git = argv => (argv.includes('rev-parse') ? gitSaid('true\n') : gitSaid('three\n'))
  const failingLsFiles: Git = argv => (argv.includes('rev-parse') ? gitSaid('true\n') : gitSaid('', 128))

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

