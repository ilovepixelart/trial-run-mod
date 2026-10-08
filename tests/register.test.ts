import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { failedCheckOf, register } from '../hooks/register'
import { readings } from '../hooks/risky'
import { refused, said, seatCourt, verdictBench } from './fixtures/court'

tier('user')

const GUILTY = 'VERDICT: GUILTY\nREASON: it erases the whole home folder'
const ACQUITTED = 'VERDICT: NOT GUILTY\nREASON: only a build folder'

const check = (command: string) => ({ tool: 'Bash', input: { command } })

const COURT_FAILED = {
  decision: 'ask',
  reason: 'Mistrial! The court of the trial-run plugin failed, so it goes back to the permission prompt.',
}

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

  test('a court that fails mid-trial, with rules beneath that fail too, asks the person', async ($, on) => {
    seatCourt(on, {
      ...verdictBench(ACQUITTED),
      beneath: () => {
        throw new Error('the rules are gone')
      },
    })

    expect(await $.tool.check(check('git push --force origin main'))).toEqual(COURT_FAILED)
  })
})

describe('a failed check', () => {
  const failing = () => Promise.reject(new Error('the court is gone'))

  test('keeps a deny from the rules beneath, and reads no command', async () => {
    const before = readings.count
    expect(await failedCheckOf(async () => ({ decision: 'deny', reason: 'rule' }))).toEqual({ decision: 'deny', reason: 'rule' })
    expect(readings.count).toBe(before)
  })

  test('asks when the rules beneath allow or ask', async () => {
    expect(await failedCheckOf(async () => ({ decision: 'allow' }))).toEqual(COURT_FAILED)
    expect(await failedCheckOf(async () => ({ decision: 'ask', reason: 'mode' }))).toEqual(COURT_FAILED)
  })

  test('asks when the rules beneath fail too', async () => {
    expect(await failedCheckOf(failing)).toEqual(COURT_FAILED)
  })
})

/**
 * The court's own tool.check hook, registered in this file's realm, where
 * its readings of command lines are counted: the plugin under test loads in
 * a realm of its own. Its state lives in memory here, its clock never comes
 * due, every speaker says guilty and a pane opens placed. A call the test's
 * `$` does not offer (git, a stat, a sound) resolves to nothing; every
 * other call goes to the test's engine.
 */
const courtHere = ($: object) => {
  const hooks = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const on = (event: string, ...rest: unknown[]) => {
    hooks.set(event, rest.at(-1) as (...args: unknown[]) => Promise<unknown>)
    return {
      catch: (failed: (...args: unknown[]) => Promise<unknown>) => {
        hooks.set(`${event}.catch`, failed)
      },
    }
  }
  register(on as unknown as Parameters<typeof register>[0], {} as Parameters<typeof register>[1])
  const values = new Map<string, unknown>()
  const state = {
    get: async (ref: { key: string }) => ({ value: values.get(ref.key), version: 0 }),
    set: async (ref: { key: string }, value: unknown) => {
      values.set(ref.key, value)
      return { isSet: true, version: 0 }
    },
  }
  // the test's `$` is frozen, so each is read through, not wrapped
  const offered = (space: object) => new Proxy({}, { get: (_, name) => Reflect.get(space, name) ?? (async () => undefined) })
  // the deadline never comes: the trial runs to its verdict
  const clock = { sleep: () => new Promise(() => undefined), after: () => undefined }
  // every role says guilty; the judge's is the verdict
  const model = { complete: async () => said(GUILTY) }
  const ui = offered({ open: async () => ({ isPlaced: true }) })
  const own: Record<string, object> = { state, clock, model, ui }
  const engine = new Proxy({}, { get: (_, name) => own[String(name)] ?? offered((Reflect.get($, name) as object | undefined) ?? {}) })
  /**
   * The tool.check hook, or its `.catch` with `name` `tool.check.catch`, run
   * on a command over rules beneath that answer `beneath`.
   */
  return async (command: string, name = 'tool.check', beneath: unknown = { decision: 'allow' }) => {
    const hook = hooks.get(name)
    if (hook === undefined) {
      throw new Error(`no ${name} hook`)
    }
    return (await hook(engine, { tool: 'Bash', input: { command } }, async () => beneath)) as { decision: string; reason?: string }
  }
}

describe('one reading per check', () => {
  test('a tried command line is read once: for its charge, its contempt key and its exhibits', async $ => {
    const checked = courtHere($)

    for (const command of ['cd app && sudo rm -fr build', 'git push --force origin main']) {
      const before = readings.count
      expect((await checked(command)).decision, command).toBe('deny')
      expect(readings.count - before, command).toBe(1)
    }
  })

  test('a retried conviction, denied as contempt, is read once', async $ => {
    const checked = courtHere($)
    await checked('rm -rf build')
    // another line in between, so the retry is read again
    await checked('ls')

    const before = readings.count
    const verdict = await checked('rm -rf build')
    expect(verdict.reason).toContain('Contempt')
    expect(readings.count - before).toBe(1)
  })

  test('a check the court failed reads nothing, and keeps a deny from the rules beneath', async $ => {
    const checked = courtHere($)
    const failed = (beneath: unknown) => checked('rm -rf build', 'tool.check.catch', beneath)

    const before = readings.count
    expect(await failed({ decision: 'deny', reason: 'rule' })).toEqual({ decision: 'deny', reason: 'rule' })
    expect(await failed({ decision: 'allow' })).toEqual(COURT_FAILED)
    expect(readings.count).toBe(before)
  })
})
