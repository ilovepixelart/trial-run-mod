import type { CaseRecord } from './docket'

const SEPARATOR = '   ·   '

/**
 * A case as the court numbers it: `#0007`.
 */
export const caseNumberOf = (number: number) => `#${String(number).padStart(4, '0')}`

/**
 * The case header (charge, case number, prior convictions): one line where
 * it fits, else the charge alone and the record packed beneath it, breaking
 * only between parts.
 */
export const headerLinesOf = (charge: string, number: number, priors: number, columns: number): string[] => {
  const record = [`Case ${caseNumberOf(number)}`, `Prior convictions: ${priors}`]
  const whole = [`Charge: ${charge}`, ...record].join(SEPARATOR)
  if (whole.length <= columns) {
    return [whole]
  }
  const packed = record.reduce<string[]>((lines, part) => {
    const last = lines.at(-1)
    if (last !== undefined && last.length + SEPARATOR.length + part.length <= columns) {
      lines[lines.length - 1] = last + SEPARATOR + part
    } else {
      lines.push(part)
    }
    return lines
  }, [])
  return [`Charge: ${charge}`, ...packed]
}

const LABELS: Record<CaseRecord['verdict'], string> = {
  guilty: 'GUILTY',
  acquitted: 'NOT GUILTY',
  hung: 'MISTRIAL',
  waived: 'WAIVED',
  contempt: 'CONTEMPT',
}

const MARKS: Record<CaseRecord['verdict'], string> = { guilty: '✕', acquitted: '✓', hung: '?', waived: '-', contempt: '✕' }

/**
 * Everything on a docket row before the command: number, mark, verdict word
 * padded to its longest, and the single spaces between them.
 */
const ROW_FIXED = '#0000'.length + 1 + 1 + 1 + 'NOT GUILTY'.length + 1

/**
 * One docket row cut to `columns`: the command is what gives way, cut at
 * the width with `...` so the verdict always shows as a mark and a word.
 */
export const caseRowOf = (
  one: Pick<CaseRecord, 'number' | 'command' | 'verdict'>,
  columns: number,
): { number: string; mark: string; label: string; command: string } => {
  const room = Math.max(4, columns - ROW_FIXED)
  const command = one.command.length <= room ? one.command : `${one.command.slice(0, room - 3).trimEnd()}...`
  return {
    number: caseNumberOf(one.number),
    mark: MARKS[one.verdict],
    label: LABELS[one.verdict].padEnd('NOT GUILTY'.length),
    command,
  }
}

/**
 * How wide the docket's gauges and its verdict strip are drawn in a pane
 * `body` columns wide: as wide as the design wants, narrower where the pane
 * is, never past it.
 */
export const docketLayoutOf = (body: number): { rateCells: number; strip: number } => ({
  rateCells: Math.max(6, Math.min(30, body - 'Conviction rate  '.length - 4)),
  // one space between marks: n marks take 2n - 1 cells
  strip: Math.max(3, Math.min(30, Math.floor((body - 'Last 30  '.length + 1) / 2))),
})

/**
 * A text on one line of `columns` cells: whole when it fits, else cut at the
 * last word that fits and marked `...`.
 */
export const lineOf = (text: string, columns: number): string => {
  if (text.length <= columns) {
    return text
  }
  const cut = text.slice(0, Math.max(1, columns - 3))
  const word = cut.lastIndexOf(' ')
  return `${(word > 0 ? cut.slice(0, word) : cut).replace(/[\s,;:.!?]+$/, '')}...`
}

const RAP_FRAME = 4 // the rap sheet's round border and its padding
const RAP_COUNT = 4 // a count right-aligned in four cells
const MIN_BAR = 6
const MAX_BAR = 24

/**
 * How the rap sheet lays out in a docket `body` columns wide: a label column
 * as wide as the longest charge it lists, then the bar, then the count. The
 * bar shrinks before a label is ever cut; where not even a short bar fits
 * beside the longest label, each bar goes on the line under its label.
 *
 * @param labels the charges the rap sheet lists
 */
export const rapSheetLayoutOf = (
  body: number,
  labels: readonly string[],
): { labelCells: number; barCells: number; isStacked: boolean } => {
  const longest = Math.max(0, ...labels.map(label => label.length))
  const beside = body - RAP_FRAME - longest - 1 - RAP_COUNT
  if (beside >= MIN_BAR) {
    return { labelCells: longest, barCells: Math.min(MAX_BAR, beside), isStacked: false }
  }
  return {
    labelCells: Math.min(longest, body - RAP_FRAME),
    barCells: Math.max(1, Math.min(MAX_BAR, body - RAP_FRAME - RAP_COUNT)),
    isStacked: true,
  }
}

/**
 * Text broken into lines of at most `columns`, between words; a word longer
 * than a line is cut into pieces that fit.
 */
export const wrapOf = (text: string, columns: number): string[] => {
  const width = Math.max(1, columns)
  const pieces = text
    .split(/\s+/)
    .filter(word => word !== '')
    .flatMap(word => (word.length <= width ? [word] : (word.match(new RegExp(`.{1,${width}}`, 'g')) ?? [])))
  return pieces.reduce<string[]>((lines, piece) => {
    const last = lines.at(-1)
    if (last !== undefined && last.length + 1 + piece.length <= width) {
      lines[lines.length - 1] = `${last} ${piece}`
    } else {
      lines.push(piece)
    }
    return lines
  }, [])
}
