import { describe, expect, test, tier } from 'claude-code/testing'

import { DOCKET_LAYOUT, casesOf, docketOf, fileCase, isReadableLayout, priorsOf } from '../hooks/docket'
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

  test('a stored record is read as untrusted: only the fields this version keeps, each of its type', () => {
    const [old] = casesOf([
      {
        number: 3, command: 'rm -rf dist', charge: 'c', verdict: 'acquitted', at: 1, appeal: 2,
        root: '/work/app', facts: { top: '/work/app', tracked: { dist: false } }, precedent: 1,
      },
    ])
    expect(old).toEqual({ number: 3, command: 'rm -rf dist', charge: 'c', verdict: 'acquitted', at: 1, appeal: 2 })
    const [typed] = casesOf([{ number: 4, command: 'rm', charge: 'c', verdict: 'guilty', at: 1, appeal: '2' }])
    expect(typed).toEqual({ number: 4, command: 'rm', charge: 'c', verdict: 'guilty', at: 1 })
  })
})
