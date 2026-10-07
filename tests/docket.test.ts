import { describe, expect, test, tier } from 'claude-code/testing'

import { DOCKET_LAYOUT, casesOf, docketOf, fileCase, isReadableLayout, precedentOf, priorsOf } from '../hooks/docket'
import type { CaseRecord } from '../hooks/docket'

tier('user')

const record = (number: number, charge: string, verdict: CaseRecord['verdict'], command = 'cmd'): CaseRecord => ({
  number,
  command,
  charge,
  verdict,
  at: 1_000 + number,
})

describe('docket', () => {
  test('the first case is number 1, each next one the last number plus one', () => {
    const first = fileCase([], { command: 'rm -rf x', charge: 'recursive delete', verdict: 'guilty', at: 5 })
    expect(first.map(c => c.number)).toEqual([1])

    const second = fileCase(first, { command: 'git push -f', charge: 'force push', verdict: 'acquitted', at: 6 })
    expect(second.map(c => c.number)).toEqual([1, 2])
  })

  test('numbering continues past the cap, which keeps only the newest cases', () => {
    const full = Array.from({ length: 200 }, (_, i) => record(i + 1, 'force push', 'guilty'))

    const next = fileCase(full, { command: 'ls', charge: 'force push', verdict: 'guilty', at: 9 })

    expect(next).toHaveLength(200)
    expect(next[0]?.number).toBe(2)
    expect(next.at(-1)?.number).toBe(201)
  })

  test('a long command is kept to 80 characters', () => {
    const [filed] = fileCase([], { command: 'x'.repeat(300), charge: 'c', verdict: 'hung', at: 1 })
    expect(filed?.command).toHaveLength(80)
  })

  test('prior convictions count only guilty verdicts on the same charge', () => {
    const history = [
      record(1, 'force push', 'guilty'),
      record(2, 'force push', 'acquitted'),
      record(3, 'recursive delete', 'guilty'),
      record(4, 'force push', 'guilty'),
      record(5, 'force push', 'hung'),
    ]
    expect(priorsOf(history, 'force push')).toBe(2)
    expect(priorsOf(history, 'hard reset')).toBe(0)
  })

  test('contempt counts as a conviction', () => {
    const history = [record(1, 'a', 'guilty'), record(2, 'a', 'contempt'), record(3, 'b', 'acquitted')]
    expect(docketOf(history).convictionRate).toBe(2 / 3)
    expect(priorsOf(history, 'a')).toBe(2)
    expect(docketOf(history).rapSheet).toEqual([{ charge: 'a', count: 2 }])
    expect(casesOf(history).map(c => c.verdict)).toEqual(['guilty', 'contempt', 'acquitted'])
  })

  test('a waived trial is no ruling: it counts in neither the rate nor the priors', () => {
    const history = [record(1, 'a', 'guilty'), record(2, 'a', 'waived'), record(3, 'a', 'acquitted')]
    expect(docketOf(history).convictionRate).toBe(0.5)
    expect(priorsOf(history, 'a')).toBe(1)
    expect(casesOf(history).map(c => c.verdict)).toEqual(['guilty', 'waived', 'acquitted'])
  })

  test('the conviction rate is guilty over guilty plus acquitted; mistrials do not count', () => {
    const history = [
      record(1, 'a', 'guilty'),
      record(2, 'a', 'guilty'),
      record(3, 'a', 'acquitted'),
      record(4, 'a', 'hung'),
      record(5, 'a', 'guilty'),
      record(6, 'a', 'acquitted'),
    ]
    expect(docketOf(history).convictionRate).toBe(0.6)
    expect(docketOf(history).total).toBe(6)
  })

  test('an empty docket has a rate of zero and nothing wanted', () => {
    const docket = docketOf([])
    expect(docket.convictionRate).toBe(0)
    expect(docket.total).toBe(0)
    expect(docket.recent).toEqual([])
    expect(docket.strip).toEqual([])
    expect(docket.rapSheet).toEqual([])
    expect(docket.mostWanted).toBeUndefined()
  })

  test('recent cases are the newest six, newest first', () => {
    const history = Array.from({ length: 9 }, (_, i) => record(i + 1, 'a', 'guilty'))
    expect(docketOf(history).recent.map(c => c.number)).toEqual([9, 8, 7, 6, 5, 4])
  })

  test('the strip is the last 30 verdicts, oldest first', () => {
    const history = Array.from({ length: 35 }, (_, i) =>
      record(i + 1, 'a', i % 3 === 0 ? 'guilty' : i % 3 === 1 ? 'acquitted' : 'hung'),
    )
    const strip = docketOf(history).strip
    expect(strip).toHaveLength(30)
    // cases 6, 7 and 8 (i = 5, 6, 7) open the last thirty
    expect(strip.slice(0, 3)).toEqual(['hung', 'guilty', 'acquitted'])
    expect(strip.at(-1)).toBe('acquitted')
  })

  test('the rap sheet counts convictions per charge, most first, at most three', () => {
    const history = [
      record(1, 'hard reset', 'guilty'),
      record(2, 'force push', 'guilty'),
      record(3, 'force push', 'guilty'),
      record(4, 'recursive delete', 'guilty'),
      record(5, 'force push', 'acquitted'),
      record(6, 'recursive delete', 'guilty'),
      record(7, 'force push', 'guilty'),
      record(8, 'kubectl delete', 'guilty'),
      record(9, 'terraform destroy', 'hung'),
    ]
    const docket = docketOf(history)
    expect(docket.rapSheet).toEqual([
      { charge: 'force push', count: 3 },
      { charge: 'recursive delete', count: 2 },
      { charge: 'hard reset', count: 1 },
    ])
    expect(docket.mostWanted).toBe('force push')
  })

  test('a docket with no layout, layout 1 or this layout is readable; a newer one is not', () => {
    expect(DOCKET_LAYOUT).toBe(2)
    expect(isReadableLayout(undefined)).toBe(true)
    expect(isReadableLayout(1)).toBe(true)
    expect(isReadableLayout(2)).toBe(true)
    expect(isReadableLayout(3)).toBe(false)
    expect(isReadableLayout(17)).toBe(false)
  })

  describe('precedent', () => {
    // where git ran: precedent compares it too
    const PLACE = { top: '/work/app', prefix: '', branch: 'main' }
    // a delete target read clean: nothing untracked, ignored or changed under it
    const CLEAN = (target: string) => ({ untracked: { [target]: 0 }, ignoredIn: { [target]: 0 }, modifiedIn: { [target]: 0 } })
    const heard = (number: number, verdict: CaseRecord['verdict'], over: Partial<CaseRecord> = {}): CaseRecord => ({
      ...record(number, 'recursive delete', verdict, 'rm -rf dist'),
      root: '/work/app',
      facts: { ...PLACE, tracked: { dist: false }, ...CLEAN('dist') },
      ...over,
    })
    const sought = { command: 'rm -rf dist', root: '/work/app', facts: { ...PLACE, tracked: { dist: false }, ...CLEAN('dist') } }

    test('an acquittal in the same project root on the same command line is precedent', () => {
      expect(precedentOf([heard(1, 'acquitted')], sought)?.number).toBe(1)
      expect(precedentOf([heard(1, 'acquitted')], { ...sought, command: 'rm  -fr dist' })?.number).toBe(1)
      expect(precedentOf([heard(1, 'acquitted')], { ...sought, command: 'rm -rf build' })).toBeUndefined()
    })

    test('only a plainly spelled command name sets or follows precedent', () => {
      expect(precedentOf([heard(1, 'acquitted')], sought)?.number).toBe(1)
      for (const command of ['./rm -rf dist', '/bin/rm -rf dist']) {
        expect(precedentOf([heard(1, 'acquitted')], { ...sought, command }), command).toBeUndefined()
        expect(precedentOf([heard(1, 'acquitted', { command })], { ...sought, command }), command).toBeUndefined()
      }
      expect(precedentOf([heard(1, 'acquitted', { command: '/bin/rm -rf dist' })], sought)).toBeUndefined()
    })

    test('a later conviction under another spelling still overturns an acquittal', () => {
      expect(precedentOf([heard(1, 'acquitted'), heard(2, 'guilty', { command: '/bin/rm -rf dist' })], sought)).toBeUndefined()
    })

    test('precedent is per project', () => {
      expect(precedentOf([heard(1, 'acquitted')], { ...sought, root: '/work/other' })).toBeUndefined()
      expect(precedentOf([heard(1, 'acquitted', { root: undefined })], sought)).toBeUndefined()
    })

    test('a case whose facts were not read, or are missing, is never precedent', () => {
      expect(precedentOf([heard(1, 'acquitted', { facts: undefined })], sought)).toBeUndefined()
      expect(precedentOf([heard(1, 'acquitted', { facts: {} })], { ...sought, facts: {} })).toBeUndefined()
      const [nulled] = casesOf([{ ...heard(1, 'acquitted'), facts: null }])
      expect(precedentOf([nulled!], sought)).toBeUndefined()
    })

    test('a case filed before layout 2 is never precedent', () => {
      expect(precedentOf([record(1, 'recursive delete', 'acquitted', 'rm -rf dist')], sought)).toBeUndefined()
    })

    test('the latest ruling on the command decides: a later conviction or contempt overturns an acquittal', () => {
      expect(precedentOf([heard(1, 'acquitted'), heard(2, 'guilty')], sought)).toBeUndefined()
      expect(precedentOf([heard(1, 'acquitted'), heard(2, 'contempt')], sought)).toBeUndefined()
      expect(precedentOf([heard(1, 'guilty'), heard(2, 'acquitted')], sought)?.number).toBe(2)
      expect(precedentOf([heard(1, 'acquitted'), heard(2, 'hung'), heard(3, 'waived')], sought)?.number).toBe(1)
    })

    test('a later conviction filed without a root overturns an acquittal in any root; one in another root does not', () => {
      expect(precedentOf([heard(1, 'acquitted'), heard(2, 'guilty', { root: undefined })], sought)).toBeUndefined()
      expect(precedentOf([heard(1, 'acquitted'), heard(2, 'contempt', { root: undefined, facts: undefined })], sought)).toBeUndefined()
      expect(precedentOf([heard(1, 'guilty', { root: undefined }), heard(2, 'acquitted')], sought)?.number).toBe(2)
      expect(precedentOf([heard(1, 'acquitted'), heard(2, 'guilty', { root: '/work/other' })], sought)?.number).toBe(1)
    })

    test('a conviction counts by the key of its charged part, simple line or not; an acquittal needs a whole simple line', () => {
      expect(precedentOf([heard(1, 'acquitted'), heard(2, 'guilty', { command: 'rm\t-rf dist', facts: undefined })], sought)).toBeUndefined()
      expect(precedentOf([heard(1, 'guilty', { command: 'rm\t-rf dist' }), heard(2, 'acquitted')], sought)?.number).toBe(2)
      expect(precedentOf([heard(1, 'acquitted', { command: 'rm\t-rf dist' })], sought)).toBeUndefined()
    })

    test('changed facts reopen the case: tracked state, or an upstream branch ahead', () => {
      expect(precedentOf([heard(1, 'acquitted')], { ...sought, facts: { ...PLACE, tracked: { dist: true }, ...CLEAN('dist') } })).toBeUndefined()
      expect(precedentOf([heard(1, 'acquitted')], { ...sought, facts: {} })).toBeUndefined()
      const push = { command: 'git push --force origin main', root: '/work/app' }
      const pushed = (behind: number | undefined) =>
        heard(1, 'acquitted', { command: push.command, facts: behind === undefined ? PLACE : { ...PLACE, behind } })
      expect(precedentOf([pushed(0)], { ...push, facts: { ...PLACE, behind: 0 } })?.number).toBe(1)
      expect(precedentOf([pushed(2)], { ...push, facts: { ...PLACE, behind: 2 } })).toBeUndefined()
      expect(precedentOf([pushed(0)], { ...push, facts: { ...PLACE, behind: 1 } })).toBeUndefined()
      expect(precedentOf([pushed(0)], { ...push, facts: PLACE })).toBeUndefined()
    })

    test('only a simple command line sets or follows precedent', () => {
      expect(precedentOf([heard(1, 'acquitted')], { ...sought, command: 'rm -rf dist && rm -rf ~' })).toBeUndefined()
      // the key folds any whitespace, so a newline would otherwise match
      expect(precedentOf([heard(1, 'acquitted')], { ...sought, command: 'rm -rf\ndist' })).toBeUndefined()
      expect(precedentOf([heard(1, 'acquitted')], { ...sought, command: 'rm\t-rf dist' })).toBeUndefined()
      const compound = heard(1, 'acquitted', { command: 'cd app && rm -rf dist' })
      expect(precedentOf([compound], { ...sought, command: 'cd app && rm -rf dist' })).toBeUndefined()
    })

    test('a stored record is matched by the command it holds, never by a key it claims', () => {
      const forged = { ...heard(1, 'acquitted', { command: 'rm -rf build' }), key: '-fr rm dist' } as CaseRecord
      expect(precedentOf([forged], sought)).toBeUndefined()
      expect(precedentOf([forged], { ...sought, command: 'rm -rf build' })?.number).toBe(1)
    })

    test('a command cut to fit the docket is never precedent', () => {
      const long = `rm -rf ${'x'.repeat(80)}`
      const [cut] = fileCase([], { command: long, charge: 'c', verdict: 'acquitted', at: 1, root: '/r', facts: {} })
      expect(cut?.command).toHaveLength(80)
      expect(precedentOf([cut!], { command: cut!.command, root: '/r', facts: {} })).toBeUndefined()
      const known = { ...PLACE, tracked: { x: false }, ...CLEAN('x') }
      const [whole] = fileCase([], { command: 'rm -rf x', charge: 'c', verdict: 'acquitted', at: 1, root: '/r', facts: known })
      expect(precedentOf([whole!], { command: 'rm -rf x', root: '/r', facts: known })?.number).toBe(1)
    })

    test('a stored record is read as untrusted: precedent fields of the wrong type are dropped', () => {
      const [read] = casesOf([
        { number: 1, command: 'rm -rf dist', charge: 'c', verdict: 'acquitted', at: 1, root: 7, facts: 'x', precedent: 'y' },
      ])
      expect(read).toEqual({ number: 1, command: 'rm -rf dist', charge: 'c', verdict: 'acquitted', at: 1 })
      const [facts] = casesOf([
        { number: 1, command: 'rm', charge: 'c', verdict: 'acquitted', at: 1, root: '/r', facts: { behind: '0', tracked: { a: 'yes', b: true } } },
      ])
      expect(facts?.root).toBe('/r')
      expect(facts?.facts).toEqual({ tracked: { b: true } })
      // the counts that keep a target clean are read back, whole counts only
      const [counted] = casesOf([
        {
          number: 2, command: 'rm', charge: 'c', verdict: 'acquitted', at: 1,
          facts: { tracked: { a: true }, untracked: { a: 0, b: -1 }, ignoredIn: { a: 0, b: '0' }, modifiedIn: { a: 0, b: 1.5 } },
        },
      ])
      expect(counted?.facts).toEqual({ tracked: { a: true }, untracked: { a: 0 }, ignoredIn: { a: 0 }, modifiedIn: { a: 0 } })
      const [cited] = casesOf([{ number: 3, command: 'rm', charge: 'c', verdict: 'acquitted', at: 1, precedent: 1, appeal: 2 }])
      expect(cited).toEqual({ number: 3, command: 'rm', charge: 'c', verdict: 'acquitted', at: 1, precedent: 1, appeal: 2 })
    })
  })
})
