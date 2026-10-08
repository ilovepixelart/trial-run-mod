import { describe, expect, test, tier } from 'claude-code/testing'
import type { On } from 'claude-code'

import { isSafeGlyph, layoutWidthOf, textsOf } from './fixtures/art'
import { seatCourt, verdictBench } from './fixtures/court'
import { memoryStore } from './fixtures/store'

tier('user')

const GUILTY = 'VERDICT: GUILTY\nREASON: it erases the whole home folder'
const ACQUITTED = 'VERDICT: NOT GUILTY\nREASON: only a build folder'

/**
 * A docket that has heard sixteen cases, so the next is case #0017.
 */
const SIXTEEN = { layout: 2, cases: [{ number: 16, command: 'ls', charge: 'recursive delete', verdict: 'acquitted', at: 0 }] }

const call = (command: string, id: string) => ({ tool: 'Bash', input: { command }, tool_use_id: id })

/**
 * What Claude Code itself draws for a row: the test stands in for it.
 */
const ENGINE_ROW = { type: 'Text', props: {}, children: ['  ⎿  Error: Permission to use Bash denied'] }
const ENGINE_GROUP = { type: 'Text', props: {}, children: ['  Ran 2 shell commands'] }

const drawsEngine = (on: On) => {
  on('ui.render', { component: 'ToolResult' }, () => ENGINE_ROW as never)
  on('ui.render', { component: 'ToolUse' }, () => ENGINE_ROW as never)
  on('ui.render', { component: 'ToolGroup' }, () => ENGINE_GROUP as never)
}

const resultRow = (id: string, tool = 'Bash') => ({
  plugin: 'trial-run',
  component: 'ToolResult',
  requestId: id,
  props: { tool_use_id: id, tool, output: 'Permission to use Bash denied', isErrored: true },
}) as const

const groupCall = (id: string) => ({ tool_use_id: id, tool: 'Bash', input: {}, isRunning: false, isErrored: true, isInterrupted: false })

const groupOf = (ids: readonly string[], isExpanded = false) => ({
  plugin: 'trial-run',
  component: 'ToolGroup',
  requestId: 'group',
  props: { calls: ids.map(groupCall), isActive: false, isExpanded },
}) as const

const SURFACES = ['terminal', 'desktop'] as const

/**
 * The first child of a drawn tree: where the wrapped row stands.
 */
const firstChildOf = (tree: unknown) => ((tree as { children?: unknown[] }).children ?? [])[0]

describe('transcript', () => {
  test("a convicted call's row carries the stamp", async ($, on) => {
    memoryStore(on, SIXTEEN)
    seatCourt(on, verdictBench(GUILTY))
    drawsEngine(on)

    expect((await $.tool.check(call('rm -rf ~', 'toolu_17'))).decision).toBe('deny')

    for (const surface of SURFACES) {
      const row = await $.ui.mount({ ...resultRow('toolu_17'), surface })
      const drawn = await row.drawn()
      // wrapped, never replaced: Claude Code's own row first, whole
      expect(firstChildOf(drawn), surface).toEqual(ENGINE_ROW)
      expect(textsOf(drawn).join('\n'), surface).toBe(`${ENGINE_ROW.children[0]}\n✕ GUILTY · case #0017`)
      await row.unmount()
    }
  })

  test('a retried conviction is stamped as contempt with its own case', async ($, on) => {
    memoryStore(on, SIXTEEN)
    seatCourt(on, verdictBench(GUILTY))
    drawsEngine(on)

    await $.tool.check(call('rm -rf ~', 'toolu_17'))
    expect((await $.tool.check(call('rm -fr ~', 'toolu_18'))).reason).toContain('Contempt')

    const first = await $.ui.mount({ ...resultRow('toolu_17'), surface: 'terminal' })
    expect(await first.find({ text: '✕ GUILTY · case #0017' })).toBeDefined()
    await first.unmount()
    const retry = await $.ui.mount({ ...resultRow('toolu_18'), surface: 'terminal' })
    expect(await retry.find({ text: '✕ CONTEMPT · case #0018' })).toBeDefined()
    expect(await retry.find({ text: /GUILTY/ })).toBeUndefined()
  })

  test('a folded group that holds a convicted call carries the stamp', async ($, on) => {
    memoryStore(on, SIXTEEN)
    seatCourt(on, verdictBench(GUILTY))
    drawsEngine(on)

    await $.tool.check(call('ls', 'toolu_ls'))
    await $.tool.check(call('rm -rf ~', 'toolu_17'))

    for (const isExpanded of [false, true]) {
      const group = await $.ui.mount({ ...groupOf(['toolu_ls', 'toolu_17'], isExpanded), surface: 'terminal' })
      const drawn = await group.drawn()
      expect(firstChildOf(drawn)).toEqual(ENGINE_GROUP)
      expect(textsOf(drawn).join('\n')).toBe(`${ENGINE_GROUP.children[0]}\n✕ GUILTY · case #0017`)
      await group.unmount()
    }
  })

  test('an ordinary row is returned unchanged', async ($, on) => {
    memoryStore(on, SIXTEEN)
    seatCourt(on, verdictBench(ACQUITTED, { decision: 'ask', reason: 'mode' }))
    drawsEngine(on)

    // not charged, acquitted, and asked of the rules without a call id
    await $.tool.check(call('ls', 'toolu_ls'))
    await $.tool.check(call('rm -rf build', 'toolu_acquitted'))

    for (const surface of SURFACES) {
      for (const site of [resultRow('toolu_ls'), resultRow('toolu_acquitted'), resultRow('toolu_never'), resultRow('toolu_read', 'Read')]) {
        const row = await $.ui.mount({ ...site, surface })
        expect(await row.drawn(), `${surface} ${site.requestId}`).toEqual(ENGINE_ROW)
        await row.unmount()
      }
      const group = await $.ui.mount({ ...groupOf(['toolu_ls', 'toolu_acquitted']), surface })
      expect(await group.drawn(), surface).toEqual(ENGINE_GROUP)
      await group.unmount()
    }
  })

  test('a mistrial stamps no row', async ($, on) => {
    memoryStore(on, SIXTEEN)
    seatCourt(on, { reply: () => { throw new Error('boom') } })
    drawsEngine(on)

    expect((await $.tool.check(call('rm -rf ~', 'toolu_hung'))).decision).toBe('ask')
    const row = await $.ui.mount({ ...resultRow('toolu_hung'), surface: 'terminal' })
    expect(await row.drawn()).toEqual(ENGINE_ROW)
  })

  test('another tool sharing a convicted id is untouched', async ($, on) => {
    memoryStore(on, SIXTEEN)
    seatCourt(on, verdictBench(GUILTY))
    drawsEngine(on)

    await $.tool.check(call('rm -rf ~', 'toolu_17'))

    const row = await $.ui.mount({ ...resultRow('toolu_17', 'Read'), surface: 'terminal' })
    expect(await row.drawn()).toEqual(ENGINE_ROW)
    const site = groupOf(['toolu_17'])
    const calls = site.props.calls.map(one => ({ ...one, tool: 'Read' }))
    const group = await $.ui.mount({ ...site, props: { ...site.props, calls }, surface: 'terminal' })
    expect(await group.drawn()).toEqual(ENGINE_GROUP)
  })

  for (const columns of [80, 120]) {
    test(`the stamp fits ${columns} columns in safe glyphs`, async ($, on) => {
      memoryStore(on, SIXTEEN)
      seatCourt(on, verdictBench(GUILTY))
      drawsEngine(on)
      await $.tool.check(call('rm -rf ~', 'toolu_17'))
      await $.tool.check(call('rm -rf ~', 'toolu_18'))

      for (const id of ['toolu_17', 'toolu_18']) {
        const row = await $.ui.mount({ ...resultRow(id), surface: 'terminal', viewport: { columns, rows: 40 } })
        const stamp = await row.find({ key: 'transcript-stamp' })
        expect(stamp, id).toBeDefined()
        const width = layoutWidthOf(stamp)
        expect(width, id).toBeGreaterThan(0)
        expect(width, id).toBeLessThanOrEqual(columns)
        expect([...textsOf(stamp).join('')].filter(char => !isSafeGlyph(char)), id).toEqual([])
        await row.unmount()
      }
    })
  }
})
