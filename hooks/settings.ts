import type { PluginOptions } from 'claude-code'

import { CHARGE_IDS } from './risky'

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
  /**
   * What to tell the person about ids in `charges` the court does not know,
   * or undefined when it knows them all.
   */
  warning: string | undefined
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
    ...chargesOf(charges),
  }
}

/**
 * The charges switched on: the known ids listed. A list that names none the
 * court knows is a typo, not a wish to switch the court off, so it tries
 * every charge; only an empty list switches every charge off.
 */
const chargesOf = (charges: unknown): Pick<Settings, 'charges' | 'warning'> => {
  if (!Array.isArray(charges)) {
    return { charges: undefined, warning: undefined }
  }
  const ids = charges.map(id => String(id).trim())
  const known = new Set(ids.filter(id => CHARGE_IDS.includes(id)))
  const unknown = ids.filter(id => !known.has(id)).map(id => JSON.stringify(id)).join(', ')
  if (unknown === '') {
    return { charges: known, warning: undefined }
  }
  return known.size === 0
    ? { charges: undefined, warning: `trial-run: the charges setting names no charge the court knows (${unknown}), so every charge goes to trial.` }
    : { charges: known, warning: `trial-run: the charges setting names a charge the court does not know (${unknown}); it is left out.` }
}
