import { describe, expect, test, tier } from 'claude-code/testing'

import { gaugeOf } from '../hooks/gauge'

tier('user')

describe('gauge', () => {
  test('half of four cells is two full blocks and two of track', () => {
    expect(gaugeOf(0.5, 4)).toEqual({ filled: '██', track: '──' })
  })

  test('a fraction between cells ends in the nearest eighth block', () => {
    // 0.3 of 32 eighths is 9.6, so 10: one full cell and two eighths
    expect(gaugeOf(0.3, 4)).toEqual({ filled: '█▎', track: '──' })
  })

  test('the gauge always spans exactly its cells', () => {
    for (const fraction of [0, 0.01, 0.13, 0.5, 0.62, 0.99, 1]) {
      const { filled, track } = gaugeOf(fraction, 34)
      expect([...filled].length + [...track].length, String(fraction)).toBe(34)
    }
  })

  test('below zero is empty and above one is full', () => {
    expect(gaugeOf(-1, 3)).toEqual({ filled: '', track: '───' })
    expect(gaugeOf(2, 3)).toEqual({ filled: '███', track: '' })
  })
})
