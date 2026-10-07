import { describe, expect, test, tier } from 'claude-code/testing'

import { landingFrameOf, segmentsOf, stampFor, stampOf } from '../hooks/stamp'

tier('user')

describe('stamp', () => {
  test('a word is drawn in six rows of ANSI Shadow letters, set solid', () => {
    // I then T, as the approved mock's font draws them, no gap between letters
    expect(stampOf('IT', 'shadow').rows).toEqual([
      '██╗████████╗',
      '██║╚══██╔══╝',
      '██║   ██║   ',
      '██║   ██║   ',
      '██║   ██║   ',
      '╚═╝   ╚═╝   ',
    ])
    expect(stampOf('IT', 'shadow').starts).toEqual([0, 3])
    expect(stampOf('IT', 'shadow').width).toBe(12)
  })

  test('the compact letters are five rows of full blocks, one space apart', () => {
    expect(stampOf('IT', 'compact').rows).toEqual(['███ █████', ' █    █  ', ' █    █  ', ' █    █  ', '███   █  '])
  })

  test('a verdict takes the shadow letters where they fit and the compact ones where they do not', () => {
    // NOT GUILTY is 77 columns in shadow letters
    expect(stampFor('NOT GUILTY', 77)?.rows).toHaveLength(6)
    expect(stampFor('NOT GUILTY', 76, 20)?.rows).toHaveLength(5)
    for (const word of ['GUILTY', 'NOT GUILTY', 'MISTRIAL', 'WAIVED', 'CONTEMPT']) {
      expect(stampFor(word, 56)?.width, word).toBeLessThanOrEqual(56)
    }
  })

  test('every letter of every verdict is in both fonts', () => {
    for (const word of ['GUILTY', 'NOT GUILTY', 'MISTRIAL', 'WAIVED', 'CONTEMPT']) {
      for (const font of ['shadow', 'compact'] as const) {
        expect(stampOf(word, font).starts, `${word} ${font}`).toHaveLength(word.length)
      }
    }
    // W 10 + A 8 + I 3 + V 9 + E 8 + D 8, shadow letters touch
    expect(stampOf('WAIVED', 'shadow').width).toBe(46)
    // C 8 + O 9 + N 10 + T 9 + E 8 + M 11 + P 8 + T 9
    expect(stampOf('CONTEMPT', 'shadow').width).toBe(72)
  })

  test('a revealed row is the fill colour on blocks and the edge colour on the shadow, merged into runs', () => {
    expect(segmentsOf('██╗ ██', 6, { fill: 'F', edge: 'E', dim: 'D' })).toEqual([
      { text: '██', color: 'F' },
      { text: '╗ ', color: 'E' },
      { text: '██', color: 'F' },
    ])
  })

  test('the part of a row not yet revealed is drawn dim', () => {
    expect(segmentsOf('██╗██╗', 3, { fill: 'F', edge: 'E', dim: 'D' })).toEqual([
      { text: '██', color: 'F' },
      { text: '╗', color: 'E' },
      { text: '██╗', color: 'D' },
    ])
  })

  test('the landing drops from above, overshoots a row, shakes a column wet with ink, then dries in place', () => {
    const rows = ['AB', 'CD', 'E█']
    const frames = Array.from({ length: 8 }, (_, step) => landingFrameOf(rows, step))
    const last = frames.findIndex(frame => frame.isLast)

    expect(frames[0]?.rows.filter(row => row.trim() !== '').length).toBeLessThan(rows.length)
    expect(frames.some(frame => frame.rows[0]?.trim() === '' && frame.rows[1] === 'AB')).toBe(true)
    expect(frames.some(frame => frame.rows.some(row => row.startsWith(' ') && row.includes('▓')))).toBe(true)
    expect(last).toBeGreaterThan(2)
    expect(frames[last]?.rows).toEqual(['AB', 'CD', 'E█', ' '])
    expect(frames.every(frame => frame.rows.length === rows.length + 1)).toBe(true)
  })

  test('a wet letter is drawn in the fill colour, like a dry one', () => {
    const runs = segmentsOf('▓█╗', Infinity, { fill: 'red', edge: 'grey', dim: 'dim' })
    expect(runs).toEqual([
      { text: '▓█', color: 'red' },
      { text: '╗', color: 'grey' },
    ])
  })

  test('a pane too narrow for even the compact letters gets no stamp: the headline says the verdict', () => {
    const compact = stampOf('GUILTY', 'compact').width
    expect(stampFor('GUILTY', compact)?.rows).toHaveLength(5)
    expect(stampFor('GUILTY', compact - 1)).toBeNull()
  })

  test('NOT GUILTY too wide for one line stands in shadow letters on two, NOT above GUILTY, where rows allow', () => {
    const stamp = stampFor('NOT GUILTY', 57, 30)
    const not = stampOf('NOT', 'shadow')
    const guilty = stampOf('GUILTY', 'shadow')
    expect(stamp?.rows).toHaveLength(12)
    expect(stamp?.width).toBe(guilty.width)
    expect(stamp?.rows[0]?.trimEnd()).toBe(not.rows[0]?.trimEnd())
    expect(stamp?.rows[6]).toBe(guilty.rows[0])
    for (const row of stamp?.rows ?? []) {
      expect([...row].length).toBe(guilty.width)
    }
  })

  test('without rows to spare NOT GUILTY falls back to compact letters on one line', () => {
    const stamp = stampFor('NOT GUILTY', 57, 20)
    expect(stamp?.rows).toHaveLength(5)
  })

  test('a word that fits on one line in shadow letters stays on one line', () => {
    expect(stampFor('GUILTY', 57, 30)?.rows).toHaveLength(6)
    expect(stampFor('NOT GUILTY', 80, 30)?.rows).toHaveLength(6)
  })
})

