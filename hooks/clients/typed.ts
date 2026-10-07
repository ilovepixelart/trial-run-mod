import type { ClientModule } from 'claude-code'

import { MS_PER_CHAR } from '../pace'

type Props = { text: string }
type State = { chars: number }

const TICK_MS = 20
const CHARS_PER_TICK = TICK_MS / MS_PER_CHAR

/**
 * A speech typed out as it is delivered, at the pace the hooks module plans
 * the trial by, on the drawing's own frame clock. Stops its timer once the
 * speech is whole.
 */
const Typed: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ chars: 0 })
    const stop = surface.every(TICK_MS, () => {
      const chars = (surface.state?.chars ?? 0) + CHARS_PER_TICK
      surface.setState({ chars })
      if (chars >= props.text.length) {
        stop()
      }
    })
  }
  return Text({ children: props.text.slice(0, surface.state?.chars ?? 0) })
}

export default Typed
