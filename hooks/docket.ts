import { contemptKeyOf } from './contempt'
import { isSameMaterial } from './exhibits'
import type { MaterialFacts } from './exhibits'
import { isSimpleCommand } from './risky'

/**
 * One case the court has heard, as the docket keeps it.
 */
export type CaseRecord = {
  number: number
  command: string
  charge: string
  verdict: 'guilty' | 'acquitted' | 'hung' | 'waived' | 'contempt'
  /**
   * When the court ruled, in milliseconds since the epoch.
   */
  at: number
  /**
   * Since layout 2, for a simple command line only: the project root the
   * case was heard in and the facts that matter for precedent. A case
   * without them sets no precedent.
   */
  root?: string
  facts?: MaterialFacts
  /**
   * The case an acquittal by precedent cites.
   */
  precedent?: number
  /**
   * The conviction this case heard on appeal.
   */
  appeal?: number
}

export type RapSheetLine = { charge: string; count: number }

export type Docket = {
  total: number
  /**
   * Guilty over guilty plus acquitted, 0 to 1; a mistrial is no ruling.
   */
  convictionRate: number
  /**
   * The newest cases, newest first.
   */
  recent: CaseRecord[]
  /**
   * The latest verdicts, oldest first.
   */
  strip: CaseRecord['verdict'][]
  rapSheet: RapSheetLine[]
  mostWanted: string | undefined
}

/**
 * The layout of the saved docket this version writes, saved beside the
 * cases. Bump it when a saved field changes meaning.
 */
export const DOCKET_LAYOUT = 2

/**
 * Whether this version can read a docket saved under a layout: one saved
 * before layouts were recorded, an older layout (layout 1 cases read as
 * they are, without the fields layout 2 added), or this layout. A newer
 * layout is left untouched, never read and never overwritten.
 */
export const isReadableLayout = (stored: unknown): boolean =>
  stored === undefined || stored === null || (typeof stored === 'number' && stored <= DOCKET_LAYOUT)

/**
 * How many cases the docket keeps: the newest, by number.
 */
export const DOCKET_CAP = 200

const COMMAND_CHARS = 80
const RECENT = 6
const STRIP = 30
const RAP_SHEET = 3

/**
 * The docket with one more case filed under the next number.
 *
 * @param history the cases so far, oldest first
 * @param filing the case, without its number
 */
export const fileCase = (history: readonly CaseRecord[], filing: Omit<CaseRecord, 'number'>): CaseRecord[] => {
  const number = (history.at(-1)?.number ?? 0) + 1
  const filed = { ...filing, number, command: filing.command.slice(0, COMMAND_CHARS) }
  return [...history, filed].slice(-DOCKET_CAP)
}

/**
 * The number the next case is filed under.
 */
export const nextCaseNumber = (history: readonly CaseRecord[]): number => (history.at(-1)?.number ?? 0) + 1

/**
 * A guilty verdict, or contempt: a convicted command retried.
 */
const isConviction = (c: CaseRecord) => c.verdict === 'guilty' || c.verdict === 'contempt'

/**
 * Whether a case's command can stand for a whole command line: a simple
 * one, kept whole (shorter than the cut), so its key is read off the
 * command itself and nothing else a stored record claims.
 */
const isWholeSimple = (command: string) => command.length < COMMAND_CHARS && isSimpleCommand(command)

/**
 * The acquittal that binds a command line as precedent: the latest ruling
 * (guilty, acquitted or contempt) on the same simple command line in the
 * same project root, when it acquitted on the same facts that matter. A
 * line that is not one simple command never has precedent.
 *
 * @param history the cases so far, oldest first
 * @param sought the whole command line, the project root and the facts now
 */
export const precedentOf = (
  history: readonly CaseRecord[],
  sought: { command: string; root: string; facts: MaterialFacts },
): CaseRecord | undefined => {
  if (!isSimpleCommand(sought.command)) {
    return undefined
  }
  const key = contemptKeyOf(sought.command)
  const last = history.findLast(
    c =>
      c.root === sought.root &&
      (c.verdict === 'acquitted' || isConviction(c)) &&
      isWholeSimple(c.command) &&
      contemptKeyOf(c.command) === key,
  )
  return last?.verdict === 'acquitted' && isSameMaterial(last.facts ?? {}, sought.facts) ? last : undefined
}

/**
 * Prior convictions on one charge.
 */
export const priorsOf = (history: readonly CaseRecord[], charge: string): number =>
  history.filter(c => c.charge === charge && isConviction(c)).length

/**
 * What `/court docket` shows, from the cases the court has heard.
 */
export const docketOf = (history: readonly CaseRecord[]): Docket => {
  const guilty = history.filter(isConviction)
  const ruled = guilty.length + history.filter(c => c.verdict === 'acquitted').length
  const counts = new Map<string, number>()
  for (const c of guilty) {
    counts.set(c.charge, (counts.get(c.charge) ?? 0) + 1)
  }
  const rapSheet = [...counts]
    .map(([charge, count]) => ({ charge, count }))
    .toSorted((a, b) => b.count - a.count)
    .slice(0, RAP_SHEET)
  return {
    total: history.length,
    convictionRate: ruled === 0 ? 0 : guilty.length / ruled,
    recent: history.slice(-RECENT).toReversed(),
    strip: history.slice(-STRIP).map(c => c.verdict),
    rapSheet,
    mostWanted: rapSheet[0]?.charge,
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Stored facts as far as they read as facts: a whole count, and tracked
 * states that are booleans.
 */
const factsRead = (stored: unknown): MaterialFacts | undefined => {
  if (!isObject(stored)) {
    return undefined
  }
  const { behind, tracked } = stored
  return {
    ...(Number.isInteger(behind) && (behind as number) >= 0 ? { behind: behind as number } : {}),
    ...(isObject(tracked)
      ? { tracked: Object.fromEntries(Object.entries(tracked).filter(([, value]) => typeof value === 'boolean')) as Record<string, boolean> }
      : {}),
  }
}

/**
 * The cases a stored value holds, or none when it is not a docket. The
 * store is a shared file, so a record is read as untrusted: the fields
 * this version knows, each of its type, and nothing else.
 */
export const casesOf = (stored: unknown): CaseRecord[] =>
  Array.isArray(stored)
    ? stored
        .filter(
          (c): c is CaseRecord =>
            typeof c === 'object' &&
            c !== null &&
            typeof c.number === 'number' &&
            typeof c.command === 'string' &&
            typeof c.charge === 'string' &&
            (c.verdict === 'guilty' ||
              c.verdict === 'acquitted' ||
              c.verdict === 'hung' ||
              c.verdict === 'waived' ||
              c.verdict === 'contempt'),
        )
        .map(c => {
          const facts = factsRead(c.facts)
          return {
            number: c.number,
            command: c.command,
            charge: c.charge,
            verdict: c.verdict,
            at: c.at,
            ...(typeof c.root === 'string' ? { root: c.root } : {}),
            ...(facts === undefined ? {} : { facts }),
            ...(typeof c.precedent === 'number' ? { precedent: c.precedent } : {}),
            ...(typeof c.appeal === 'number' ? { appeal: c.appeal } : {}),
          }
        })
    : []
