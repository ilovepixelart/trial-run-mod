import type { ClientModule } from 'claude-code'

import { landingFrameOf, segmentsOf } from '../stamp'
import type { StampColors } from '../stamp'

type Props = { rows: string[]; starts: number[]; width: number } & StampColors
type State = { step: number }

const FRAME_MS = 40

/**
 * The verdict landing: it drops in from above, overshoots one row, shakes
 * one column as it lands wet with ink, and dries. One colour throughout: it
 * never flashes.
 */
const Entrance: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ step: 0 })
    const stop = surface.every(FRAME_MS, () => {
      const step = (surface.state?.step ?? 0) + 1
      surface.setState({ step })
      if (landingFrameOf(props.rows, step).isLast) {
        stop()
      }
    })
  }
  const frame = landingFrameOf(props.rows, surface.state?.step ?? 0)
  return Box({
    flexDirection: 'column',
    children: frame.rows.map(row =>
      Box({ children: segmentsOf(row, Infinity, props).map(run => Text({ color: run.color, children: run.text })) }),
    ),
  })
}

export default Entrance
