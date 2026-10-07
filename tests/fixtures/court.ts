import type { ModelCompleteResult, On, ResultOf, SessionMessage } from 'claude-code'

/**
 * Who speaks in a trial, as the plugin's system prompts name them.
 */
export type Role = 'prosecutor' | 'defense' | 'judge'

/**
 * How the world beneath the court answers: each role's reply (a value, or
 * a promise for a late or failing one) and the session's own verdict.
 */
export type Bench = {
  reply: (role: Role) => ModelCompleteResult | Promise<ModelCompleteResult>
  beneath?: ResultOf['tool.check']
  /**
   * The transcript the court reads its evidence from; empty when absent.
   */
  messages?: SessionMessage[]
  /**
   * Whether the court's pane is drawn when opened; a narrow terminal leaves
   * a pane the plugin opens on its own undrawn. Placed when absent.
   */
  placed?: boolean
}

/**
 * What the world beneath saw: each model call by role, and every pane opened.
 */
export type Record = {
  calls: Role[]
  prompts: Partial<{ [role in Role]: string }>
  opened: string[]
}

const ZERO = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

/**
 * A reply the model gave.
 */
export const said = (text: string): ModelCompleteResult => ({
  isAnswered: true,
  text,
  usage: ZERO,
})

/**
 * A reply the API refused.
 */
export const refused: ModelCompleteResult = {
  isAnswered: false,
  reason: 'api-error',
  status: 529,
  error: 'overloaded',
  usage: ZERO,
}

const roleOf = (system: string): Role =>
  system.includes('PROSECUTOR') ? 'prosecutor' : system.includes('DEFENSE') ? 'defense' : 'judge'

/**
 * Seats the world beneath the court: the model, the session's verdict, the
 * transcript, panes and sound.
 *
 * @param on the test's `on`
 * @param bench how it answers
 * @returns what it saw
 */
export const seatCourt = (on: On, bench: Bench): Record => {
  const record: Record = { calls: [], prompts: {}, opened: [] }
  on('model.complete', async ($, e) => {
    const role = roleOf(e.system ?? '')
    record.calls.push(role)
    record.prompts[role] = e.prompt
    return { value: await bench.reply(role) }
  })
  on('tool.check', () => bench.beneath ?? { decision: 'allow' })
  on('session.messages', () => ({ value: bench.messages ?? [] }))
  on('ui.open', ($, e) => {
    record.opened.push(e.id)
    return {
      value: bench.placed === false ? { isPlaced: false as const, reason: 'below 144 columns' } : { isPlaced: true as const },
    }
  })
  on('audio.play', () => ({ value: undefined }))
  on('audio.speak', () => ({ value: { via: 'system' } }))
  return record
}

/**
 * The bench a trial that reaches a verdict sits on.
 */
export const verdictBench = (judge: string, beneath?: ResultOf['tool.check']): Bench => ({
  reply: role =>
    said(role === 'judge' ? judge : role === 'prosecutor' ? 'It destroys work.' : 'It is a build folder.'),
  beneath,
})
