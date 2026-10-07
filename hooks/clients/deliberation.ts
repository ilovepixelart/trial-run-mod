import type { ClientModule } from 'claude-code'

import { gaugeOf } from '../gauge'

type Props = { deadlineMs: number; cells: number; color: string }
type State = { ticks: number }

/**
 * One frame of the countdown, in milliseconds.
 */
const TICK_MS = 150

/**
 * The court's deadline as a bar that fills and the seconds left beside it,
 * on the drawing's own frame clock, so the hooks module redraws nothing
 * while it moves.
 */
const Deliberation: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ ticks: 0 })
    surface.every(TICK_MS, () => surface.setState({ ticks: (surface.state?.ticks ?? 0) + 1 }))
  }
  const elapsed = (surface.state?.ticks ?? 0) * TICK_MS
  const { filled, track } = gaugeOf(elapsed / props.deadlineMs, props.cells)
  const left = Math.max(0, Math.ceil((props.deadlineMs - elapsed) / 1000))
  return Box({
    children: [
      Box({ key: 'filled', children: [Text({ color: props.color, children: filled })] }),
      Text({ dimColor: true, children: track }),
      Text({ children: '  ' }),
      Box({ key: 'left', children: [Text({ dimColor: true, children: `${left}s left` })] }),
    ],
  })
}

export default Deliberation
