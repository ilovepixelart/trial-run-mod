/**
 * The approved palette: colour-blind safe, each verdict also carried by a
 * glyph and a word. Taken from the design spec, not from the plugin.
 */
export const PALETTE = {
  guilty: '#FF6B3D',
  acquitted: '#56B4E9',
  gold: '#E69F00',
  mistrial: '#CC79A7',
  muted: '#8B93A6',
  shadow: '#5A5F7A',
} as const

/**
 * Code point ranges a terminal draws two cells wide (East Asian wide and
 * fullwidth, and the emoji blocks).
 */
const WIDE: readonly [number, number][] = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff],
]

/**
 * How many terminal cells a string takes on its widest line.
 */
export const widthOf = (text: string): number =>
  Math.max(
    0,
    ...text.split('\n').map(line =>
      [...line].reduce((cells, char) => {
        const code = char.codePointAt(0) ?? 0
        return cells + (WIDE.some(([lo, hi]) => code >= lo && code <= hi) ? 2 : 1)
      }, 0),
    ),
  )

const SAFE_EXTRA = new Set(['✓', '✕', '·', '▴', '▾', '●', '•', '\n'])

/**
 * Whether a glyph is one every common monospace font draws one cell wide:
 * ASCII, box drawing, block elements, and a few marks.
 */
export const isSafeGlyph = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0
  return (
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0x2500 && code <= 0x257f) ||
    (code >= 0x2580 && code <= 0x259f) ||
    SAFE_EXTRA.has(char)
  )
}

type Node =
  | { type?: string; props?: Record<string, unknown>; children?: unknown }
  | string
  | number
  | null
  | undefined
  | boolean

/**
 * An element's children: a drawn tree keeps them beside `props`, a tree a
 * hook built keeps them inside.
 */
const childrenOf = (node: Node): Node[] => {
  if (typeof node !== 'object' || node === null) {
    return []
  }
  const children = node.children ?? node.props?.children
  return (Array.isArray(children) ? children.flat(Infinity) : [children]) as Node[]
}

/**
 * Every string a tree draws, Button labels included.
 */
export const textsOf = (tree: unknown): string[] => {
  const node = tree as Node
  if (typeof node === 'string' || typeof node === 'number') {
    return [String(node)]
  }
  if (typeof node !== 'object' || node === null) {
    return []
  }
  const label = node.type === 'Button' && typeof node.props?.label === 'string' ? [node.props.label] : []
  return [...label, ...childrenOf(node).flatMap(textsOf)]
}

/**
 * How many elements a tree holds.
 */
export const nodeCount = (tree: unknown): number => {
  const node = tree as Node
  return typeof node === 'object' && node !== null
    ? 1 + childrenOf(node).reduce<number>((n, child) => n + nodeCount(child), 0)
    : 0
}

/**
 * Every `Client` key in a tree.
 */
export const clientKeysOf = (tree: unknown): string[] => {
  const node = tree as Node
  if (typeof node !== 'object' || node === null) {
    return []
  }
  const own = node.type === 'Client' && typeof node.props?.key === 'string' ? [node.props.key] : []
  return [...own, ...childrenOf(node).flatMap(clientKeysOf)]
}

const num = (value: unknown) => (typeof value === 'number' ? value : 0)

/**
 * The natural width of a tree in cells, as the terminal lays it out with
 * nothing wrapped: a row Box (Ink's default) sums its children, a column
 * Box takes the widest, padding, margin and a border add to both sides. A
 * `Client` is measured by what its module drew, from `clients`.
 */
export const layoutWidthOf = (tree: unknown, clients: Readonly<Record<string, unknown>> = {}): number => {
  const node = tree as Node
  if (typeof node === 'string' || typeof node === 'number') {
    return widthOf(String(node))
  }
  if (typeof node !== 'object' || node === null) {
    return 0
  }
  const props = node.props ?? {}
  if (node.type === 'Text') {
    return widthOf(textsOf(node).join(''))
  }
  if (node.type === 'Button') {
    return widthOf(`[ ${String(props.label ?? '')} ]`)
  }
  if (node.type === 'Client') {
    return layoutWidthOf(clients[String(props.key)], clients)
  }
  if (props.display === 'none') {
    return 0
  }
  const widths = childrenOf(node).map(child => layoutWidthOf(child, clients))
  const isColumn = props.flexDirection === 'column' || props.flexDirection === 'column-reverse'
  const inner = isColumn
    ? Math.max(0, ...widths)
    : widths.reduce((a, b) => a + b, 0) + num(props.gap ?? props.columnGap) * Math.max(0, widths.length - 1)
  const padding = num(props.paddingLeft ?? props.paddingX ?? props.padding) + num(props.paddingRight ?? props.paddingX ?? props.padding)
  const margin = num(props.marginLeft ?? props.marginX ?? props.margin) + num(props.marginRight ?? props.marginX ?? props.margin)
  const border = typeof props.borderStyle === 'string' ? 2 : 0
  return inner + padding + margin + border
}

/**
 * The height of a tree in rows when laid out `columns` wide: a column Box
 * stacks its children, a row Box takes the tallest, a Text wraps at the
 * width it is given, padding, margin and a border add above and below. A
 * `Client` is measured by what its module drew, from `clients`.
 */
export const layoutHeightOf = (
  tree: unknown,
  columns: number,
  clients: Readonly<Record<string, unknown>> = {},
): number => {
  const node = tree as Node
  if (typeof node === 'string' || typeof node === 'number') {
    return Math.max(1, Math.ceil(widthOf(String(node)) / Math.max(1, columns)))
  }
  if (typeof node !== 'object' || node === null) {
    return 0
  }
  const props = node.props ?? {}
  if (node.type === 'Text') {
    return Math.max(1, Math.ceil(widthOf(textsOf(node).join('')) / Math.max(1, columns)))
  }
  if (node.type === 'Button') {
    return 1
  }
  if (node.type === 'Client') {
    return layoutHeightOf(clients[String(props.key)], columns, clients)
  }
  if (props.display === 'none') {
    return 0
  }
  const padX = num(props.paddingLeft ?? props.paddingX ?? props.padding) + num(props.paddingRight ?? props.paddingX ?? props.padding)
  const border = typeof props.borderStyle === 'string' ? 2 : 0
  const inner = Math.max(1, columns - padX - border)
  const heights = childrenOf(node).map(child => {
    const childProps = typeof child === 'object' && child !== null ? (child.props ?? {}) : {}
    const margin = num(childProps.marginTop ?? childProps.marginY ?? childProps.margin) + num(childProps.marginBottom ?? childProps.marginY ?? childProps.margin)
    return layoutHeightOf(child, inner, clients) + margin
  })
  const isColumn = props.flexDirection === 'column' || props.flexDirection === 'column-reverse'
  const body = isColumn ? heights.reduce((a, b) => a + b, 0) : Math.max(0, ...heights)
  const padY = num(props.paddingTop ?? props.paddingY ?? props.padding) + num(props.paddingBottom ?? props.paddingY ?? props.padding)
  return body + padY + border
}
