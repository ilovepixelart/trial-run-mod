import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ENGINE = { plugin: 'engine', tier: 'core' } as const

const BASH = 'Executes a given bash command and returns its output.'

/**
 * What the court tells Claude, as SHOW-002 states it: risky commands stand
 * trial, and the intent stated in the same message helps the defense.
 */
const RISKY = /risky commands[^.]*stand trial before they run\./i
const INTENT = /state (your|the) intent in the same message[^.]*defense[^.]*\./i

describe('describe', () => {
  test('Bash description gains the notice', async ($, on) => {
    on('tool.describe', ($, e) => ({ description: e.description }))

    const { description } = await $.tool.describe({ tool: 'Bash', description: BASH, provider: ENGINE })

    expect(description.startsWith(BASH)).toBe(true)
    const added = description.slice(BASH.length)
    expect(added).toMatch(RISKY)
    expect(added).toMatch(INTENT)
    expect(added.trim().split(/(?<=\.)\s+/)).toHaveLength(2)
    expect(added.length).toBeLessThan(200)
  })

  test('the notice is added once, however often the description is asked for', async ($, on) => {
    on('tool.describe', ($, e) => ({ description: e.description }))

    const first = await $.tool.describe({ tool: 'Bash', description: BASH, provider: ENGINE })
    const again = await $.tool.describe({ tool: 'Bash', description: BASH, provider: ENGINE })

    expect(again).toEqual(first)
    expect(first.description.match(new RegExp(RISKY.source, 'gi'))).toHaveLength(1)
  })

  test('the placement beneath stands', async ($, on) => {
    on('tool.describe', ($, e) => ({ description: e.description, isDeferred: true }))

    expect((await $.tool.describe({ tool: 'Bash', description: BASH, provider: ENGINE })).isDeferred).toBe(true)
  })

  test('other tools are untouched', async ($, on) => {
    on('tool.describe', ($, e) => ({ description: `${e.description} (beneath)`, isDeferred: false }))

    for (const tool of ['Read', 'Write', 'Monitor', 'mcp__server__bash']) {
      expect(await $.tool.describe({ tool, description: 'A tool.', provider: ENGINE }), tool).toEqual({
        description: 'A tool. (beneath)',
        isDeferred: false,
      })
    }
  })

  test('with no known charge on, the court stays on and Bash gains the notice', { options: { charges: ['Force-Push'] } }, async ($, on) => {
    on('tool.describe', ($, e) => ({ description: e.description }))

    expect((await $.tool.describe({ tool: 'Bash', description: BASH, provider: ENGINE })).description.slice(BASH.length)).toMatch(RISKY)
  })

  test('with every charge switched off, Bash is untouched too', { options: { charges: [] } }, async ($, on) => {
    on('tool.describe', ($, e) => ({ description: e.description }))

    expect(await $.tool.describe({ tool: 'Bash', description: BASH, provider: ENGINE })).toEqual({ description: BASH })
  })
})
