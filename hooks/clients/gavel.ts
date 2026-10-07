import type { ClientModule } from 'claude-code'

import { GAVEL } from '../stamp'

type Props = { color: string }
type State = { tick: number }

const TICK_MS = 70

/**
 * Ticks the gavel is held up before it falls, then the one between.
 */
const RAISED_TICKS = 7

/**
 * "ALL RISE.": the gavel held up, swung, and struck, once. Then it rests on
 * the strike; it never repeats.
 */
const Gavel: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ tick: 0 })
    const stop = surface.every(TICK_MS, () => {
      const tick = (surface.state?.tick ?? 0) + 1
      surface.setState({ tick })
      if (tick > RAISED_TICKS) {
        stop()
      }
    })
  }
  const tick = surface.state?.tick ?? 0
  const pose = tick < RAISED_TICKS ? 'raised' : tick === RAISED_TICKS ? 'swing' : 'struck'
  return Box({
    flexDirection: 'column',
    children: GAVEL[pose].map(row => Text({ color: props.color, children: row })),
  })
}

export default Gavel
