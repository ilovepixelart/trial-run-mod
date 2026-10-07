import { describe, expect, test, tier } from 'claude-code/testing'

import { caseRowOf, docketLayoutOf, headerLinesOf, lineOf, rapSheetLayoutOf, wrapOf } from '../hooks/layout'

tier('user')

describe('layout', () => {
  test('the case header is one line where it fits', () => {
    expect(headerLinesOf('force push', 7, 3, 80)).toEqual(['Charge: force push   ·   Case #0007   ·   Prior convictions: 3'])
  })

  test('a narrow header breaks between its parts, never inside one', () => {
    expect(headerLinesOf('recursive delete', 8, 0, 46)).toEqual(['Charge: recursive delete', 'Case #0008   ·   Prior convictions: 0'])
    expect(headerLinesOf('recursive delete', 8, 10, 30)).toEqual([
      'Charge: recursive delete',
      'Case #0008',
      'Prior convictions: 10',
    ])
  })

  test('a docket row fits its width: number, mark, verdict word, then the command cut with three dots', () => {
    const row = caseRowOf({ number: 15, command: 'git push --force origin main', verdict: 'guilty' }, 35)
    expect(row).toEqual({ number: '#0015', mark: '✕', label: 'GUILTY    ', command: 'git push --fo...' })
    expect([row.number, row.mark, row.label, row.command].join(' ').length).toBeLessThanOrEqual(35)
  })

  test('a wide docket row keeps the whole command', () => {
    const row = caseRowOf({ number: 3, command: 'rm -rf dist', verdict: 'acquitted' }, 60)
    expect(row.command).toBe('rm -rf dist')
    expect(row.label).toBe('NOT GUILTY')
  })

  test('the docket gauges and the verdict strip shrink with the pane and never overflow it', () => {
    for (const body of [35, 46, 58, 76]) {
      const layout = docketLayoutOf(body)
      expect('Conviction rate  '.length + layout.rateCells + 4, `rate at ${body}`).toBeLessThanOrEqual(body)
      // one space between marks: n marks take 2n - 1 cells
      expect('Last 30  '.length + 2 * layout.strip - 1, `strip at ${body}`).toBeLessThanOrEqual(body)
      expect(layout.rateCells).toBeGreaterThanOrEqual(6)
    }
    expect(docketLayoutOf(76)).toEqual({ rateCells: 30, strip: 30 })
  })

  test('the rap sheet label column fits the longest charge and the bar gives way', () => {
    // 76 - 4 frame - 17 label - 1 gap - 4 count = 50, capped at 24
    expect(rapSheetLayoutOf(76, ['force push', 'terraform destroy'])).toEqual({ labelCells: 17, barCells: 24, isStacked: false })
    // 46 - 4 - 25 - 1 - 4 = 12
    expect(rapSheetLayoutOf(46, ['dropped or truncated data'])).toEqual({ labelCells: 25, barCells: 12, isStacked: false })
    // 35 - 4 - 25 - 1 - 4 = 1, too short for a bar beside it: stacked, the bar is 35 - 4 - 4 = 27, capped at 24
    expect(rapSheetLayoutOf(35, ['dropped or truncated data'])).toEqual({ labelCells: 25, barCells: 24, isStacked: true })
  })

  test('wrapped text breaks between words, keeps every word, and no line overflows', () => {
    expect(wrapOf('Run git stash first, so the changes are kept.', 20)).toEqual([
      'Run git stash first,',
      'so the changes are',
      'kept.',
    ])
    expect(wrapOf('short', 20)).toEqual(['short'])
    // a word longer than the line is cut into pieces that fit
    expect(wrapOf('--dry-run=client-side-only now', 10)).toEqual(['--dry-run=', 'client-sid', 'e-only now'])
  })

  test('a speech on one line is cut at a word, marked with three dots, and fits', () => {
    const speech = 'Force pushing main overwrites all remote commits, destroying teammates work.'
    expect(lineOf(speech, 200)).toBe(speech)
    const line = lineOf(speech, 40)
    expect(line.length).toBeLessThanOrEqual(40)
    expect(line).toBe('Force pushing main overwrites all...')
    expect(lineOf('Short.', 6)).toBe('Short.')
  })
})
