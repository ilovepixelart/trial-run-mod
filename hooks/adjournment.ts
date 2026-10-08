import type { CourtVerdict } from '../types'

/**
 * How many cases of each verdict the court heard in one turn.
 */
export type Tally = Record<CourtVerdict['kind'], number>

/**
 * A turn's tally before its first case.
 */
export const emptyTally = (): Tally => ({ guilty: 0, acquitted: 0, hung: 0, waived: 0, contempt: 0 })

const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/**
 * The line the court adjourns a turn with, contempt counted as a conviction
 * and mistrials and waivers named only when there were any; undefined for a
 * turn that heard no case.
 *
 * @param tally the turn's cases
 */
export const adjournmentOf = (tally: Tally): string | undefined => {
  if (Object.values(tally).every(count => count === 0)) {
    return undefined
  }
  const parts = [
    counted(tally.guilty + tally.contempt, 'conviction', 'convictions'),
    counted(tally.acquitted, 'acquittal', 'acquittals'),
    ...(tally.hung === 0 ? [] : [counted(tally.hung, 'mistrial', 'mistrials')]),
    ...(tally.waived === 0 ? [] : [`${tally.waived} waived`]),
  ]
  return `Court adjourned. ${parts.join(', ')} this turn.`
}
