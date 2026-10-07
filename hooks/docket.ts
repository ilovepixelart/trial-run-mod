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

/**
 * The cases a stored value holds, or none when it is not a docket.
 */
export const casesOf = (stored: unknown): CaseRecord[] =>
  Array.isArray(stored)
    ? stored.filter(
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
    : []
