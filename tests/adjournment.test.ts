import { describe, expect, test, tier } from 'claude-code/testing'

import { adjournmentOf, emptyTally } from '../hooks/adjournment'

tier('user')

describe('adjournment line', () => {
  test('names convictions and acquittals, singular and plural', () => {
    const rows: [Partial<ReturnType<typeof emptyTally>>, string][] = [
      [{ guilty: 1, acquitted: 1 }, 'Court adjourned. 1 conviction, 1 acquittal this turn.'],
      [{ guilty: 2 }, 'Court adjourned. 2 convictions, 0 acquittals this turn.'],
      [{ acquitted: 3 }, 'Court adjourned. 0 convictions, 3 acquittals this turn.'],
      [{ guilty: 1, contempt: 1 }, 'Court adjourned. 2 convictions, 0 acquittals this turn.'],
      [{ hung: 1 }, 'Court adjourned. 0 convictions, 0 acquittals, 1 mistrial this turn.'],
      [{ hung: 2, waived: 1 }, 'Court adjourned. 0 convictions, 0 acquittals, 2 mistrials, 1 waived this turn.'],
    ]
    for (const [counts, line] of rows) {
      expect(adjournmentOf({ ...emptyTally(), ...counts }), line).toBe(line)
    }
  })

  test('a turn that heard no case has no line', () => {
    expect(adjournmentOf(emptyTally())).toBeUndefined()
  })
})
