import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { On } from 'claude-code'

import { clientKeysOf, isSafeGlyph, layoutHeightOf, layoutWidthOf, nodeCount, textsOf } from './fixtures/art'
import { refused, said, seatCourt, verdictBench } from './fixtures/court'
import { BAND_SITE, DOCKET_SITE, PANE_SITE } from './fixtures/sites'

tier('user')

const GUILTY = 'VERDICT: GUILTY\nREASON: it erases the whole home folder'
const ACQUITTED = 'VERDICT: NOT GUILTY\nREASON: only a build folder'
const check = (command: string) => ({ tool: 'Bash', input: { command } })

/**
 * What the art tests read off a mounted drawing.
 */
type Mount = { drawn: (scope?: { in: string }) => Promise<unknown> }

/**
 * A drawing as plain data with each Client's own tree beside it.
 */
const snapshotOf = async (pane: Mount) => {
  const tree = await pane.drawn()
  const clients: Record<string, unknown> = {}
  for (const key of clientKeysOf(tree)) {
    clients[key] = await pane.drawn({ in: key })
  }
  return { tree, clients }
}

const VERDICTS = { guilty: GUILTY, acquitted: ACQUITTED, hung: undefined } as const

/**
 * Seats a court whose judge rules `kind` (a refused judge is a mistrial).
 */
const seatRuling = (on: On, kind: keyof typeof VERDICTS) => {
  const judge = VERDICTS[kind]
  seatCourt(on, {
    reply: role => (role === 'judge' ? (judge === undefined ? refused : said(judge)) : said('Words for the court.')),
  })
}

const docketOf200 = Array.from({ length: 200 }, (_, i) => ({
  number: i + 1,
  command: `git push --force origin feature/branch-number-${i}`,
  charge: ['force push', 'recursive delete', 'hard reset', 'terraform destroy'][i % 4],
  verdict: (['guilty', 'acquitted', 'hung', 'waived'] as const)[i % 4],
  at: i,
}))

describe('art', () => {
  for (const rows of [8, 10, 12]) {
    test(`the docket above the prompt in ${rows} rows keeps the rate, the latest cases, the strip and the most wanted`, async ($, on) => {
      mock.store(on, { cases: docketOf200 })
      const inline = (bodyRows: number) => ({
        ...DOCKET_SITE,
        surface: 'terminal' as const,
        props: { ...DOCKET_SITE.props, bodyColumns: 76, placement: 'inline' as const, scroll: { offset: 0, bodyRows } },
      })
      const short = await $.ui.mount(inline(rows))
      const drawn = await snapshotOf(short)
      expect(layoutHeightOf(drawn.tree, 76, drawn.clients)).toBeLessThanOrEqual(rows)
      expect(await short.find({ text: /Conviction rate/ })).toBeDefined()
      expect(await short.find({ text: /^#0200/ })).toBeDefined()
      expect(await short.find({ text: /^Most wanted: / })).toBeDefined()
      expect(textsOf(drawn.tree).join('')).toMatch(/[✕·?] [✕·?]/)
      await short.unmount()

      // the floor: with room, the docket draws its full height, which would not fit
      const roomy = await $.ui.mount(inline(40))
      const full = await snapshotOf(roomy)
      expect(layoutHeightOf(full.tree, 76, full.clients)).toBeGreaterThan(rows)
    })
  }

  test('every court screen draws its own frame docked and none inline, where the engine frames it', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on, { cases: docketOf200.slice(0, 5) })
    seatCourt(on, verdictBench(GUILTY))
    const rootBorder = async (site: object) => {
      const drawn = await $.ui.mount(site as typeof PANE_SITE & { surface: 'terminal' })
      const border = ((await drawn.drawn()) as { props?: { borderStyle?: unknown } }).props?.borderStyle
      await drawn.unmount()
      return border
    }
    const at = (base: typeof PANE_SITE | typeof DOCKET_SITE, placement: 'dock' | 'inline') => ({
      ...base,
      surface: 'terminal' as const,
      props: { ...base.props, placement, scroll: { offset: 0, bodyRows: 40 } },
    })

    for (const base of [PANE_SITE, DOCKET_SITE]) {
      expect(await rootBorder(at(base, 'dock')), `${base.requestId} docked`).toBe('round')
      expect(await rootBorder(at(base, 'inline')), `${base.requestId} inline`).toBeUndefined()
    }
    await $.tool.check(check('rm -rf ~'))
    await clock.advance(8_000)
    expect(await rootBorder(at(PANE_SITE, 'dock')), 'trial docked').toBe('round')
    expect(await rootBorder(at(PANE_SITE, 'inline')), 'trial inline').toBeUndefined()
  })

  for (const rows of [10, 12, 16]) {
    test(`the court above the prompt in ${rows} rows tells the whole case: verdict, charge and every speaker`, async ($, on) => {
      const clock = mock.clock(on)
      seatCourt(on, {
        reply: async role => {
          if (role === 'judge') {
            await clock.sleep(3_000)
          }
          return verdictBench(GUILTY).reply(role)
        },
      })
      const inline = (bodyRows: number) => ({
        ...PANE_SITE,
        surface: 'terminal' as const,
        props: { ...PANE_SITE.props, bodyColumns: 76, placement: 'inline' as const, scroll: { offset: 0, bodyRows } },
      })

      const pending = $.tool.check(check('git push --force origin main'))
      await clock.settle()
      const short = await $.ui.mount(inline(rows))
      const deliberating = await snapshotOf(short)
      expect(layoutHeightOf(deliberating.tree, 76, deliberating.clients), 'deliberating').toBeLessThanOrEqual(rows)
      expect(await short.find({ text: /^THE PEOPLE v\. git push --force origin main$/ })).toBeDefined()
      expect(await short.find({ key: 'object' })).toBeDefined()
      // inline, the engine frames the pane: the court draws no second frame inside it
      expect((deliberating.tree as { props?: { borderStyle?: unknown } }).props?.borderStyle).toBeUndefined()

      await clock.advance(3_000)
      await pending
      await clock.advance(6_000)
      const ruled = await snapshotOf(short)
      const said = textsOf(ruled.tree).join('\n')
      expect(layoutHeightOf(ruled.tree, 76, ruled.clients), 'ruled').toBeLessThanOrEqual(rows)
      expect(said).toMatch(/✕ GUILTY/)
      for (const speaker of ['PROSECUTION', 'DEFENSE', 'THE COURT']) {
        expect(said, speaker).toContain(speaker)
      }

      // the floor: with room, the court draws its full height, which would not fit
      await short.unmount()
      const roomy = await $.ui.mount(inline(40))
      const full = await snapshotOf(roomy)
      expect(layoutHeightOf(full.tree, 76, full.clients)).toBeGreaterThan(rows)
    })
  }

  for (const columns of [36, 58, 80, 100, 120]) {
    // the measure must see the art: its floor is the header's width at this pane
    const floor = Math.min(40, columns - 12)
    test(`every state of the court pane fits ${columns} columns`, async ($, on) => {
      const clock = mock.clock(on)
      seatCourt(on, {
        reply: async role => {
          if (role === 'judge') {
            await clock.sleep(3_000)
          }
          return verdictBench(GUILTY).reply(role)
        },
      })
      const site = { ...PANE_SITE, surface: 'terminal' as const, props: { ...PANE_SITE.props, bodyColumns: columns } }

      const pending = $.tool.check(check('git push --force origin main'))
      await clock.settle()
      const pane = await $.ui.mount(site)
      const widths: number[] = []
      const measure = async () => {
        const { tree, clients } = await snapshotOf(pane)
        widths.push(layoutWidthOf(tree, clients))
      }
      await measure()
      await pane.advance(2_000)
      await measure()
      await clock.advance(700)
      await measure()
      await clock.advance(2_300)
      await pending
      await clock.advance(1_000)
      await measure()
      await clock.advance(1_000)
      await measure()

      // the measure sees the art: every state is wider than its scales and header alone
      expect(Math.min(...widths)).toBeGreaterThan(floor)
      expect(Math.max(...widths)).toBeLessThanOrEqual(columns)
    })

    test(`the deliberating court fits ${columns} columns`, async ($, on) => {
      const clock = mock.clock(on)
      seatCourt(on, {
        reply: async () => {
          await clock.sleep(60_000)
          return said(GUILTY)
        },
      })
      const pending = $.tool.check(check('git push --force origin main'))
      await clock.settle()
      const pane = await $.ui.mount({
        ...PANE_SITE,
        surface: 'terminal',
        props: { ...PANE_SITE.props, bodyColumns: columns },
      })
      expect(await pane.find({ type: 'Client', key: 'deliberation' })).toBeDefined()
      for (const ms of [0, 4_500, 9_000]) {
        await pane.advance(ms)
        const { tree, clients } = await snapshotOf(pane)
        const width = layoutWidthOf(tree, clients)
        expect(width).toBeGreaterThan(floor)
        expect(width, `${ms}ms`).toBeLessThanOrEqual(columns)
      }

      await clock.advance(9_000)
      await pending
    })

    for (const kind of ['guilty', 'acquitted', 'hung'] as const) {
      test(`the ${kind} stamp fits ${columns} columns`, async ($, on) => {
        const clock = mock.clock(on)
        seatRuling(on, kind)
        await $.tool.check(check('rm -rf build'))
        await clock.advance(8_000)
        const pane = await $.ui.mount({
          ...PANE_SITE,
          surface: 'terminal',
          props: { ...PANE_SITE.props, bodyColumns: columns },
        })
        // where even the compact letters would wrap there is no stamp, and the headline says the verdict
        expect((await pane.find({ key: 'stamp' })) ?? (await pane.find({ text: /^(✕ GUILTY|✓ NOT GUILTY|\? MISTRIAL)\./ }))).toBeDefined()
        const { tree, clients } = await snapshotOf(pane)
        expect(layoutWidthOf(tree, clients)).toBeLessThanOrEqual(columns)
      })
    }

    test(`the sentence fits ${columns} columns`, async ($, on) => {
      const clock = mock.clock(on)
      seatRuling(on, 'guilty')
      await $.tool.check(check('kubectl --context prod-eu-west delete namespace checkout-service'))
      await clock.advance(8_000)
      const pane = await $.ui.mount({
        ...PANE_SITE,
        surface: 'terminal',
        props: { ...PANE_SITE.props, bodyColumns: columns },
      })
      expect(await pane.find({ type: 'Text', text: /^SENTENCE$/ })).toBeDefined()
      const { tree, clients } = await snapshotOf(pane)
      expect(layoutWidthOf(tree, clients)).toBeLessThanOrEqual(columns)
    })

    test(`the contempt stamp fits ${columns} columns`, async ($, on) => {
      const clock = mock.clock(on)
      mock.store(on)
      seatRuling(on, 'guilty')
      await $.tool.check(check('rm -rf build'))
      await clock.advance(8_000)
      await $.tool.check(check('rm -rf build'))
      await clock.advance(8_000)
      const pane = await $.ui.mount({
        ...PANE_SITE,
        surface: 'terminal',
        props: { ...PANE_SITE.props, bodyColumns: columns },
      })
      expect((await pane.find({ key: 'stamp' })) ?? (await pane.find({ text: /^✕ CONTEMPT\./ }))).toBeDefined()
      const { tree, clients } = await snapshotOf(pane)
      expect(layoutWidthOf(tree, clients)).toBeLessThanOrEqual(columns)
    })

    test(`the docket of 200 cases fits ${columns} columns`, async ($, on) => {
      mock.store(on, { cases: docketOf200 })
      const pane = await $.ui.mount({
        ...DOCKET_SITE,
        surface: 'terminal',
        props: { ...DOCKET_SITE.props, bodyColumns: columns },
      })
      const width = layoutWidthOf(await pane.drawn())
      expect(width).toBeGreaterThan(Math.min(50, columns - 12))
      expect(width).toBeLessThanOrEqual(columns)
    })
  }

  const longCharges = ['dropped or truncated data', 'terraform destroy', 'recursive delete']
  const docketOfLongCharges = longCharges.flatMap((charge, k) =>
    Array.from({ length: 3 - k }, (_, i) => ({
      number: k * 3 + i + 1,
      command: 'psql -c "DROP TABLE users"',
      charge,
      verdict: 'guilty' as const,
      at: k * 3 + i,
    })),
  )

  for (const columns of [36, 58, 80, 100, 120]) {
    test(`the rap sheet names every charge in full at ${columns} columns`, async ($, on) => {
      mock.store(on, { cases: docketOfLongCharges })
      const pane = await $.ui.mount({
        ...DOCKET_SITE,
        surface: 'terminal',
        props: { ...DOCKET_SITE.props, bodyColumns: columns },
      })
      for (const charge of longCharges) {
        expect(await pane.find({ text: new RegExp(`^${charge}\\s*$`) }), `${charge} at ${columns}`).toBeDefined()
      }
      expect(layoutWidthOf(await pane.drawn())).toBeLessThanOrEqual(columns)
    })
  }

  test('the empty docket and the empty court fit a 36 column pane', async ($, on) => {
    mock.store(on)
    for (const site of [DOCKET_SITE, PANE_SITE]) {
      const pane = await $.ui.mount({ ...site, surface: 'terminal', props: { ...site.props, bodyColumns: 36 } })
      expect(layoutWidthOf(await pane.drawn())).toBeLessThanOrEqual(36)
    }
  })

  test('nothing the court draws uses a glyph outside the safe set', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on, { cases: docketOf200 })
    seatCourt(on, {
      reply: async role => {
        if (role === 'judge') {
          await clock.sleep(3_000)
        }
        return verdictBench(GUILTY).reply(role)
      },
    })
    const pending = $.tool.check(check('git push --force origin main'))
    await clock.settle()
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    const band = await $.ui.mount({ ...BAND_SITE, surface: 'terminal' })
    const drawn: string[] = []
    const collect = async () => {
      for (const site of [pane, band]) {
        const { tree, clients } = await snapshotOf(site)
        drawn.push(...textsOf(tree), ...Object.values(clients).flatMap(textsOf))
      }
    }
    await collect()
    await pane.advance(600)
    await collect()
    await clock.advance(3_000)
    await pending
    await clock.advance(1_000)
    await pane.advance(40)
    await collect()
    await clock.advance(1_000)
    await collect()
    const docket = await $.ui.mount({ ...DOCKET_SITE, surface: 'terminal' })
    drawn.push(...textsOf(await docket.drawn()))

    expect(drawn.join('')).toContain('THE PEOPLE v.')
    expect(drawn.join('')).toContain('━━━━━━━━━━╋')
    expect(drawn.join('')).toContain('RAP SHEET')
    const unsafe = [...new Set([...drawn.join('')].filter(char => !isSafeGlyph(char)))]
    expect(unsafe).toEqual([])
  })

  test('a contempt reads as a glyph and a word in the pane and the band, not colour alone', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    seatRuling(on, 'guilty')
    await $.tool.check(check('rm -rf build'))
    await clock.advance(8_000)
    await $.tool.check(check('rm -rf build'))
    await clock.advance(8_000)

    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    expect(await pane.find({ type: 'Text', text: /✕ CONTEMPT/ })).toBeDefined()
    const band = await $.ui.mount({ ...BAND_SITE, surface: 'terminal' })
    expect(await band.find({ type: 'Text', text: /✕ CONTEMPT/ })).toBeDefined()
  })

  for (const [kind, mark] of [
    ['guilty', /✕ GUILTY/],
    ['acquitted', /✓ NOT GUILTY/],
    ['hung', /\? MISTRIAL/],
  ] as const) {
    test(`a ${kind} verdict reads as a glyph and a word in the pane and the band, not colour alone`, async ($, on) => {
      const clock = mock.clock(on)
      seatRuling(on, kind)
      await $.tool.check(check('rm -rf build'))
      await clock.advance(8_000)

      const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
      expect(await pane.find({ type: 'Text', text: mark })).toBeDefined()
      const band = await $.ui.mount({ ...BAND_SITE, surface: 'terminal' })
      expect(await band.find({ type: 'Text', text: mark })).toBeDefined()
    })
  }

  test('every case on the docket carries its verdict as a glyph and a word', async ($, on) => {
    mock.store(on, { cases: docketOf200.slice(0, 6) })
    const pane = await $.ui.mount({ ...DOCKET_SITE, surface: 'terminal' })
    const rows = (await pane.findAll({ type: 'Box', text: /^#\d{4} (✕ GUILTY|✓ NOT GUILTY|\? MISTRIAL|- WAIVED) +\S[^#]*$/ })).map(row => row.text)

    expect(rows).toHaveLength(6)
    for (const row of rows) {
      expect(row).toMatch(/✕ .*GUILTY|✓ .*NOT GUILTY|\? .*MISTRIAL|- .*WAIVED/)
    }
  })

  test('the docket of 200 cases stays far under the engine node limit', async ($, on) => {
    mock.store(on, { cases: docketOf200 })
    const pane = await $.ui.mount({ ...DOCKET_SITE, surface: 'terminal' })

    expect(nodeCount(await pane.drawn())).toBeLessThan(600)
  })

  test('body text takes no colour, so the terminal foreground reads on light and dark themes', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on, { cases: docketOf200.slice(0, 8) })
    seatCourt(on, verdictBench(GUILTY))
    await $.tool.check(check('git push --force origin main'))
    await clock.advance(8_000)

    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    const docket = await $.ui.mount({ ...DOCKET_SITE, surface: 'terminal' })
    const body = [
      await pane.find({ type: 'Text', text: /^THE PEOPLE v\./ }),
      await pane.find({ type: 'Text', text: 'It destroys work.' }),
      await pane.find({ type: 'Text', text: 'It is a build folder.' }),
      await docket.find({ type: 'Text', text: /^Conviction rate/ }),
      await docket.find({ type: 'Text', text: /^git push --force origin feature/ }),
    ]

    expect(body.every(text => text !== undefined)).toBe(true)
    expect(body.map(text => text?.props.color)).toEqual(body.map(() => undefined))
  })
})

