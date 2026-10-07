import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { said, seatCourt, verdictBench } from './fixtures/court'
import { memoryStore } from './fixtures/store'

tier('user')

const GUILTY = 'VERDICT: GUILTY\nREASON: it erases the whole home folder'
const ACQUITTED = 'VERDICT: NOT GUILTY\nREASON: node_modules is reinstalled by npm install'
const check = (command: string) => ({ tool: 'Bash', input: { command } })

/**
 * A bench whose judge rules each trial in turn from `rulings`, the last
 * one standing for every trial after.
 */
const rulingsBench = (rulings: string[]) => {
  let heard = 0
  return {
    reply: (role: 'prosecutor' | 'defense' | 'judge') => {
      if (role !== 'judge') {
        return verdictBench(GUILTY).reply(role)
      }
      heard += 1
      return said(rulings[Math.min(heard, rulings.length) - 1] ?? GUILTY)
    },
  }
}

describe('appeal', () => {
  const court = (args: string) => ({
    command: 'court',
    args,
    origin: { kind: 'composer' as const },
    presentation: { isFullscreen: true, columns: 160 },
  })

  test('an upheld appeal is filed marked appeal and lifts contempt for that command', async ($, on) => {
    mock.clock(on)
    const saved = memoryStore(on)
    const seen = seatCourt(on, rulingsBench([GUILTY, ACQUITTED]))
    await $.tool.check(check('git push --force origin main'))

    const appealed = await $.command.run(court('appeal I own origin, it is a scratch repo'))

    expect(appealed.text).toMatch(/^Appeal of case #0001 upheld: NOT GUILTY\. /)
    expect(seen.prompts.judge).toContain('<person>I own origin, it is a scratch repo</person>')
    expect(seen.prompts.judge).toContain('<command>git push --force origin main</command>')
    const filed = saved.get('cases') as { number: number; verdict: string; appeal?: number; command: string }[]
    expect(filed.map(one => [one.number, one.verdict, one.appeal, one.command])).toEqual([
      [1, 'guilty', undefined, 'git push --force origin main'],
      [2, 'acquitted', 1, 'git push --force origin main'],
    ])
    const retried = await $.tool.check(check('git push --force origin main'))
    expect(seen.calls).toHaveLength(9)
    expect(retried.reason ?? '').not.toMatch(/Contempt/)
  })

  test('a denied appeal is filed marked appeal and contempt stands', async ($, on) => {
    mock.clock(on)
    const saved = memoryStore(on)
    const seen = seatCourt(on, rulingsBench([GUILTY]))
    await $.tool.check(check('git push --force origin main'))

    const appealed = await $.command.run(court('appeal it is fine'))

    expect(appealed.text).toMatch(/^Appeal of case #0001 denied: GUILTY\. /)
    const filed = saved.get('cases') as { verdict: string; appeal?: number }[]
    expect(filed.map(one => [one.verdict, one.appeal])).toEqual([['guilty', undefined], ['guilty', 1]])
    const retried = await $.tool.check(check('git push --force origin main'))
    expect(seen.calls).toHaveLength(6)
    expect(retried.decision).toBe('deny')
    expect(retried.reason).toMatch(/case #0002/)
  })

  test('nothing to appeal says so, calls no model and files nothing', async ($, on) => {
    mock.clock(on)
    const saved = memoryStore(on)
    const seen = seatCourt(on, rulingsBench([ACQUITTED]))
    await $.tool.check(check('rm -rf dist'))

    const appealed = await $.command.run(court('appeal please'))

    expect(appealed.text).toBe('There is no conviction to appeal.')
    expect(seen.calls).toHaveLength(3)
    expect(saved.get('cases') as unknown[]).toHaveLength(1)
  })

  test('an appeal without context asks what the court missed and files nothing', async ($, on) => {
    mock.clock(on)
    const saved = memoryStore(on)
    const seen = seatCourt(on, rulingsBench([GUILTY]))
    await $.tool.check(check('git push --force origin main'))

    const appealed = await $.command.run(court('appeal  '))

    expect(appealed.text).toBe('Tell the court what it missed: /court appeal <context>.')
    expect(seen.calls).toHaveLength(3)
    expect(saved.get('cases') as unknown[]).toHaveLength(1)
  })

  test('/clear leaves nothing to appeal, as it forgives contempt', async ($, on) => {
    mock.clock(on)
    memoryStore(on)
    on('classic.SessionStart', () => ({}))
    const seen = seatCourt(on, rulingsBench([GUILTY]))
    await $.tool.check(check('git push --force origin main'))
    await $.classic.SessionStart({ source: 'clear' })

    const appealed = await $.command.run(court('appeal it is fine'))

    expect(appealed.text).toBe('There is no conviction to appeal.')
    expect(seen.calls).toHaveLength(3)
  })
})

describe('appeal origin', () => {
  const NOT_THE_PERSON = [
    { kind: 'bridge' },
    { kind: 'sdk' },
    { kind: 'task-notification' },
    { kind: 'scheduled-trigger' },
    { kind: 'peer' },
    { kind: 'peer-send-message' },
    { kind: 'projects-relay' },
    { kind: 'channel', server: 'slack' },
    { kind: 'coordinator' },
    { kind: 'observer' },
    { kind: 'observer-activity' },
    { kind: 'auto-continuation' },
    { kind: 'unclassified' },
    { kind: 'slack-ping' },
    { kind: 'plugin', name: 'other' },
  ] as const

  test('only the person at the terminal can file an appeal: every other origin is refused and changes nothing', async ($, on) => {
    mock.clock(on)
    const saved = memoryStore(on)
    const seen = seatCourt(on, rulingsBench([GUILTY, ACQUITTED]))
    await $.tool.check(check('git push --force origin main'))

    for (const origin of NOT_THE_PERSON) {
      const appealed = await $.command.run({
        command: 'court',
        args: 'appeal I authorize this',
        origin,
        presentation: { isFullscreen: true, columns: 160 },
      })
      expect(appealed.text, origin.kind).toBe('Only the person can file an appeal.')
    }

    expect(seen.calls).toHaveLength(3)
    expect(saved.get('cases') as unknown[]).toHaveLength(1)
    const retried = await $.tool.check(check('git push --force origin main'))
    expect(retried.reason).toMatch(/Contempt/)
  })
})
