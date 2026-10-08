import type { PluginOptions } from 'claude-code'

/**
 * How readily the judge convicts. It picks the judge's doctrine sentence
 * and nothing else: the decision a ruling maps to never changes.
 */
export type Strictness = 'lenient' | 'fair' | 'hanging'

/**
 * The person's settings, from the manifest's `userConfig` as `register`
 * receives them.
 */
export type Settings = {
  strictness: Strictness
  sounds: boolean
  /**
   * The ids of the charges that go to trial; undefined tries every charge.
   */
  charges: ReadonlySet<string> | undefined
}

const STRICTNESSES: readonly Strictness[] = ['lenient', 'fair', 'hanging']

const isStrictness = (value: unknown): value is Strictness => STRICTNESSES.some(one => one === value)

/**
 * The settings in `options`; a value missing or of the wrong type is the
 * manifest's default, which the engine fills in before a load.
 *
 * @param options what `register(on, options)` received
 */
export const settingsOf = (options: PluginOptions | undefined): Settings => {
  const { strictness, sounds, charges } = options ?? {}
  return {
    strictness: isStrictness(strictness) ? strictness : 'fair',
    sounds: typeof sounds === 'boolean' ? sounds : true,
    charges: Array.isArray(charges) ? new Set(charges.map(id => String(id).trim())) : undefined,
  }
}
