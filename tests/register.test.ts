import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { refused, said, seatCourt, verdictBench } from './fixtures/court'

tier('user')

const GUILTY = 'VERDICT: GUILTY\nREASON: it erases the whole home folder'
const ACQUITTED = 'VERDICT: NOT GUILTY\nREASON: only a build folder'

const check = (command: string) => ({ tool: 'Bash', input: { command } })

describe('register', () => {
  test('an ordinary command passes untouched, with no trial', async ($, on) => {
    const seen = seatCourt(on, verdictBench(GUILTY, { decision: 'ask', reason: 'mode' }))

    for (const command of ['ls', 'git status', 'rm file.txt', 'git push']) {
      expect(await $.tool.check(check(command))).toEqual({ decision: 'ask', reason: 'mode' })
    }
    expect(seen.calls).toEqual([])
    expect(seen.opened).toEqual([])
  })

  test('other tools pass untouched', async ($, on) => {
    const seen = seatCourt(on, verdictBench(GUILTY))

    expect(await $.tool.check({ tool: 'Read', input: { file_path: 'rm -rf' } })).toEqual({
      decision: 'allow',
    })
    expect(seen.calls).toEqual([])
  })

  test('a risky command is tried by all three and denied when guilty', async ($, on) => {
    const seen = seatCourt(on, verdictBench(GUILTY))

    const verdict = await $.tool.check(check('rm -rf ~'))

    expect(verdict.decision).toBe('deny')
    expect(verdict.reason).toContain('it erases the whole home folder')
    expect([...seen.calls].sort()).toEqual(['defense', 'judge', 'prosecutor'])
    expect(seen.opened).toEqual(['trial-run-court'])
  })

  test('an acquittal hands back the session rules', async ($, on) => {
    seatCourt(on, verdictBench(ACQUITTED, { decision: 'ask', reason: 'default mode' }))

    expect(await $.tool.check(check('rm -rf build'))).toEqual({
      decision: 'ask',
      reason: 'default mode',
    })
  })

  test('a malformed verdict is a mistrial that asks the person', async ($, on) => {
    seatCourt(on, verdictBench('Sure, go ahead.'))

    expect((await $.tool.check(check('git push --force'))).decision).toBe('ask')
  })

  test('a model error is a mistrial that asks the person', async ($, on) => {
    seatCourt(on, { reply: role => (role === 'judge' ? refused : said('words')) })

    expect((await $.tool.check(check('git reset --hard'))).decision).toBe('ask')
  })

  test('a model call that throws is a mistrial that asks the person', async ($, on) => {
    seatCourt(on, {
      reply: () => {
        throw new Error('boom')
      },
    })

    expect((await $.tool.check(check('terraform destroy'))).decision).toBe('ask')
  })

  test('a court that runs out of time asks the person', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, {
      reply: async () => {
        await clock.sleep(60_000)
        return said(GUILTY)
      },
    })

    const pending = $.tool.check(check('kubectl delete ns prod'))
    await clock.settle()
    await clock.advance(9_000)

    expect((await pending).decision).toBe('ask')
  })

  test('a mistrial never loosens a deny from the rules', async ($, on) => {
    seatCourt(on, { reply: () => refused, beneath: { decision: 'deny', reason: 'rule' } })

    expect(await $.tool.check(check('rm -rf /'))).toEqual({ decision: 'deny', reason: 'rule' })
  })
})
