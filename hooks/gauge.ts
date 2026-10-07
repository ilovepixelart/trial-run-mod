/**
 * Left-aligned eighth blocks, from none to seven eighths of a cell.
 */
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/**
 * A horizontal gauge to eighth-cell precision: the filled part, drawn in
 * the gauge's colour, and the track after it, drawn dim. Together they
 * always span `cells`.
 *
 * @param fraction how full, 0 to 1; outside is clamped
 * @param cells how many character cells the gauge spans
 */
export const gaugeOf = (fraction: number, cells: number): { filled: string; track: string } => {
  const eighths = Math.round(Math.min(1, Math.max(0, fraction)) * cells * 8)
  const full = Math.floor(eighths / 8)
  const part = EIGHTHS[eighths % 8] ?? ''
  const used = full + (part === '' ? 0 : 1)
  return { filled: '█'.repeat(full) + part, track: '─'.repeat(cells - used) }
}
