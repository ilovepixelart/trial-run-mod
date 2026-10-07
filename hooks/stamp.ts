/**
 * ANSI Shadow letters, six rows: full blocks are the letter, the box-drawing
 * edges its shadow. Every row of a letter is the same width.
 */
const SHADOW: Record<string, readonly string[]> = {
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  D: ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██████╔╝', '╚═════╝ '],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  G: [' ██████╗ ', '██╔════╝ ', '██║  ███╗', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  L: ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
  M: ['███╗   ███╗', '████╗ ████║', '██╔████╔██║', '██║╚██╔╝██║', '██║ ╚═╝ ██║', '╚═╝     ╚═╝'],
  N: ['███╗   ██╗', '████╗  ██║', '██╔██╗ ██║', '██║╚██╗██║', '██║ ╚████║', '╚═╝  ╚═══╝'],
  O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  P: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔═══╝ ', '██║     ', '╚═╝     '],
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
  S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
  T: ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
  U: ['██╗   ██╗', '██║   ██║', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  V: ['██╗   ██╗', '██║   ██║', '██║   ██║', '╚██╗ ██╔╝', ' ╚████╔╝ ', '  ╚═══╝  '],
  W: ['██╗    ██╗', '██║    ██║', '██║ █╗ ██║', '██║███╗██║', '╚███╔███╔╝', ' ╚══╝╚══╝ '],
  Y: ['██╗   ██╗', '╚██╗ ██╔╝', ' ╚████╔╝ ', '  ╚██╔╝  ', '   ██║   ', '   ╚═╝   '],
  ' ': ['  ', '  ', '  ', '  ', '  ', '  '],
}

/**
 * Plain block letters, five rows, for a pane too narrow for the shadow ones.
 */
const COMPACT: Record<string, readonly string[]> = {
  A: [' ███ ', '█   █', '█████', '█   █', '█   █'],
  C: [' ████', '█    ', '█    ', '█    ', ' ████'],
  D: ['████ ', '█   █', '█   █', '█   █', '████ '],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
  G: [' ████', '█    ', '█  ██', '█   █', ' ████'],
  I: ['███', ' █ ', ' █ ', ' █ ', '███'],
  L: ['█    ', '█    ', '█    ', '█    ', '█████'],
  M: ['█   █', '██ ██', '█ █ █', '█   █', '█   █'],
  N: ['█   █', '██  █', '█ █ █', '█  ██', '█   █'],
  O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
  P: ['████ ', '█   █', '████ ', '█    ', '█    '],
  R: ['████ ', '█   █', '████ ', '█  █ ', '█   █'],
  S: [' ████', '█    ', ' ███ ', '    █', '████ '],
  T: ['█████', '  █  ', '  █  ', '  █  ', '  █  '],
  U: ['█   █', '█   █', '█   █', '█   █', ' ███ '],
  V: ['█   █', '█   █', '█   █', ' █ █ ', '  █  '],
  W: ['█   █', '█   █', '█ █ █', '██ ██', '█   █'],
  Y: ['█   █', ' █ █ ', '  █  ', '  █  ', '  █  '],
  ' ': ['  ', '  ', '  ', '  ', '  '],
}

const FONTS = {
  shadow: { letters: SHADOW, gap: '' },
  compact: { letters: COMPACT, gap: ' ' },
}

/**
 * A word set in block letters: its rows, the column each letter starts at
 * (what the entrance reveals letter by letter), and its width.
 */
export type Stamp = { rows: string[]; starts: number[]; width: number }

/**
 * Sets a word in one of the fonts. A character with no letter is left out.
 *
 * @param word the word, in capitals
 * @param font `shadow`, six rows, or `compact`, five
 */
export const stampOf = (word: string, font: keyof typeof FONTS): Stamp => {
  const { letters, gap } = FONTS[font]
  const glyphs = [...word].flatMap(char => {
    const glyph = letters[char]
    return glyph === undefined ? [] : [glyph]
  })
  const height = glyphs[0]?.length ?? 0
  const rows = Array.from({ length: height }, (_, row) => glyphs.map(glyph => glyph[row] ?? '').join(gap))
  const starts: number[] = []
  let column = 0
  for (const glyph of glyphs) {
    starts.push(column)
    column += [...(glyph[0] ?? '')].length + gap.length
  }
  return { rows, starts, width: [...(rows[0] ?? '')].length }
}

/**
 * The fewest rows a pane must have before a verdict too wide for one line is
 * stacked in shadow letters, twelve rows tall: the case and the speeches
 * still need room beneath it.
 */
const STACK_ROWS = 28

/**
 * The verdict's stamp for a body this many columns wide: shadow letters
 * where they fit; a two-word verdict stacked in shadow letters, a word to a
 * line, where only that fits and the pane has the rows; compact letters
 * where those fit; and none at all where even those would wrap (the
 * headline still says the verdict).
 */
export const stampFor = (word: string, columns: number, rows = Number.POSITIVE_INFINITY): Stamp | null => {
  const shadow = stampOf(word, 'shadow')
  if (shadow.width <= columns) {
    return shadow
  }
  const words = word.split(' ')
  if (words.length === 2 && rows >= STACK_ROWS) {
    const lines = words.map(one => stampOf(one, 'shadow'))
    const width = Math.max(...lines.map(line => line.width))
    if (width <= columns) {
      return {
        rows: lines.flatMap(line => line.rows.map(row => row + ' '.repeat(width - line.width))),
        starts: lines[0]?.starts ?? [],
        width,
      }
    }
  }
  const compact = stampOf(word, 'compact')
  return compact.width <= columns ? compact : null
}

export type StampColors = { fill: string; edge: string; dim: string }

/**
 * One row of a stamp as coloured runs: blocks (dry or wet with ink) in the
 * fill colour, the shadow in the edge colour, everything from `revealed` on
 * drawn dim. A space takes the colour of the run it sits in, so runs stay few.
 */
export const segmentsOf = (row: string, revealed: number, colors: StampColors): { text: string; color: string }[] => {
  const segments: { text: string; color: string }[] = []
  ;[...row].forEach((char, column) => {
    const last = segments.at(-1)
    const color =
      column >= revealed
        ? colors.dim
        : char === ' '
          ? (last?.color ?? colors.fill)
          : char === '█' || char === '▓'
            ? colors.fill
            : colors.edge
    if (last?.color === color) {
      last.text += char
    } else {
      segments.push({ text: char, color })
    }
  })
  return segments
}

/**
 * The scales of justice in box drawing: level, or tipped to one side, as
 * the pans bob while the jury deliberates.
 */
export const SCALES: Record<'level' | 'left' | 'right', readonly string[]> = {
  level: [
    '  ━━━━━━━━━━╋━━━━━━━━━━  ',
    '  │         ┃         │  ',
    '╰───╯       ┃       ╰───╯',
    '            ┃            ',
    '         ━━━┻━━━         ',
  ],
  left: [
    '  ━━━━━━━━━━╋━━━━━━━━━━  ',
    '  │         ┃         │  ',
    '  │         ┃       ╰───╯',
    '╰───╯       ┃            ',
    '         ━━━┻━━━         ',
  ],
  right: [
    '  ━━━━━━━━━━╋━━━━━━━━━━  ',
    '  │         ┃         │  ',
    '╰───╯       ┃         │  ',
    '            ┃       ╰───╯',
    '         ━━━┻━━━         ',
  ],
}

/**
 * The stamp's landing, one frame a step: its vertical offset (negative is
 * still above the pane, cut off at the top), whether it shakes one column,
 * and whether its ink is still wet. The last frame is the stamp at rest.
 */
const LANDING: readonly { offset: number; shake: boolean; wet: boolean }[] = [
  { offset: -4, shake: false, wet: false },
  { offset: -2, shake: false, wet: false },
  { offset: 1, shake: false, wet: false },
  { offset: 0, shake: true, wet: true },
  { offset: 0, shake: false, wet: true },
  { offset: 0, shake: false, wet: false },
]

/**
 * One frame of the stamp landing. Every frame is one row taller than the
 * stamp, the row the overshoot drops into, so nothing beneath it moves.
 *
 * @param rows the stamp's rows
 * @param step the frame, from 0; past the last, the stamp at rest
 */
export const landingFrameOf = (rows: readonly string[], step: number): { rows: string[]; isLast: boolean } => {
  const index = Math.min(step, LANDING.length - 1)
  const { offset, shake, wet } = LANDING[index] ?? { offset: 0, shake: false, wet: false }
  const blank = ' '
  const shifted = offset < 0 ? rows.slice(-offset) : [...Array<string>(offset).fill(blank), ...rows]
  const height = rows.length + 1
  const framed = [...shifted, ...Array<string>(height).fill(blank)].slice(0, height)
  const drawn = framed.map(row => {
    const inked = wet ? row.replaceAll('█', '▓') : row
    return shake && row !== blank ? ` ${inked}` : inked
  })
  return { rows: drawn, isLast: index === LANDING.length - 1 }
}

/**
 * The gavel for "ALL RISE.": held up, swung, and struck, in box drawing and
 * blocks. Every pose is seven rows of the same width.
 */
export const GAVEL: Record<'raised' | 'swing' | 'struck', readonly string[]> = {
  raised: [
    '        ▄▄▄▄▄▄▄   ',
    '        ███████   ',
    '        ▀▀▀█▀▀▀   ',
    '           ╲      ',
    '            ╲     ',
    '                  ',
    '     ━━━━━━━━━━━  ',
  ],
  swing: [
    '                  ',
    '      ▄▄▄▄▄▄▄     ',
    '      ███████━━━━ ',
    '      ▀▀▀▀▀▀▀     ',
    '                  ',
    '                  ',
    '     ━━━━━━━━━━━  ',
  ],
  struck: [
    '                  ',
    '                  ',
    '                  ',
    '   *  ▄▄▄▄▄▄▄  *  ',
    '      ███████━━━━ ',
    '  *   ▀▀▀▀▀▀▀   * ',
    '     ━━━━━━━━━━━  ',
  ],
}
