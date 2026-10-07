import type { ClientModule } from 'claude-code'

import { SCALES } from '../stamp'

type Props = { color: string }
type State = { tick: number }

/**
 * How long the pans hold each position while the jury deliberates: within
 * the shortest deliberation they tip one way, the other, and back.
 */
const BOB_MS = 450

/**
 * The scales of justice: level, then the pans tipping one way and the other
 * while the jury deliberates, on the drawing's own frame clock.
 */
const Scales: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ tick: 0 })
    surface.every(BOB_MS, () => surface.setState({ tick: (surface.state?.tick ?? 0) + 1 }))
  }
  const tick = surface.state?.tick ?? 0
  const position = tick === 0 ? 'level' : tick % 2 === 1 ? 'left' : 'right'
  return Box({
    flexDirection: 'column',
    children: SCALES[position].map(row => Text({ color: props.color, children: row })),
  })
}

export default Scales
