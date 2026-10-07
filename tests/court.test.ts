import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { refused, said, seatCourt, verdictBench } from './fixtures/court'
import { PALETTE, textsOf } from './fixtures/art'
import { BAND_SITE, DOCKET_SITE, PANE_SITE } from './fixtures/sites'

tier('user')

const GUILTY = 'VERDICT: GUILTY\nREASON: it erases the whole home folder'
const check = (command: string) => ({ tool: 'Bash', input: { command } })

const message = (role: 'user' | 'assistant', text: string) => ({ role, text, toolUses: [] })

describe('court', () => {
  test('every role hears the person and the agent, quoted as evidence', async ($, on) => {
    const seen = seatCourt(on, {
      ...verdictBench(GUILTY),
      messages: [
        message('user', 'an older ask'),
        message('assistant', 'Looking at it.'),
        message('user', 'Solo scratch repo, I own origin. Force push it.'),
        { role: 'user', text: '', toolUses: [], toolResults: [] },
        message('assistant', 'Force pushing main to origin.'),
      ],
    })

    await $.tool.check(check('git push --force origin main'))

    for (const role of ['prosecutor', 'defense', 'judge'] as const) {
      expect(seen.prompts[role], role).toContain(
        '<person>Solo scratch repo, I own origin. Force push it.</person>',
      )
      expect(seen.prompts[role], role).toContain('<agent>Force pushing main to origin.</agent>')
      expect(seen.prompts[role], role).not.toContain('an older ask')
    }
  })

  test('the pane shows the case, both speeches and the verdict once revealed', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, verdictBench(GUILTY))
    await $.tool.check(check('rm -rf ~'))
    await clock.advance(8_000)

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ ...PANE_SITE, surface })
      expect(await pane.find({ text: /THE PEOPLE v\. rm -rf ~/ })).toBeDefined()
      expect(await pane.find({ text: 'It destroys work.' })).toBeDefined()
      expect(await pane.find({ text: 'It is a build folder.' })).toBeDefined()
      expect(await pane.find({ text: /^✕ GUILTY\. Objection sustained/ })).toBeDefined()
      await pane.unmount()
    }
  })

  test('a compound command is tried and filed under the simple command that is charged', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    const seen = seatCourt(on, verdictBench(GUILTY))
    const compound = 'ls -la src && git status --short src && rm -rf src && ls'

    await $.tool.check(check(compound))
    await clock.advance(8_000)

    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    expect(await pane.find({ text: /^THE PEOPLE v\. rm -rf src$/ })).toBeDefined()
    await pane.unmount()
    expect(seen.prompts.judge).toContain(`<command>${compound}</command>`)
    const docket = await $.ui.mount({ ...DOCKET_SITE, surface: 'terminal' })
    expect(await docket.find({ text: 'rm -rf src' })).toBeDefined()
    expect(await docket.find({ text: /ls -la src/ })).toBeUndefined()
  })

  test('the decision comes as soon as the judge rules, before the reveal ends', async ($, on) => {
    mock.clock(on)
    seatCourt(on, verdictBench(GUILTY))

    const verdict = await $.tool.check(check('rm -rf ~'))

    expect(verdict.decision).toBe('deny')
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    expect(await pane.find({ key: 'stamp' })).toBeUndefined()
  })

  test('while counsel prepares, the jury is deliberating', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, {
      reply: async () => {
        await clock.sleep(60_000)
        return said(GUILTY)
      },
    })

    const pending = $.tool.check(check('git push --force'))
    await clock.settle()
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    expect(await pane.find({ text: /^The jury is deliberating/ })).toBeDefined()

    await clock.advance(9_000)
    await pending
  })

  test('the jury deliberates for at least 1.8 seconds, however fast counsel answers', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, verdictBench(GUILTY))

    const verdict = await $.tool.check(check('git push --force'))
    expect(verdict.decision).toBe('deny')
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    expect(await pane.find({ text: /^The jury is deliberating/ })).toBeDefined()
    expect(await pane.find({ text: /^PROSECUTION$/ })).toBeUndefined()
    await clock.advance(1_700)
    expect(await pane.find({ text: /^PROSECUTION$/ })).toBeUndefined()
    await clock.advance(200)
    expect(await pane.find({ text: /^PROSECUTION$/ })).toBeDefined()
  })

  test('the prosecution always speaks first, however fast the defense was', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, {
      reply: async role => {
        if (role === 'prosecutor') {
          await clock.sleep(2_000)
        }
        return verdictBench(GUILTY).reply(role)
      },
    })

    const pending = $.tool.check(check('git push --force'))
    await clock.settle()
    await clock.advance(8_000)
    await pending
    await clock.advance(1_500)

    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    const titles = await pane.findAll({ type: 'Text', text: /^(PROSECUTION|DEFENSE|THE COURT)$/ })
    expect(titles.map(title => title.text)).toEqual(['PROSECUTION', 'DEFENSE', 'THE COURT'])
  })

  test('the defense follows once the prosecution is typed; after the ruling all rise, then the court speaks', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, {
      reply: async role => {
        if (role === 'judge') {
          await clock.sleep(3_000)
        }
        return verdictBench(GUILTY).reply(role)
      },
    })

    const pending = $.tool.check(check('git push --force'))
    await clock.settle()
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    const titles = async () =>
      (await pane.findAll({ type: 'Text', text: /^(PROSECUTION|DEFENSE|THE COURT)$/ })).map(title => title.text)

    expect(await titles()).toEqual([])
    await clock.advance(1_800)
    expect(await titles()).toEqual(['PROSECUTION'])
    await clock.advance(700)
    expect(await titles()).toEqual(['PROSECUTION', 'DEFENSE'])
    await clock.advance(500)
    await pending
    expect(await titles()).toEqual(['PROSECUTION', 'DEFENSE'])
    expect(await pane.find({ text: /^ALL RISE\./ })).toBeDefined()
    await clock.advance(1_000)
    expect(await titles()).toEqual(['PROSECUTION', 'DEFENSE', 'THE COURT'])
    expect(await pane.find({ text: /^ALL RISE\./ })).toBeUndefined()
  })

  test('all rise waits until the defense has finished speaking', async ($, on) => {
    const clock = mock.clock(on)
    const long = 'Your Honor, my client is innocent and this folder is rebuilt on every single run of the build, ' +
      'which the person knows, which the agent knows, and which this court surely knows as well.'
    seatCourt(on, { reply: role => said(role === 'judge' ? GUILTY : role === 'defense' ? long : 'It destroys work.') })

    await $.tool.check(check('rm -rf ~'))
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    await clock.advance(3_000)
    expect(await pane.find({ text: /^DEFENSE$/ })).toBeDefined()
    expect(await pane.find({ text: /^ALL RISE\./ })).toBeUndefined()
    await clock.advance(800)
    expect(await pane.find({ text: /^ALL RISE\./ })).toBeDefined()
  })

  test('all rise strikes the gavel: raised, then the blow', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, verdictBench(GUILTY))
    await $.tool.check(check('rm -rf ~'))
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    let raised: string | undefined
    for (let ms = 0; ms < 6_000 && raised === undefined; ms += 100) {
      await clock.advance(100)
      if ((await pane.find({ type: 'Client', key: 'gavel-strike' })) !== undefined) {
        raised = JSON.stringify(await pane.drawn({ in: 'gavel-strike' }))
      }
    }
    expect(raised).toBeDefined()
    await pane.advance(600)
    expect(JSON.stringify(await pane.drawn({ in: 'gavel-strike' }))).not.toBe(raised)
  })

  test('the verdict is stamped big: blue blocks for not guilty', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, {
      reply: role =>
        said(role === 'judge' ? 'VERDICT: NOT GUILTY\nREASON: only a build folder' : 'Words.'),
    })
    await $.tool.check(check('rm -rf build'))
    await clock.advance(8_000)

    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    expect(await pane.find({ key: 'stamp' })).toBeDefined()
    const fills = (await pane.findAll({ type: 'Text', text: /█/ })).map(run => run.props.color)
    expect(fills.length).toBeGreaterThan(0)
    expect(fills.every(color => color === PALETTE.acquitted)).toBe(true)
  })

  test('the verdict is stamped big: orange blocks with a shadow for guilty', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, verdictBench(GUILTY))
    await $.tool.check(check('rm -rf ~'))
    await clock.advance(8_000)

    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    const fills = (await pane.findAll({ type: 'Text', text: /█/ })).map(run => run.props.color)
    expect(fills.length).toBeGreaterThan(0)
    expect(fills.every(color => color === PALETTE.guilty)).toBe(true)
    const edges = (await pane.findAll({ type: 'Text', text: /^ *[╗╔╝╚═║][╗╔╝╚═║ ]*$/ })).map(run => run.props.color)
    expect(edges.length).toBeGreaterThan(0)
    expect(edges.every(color => color === PALETTE.shadow)).toBe(true)
  })

  test('a speech is shown as plain words, without markdown headings or bold labels', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, {
      reply: role =>
        said(
          role === 'judge'
            ? GUILTY
            : role === 'prosecutor'
              ? '**PROSECUTION BRIEF:**\n\nIt **destroys** work.'
              : '## Defense\nIt is a build folder.',
        ),
    })
    await $.tool.check(check('rm -rf ~'))
    await clock.advance(8_000)

    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    expect(await pane.find({ text: 'It destroys work.' })).toBeDefined()
    expect(await pane.find({ text: 'It is a build folder.' })).toBeDefined()
    expect(await pane.find({ text: /\*\*|BRIEF|^## / })).toBeUndefined()
  })

  test('the band says the court is in session while a trial runs', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, {
      reply: async () => {
        await clock.sleep(60_000)
        return said(GUILTY)
      },
    })

    const pending = $.tool.check(check('git push --force'))
    await clock.settle()
    const band = await $.ui.mount({ ...BAND_SITE, surface: 'terminal' })
    expect(await band.find({ text: /Court in session: force push/ })).toBeDefined()

    await clock.advance(9_000)
    await pending
  })

  test('the person objecting during a trial denies the command', async ($, on) => {
    const clock = mock.clock(on)
    const seen = seatCourt(on, {
      reply: async () => {
        await clock.sleep(60_000)
        return said(GUILTY)
      },
      beneath: { decision: 'allow' },
    })

    const pending = $.tool.check(check('git reset --hard'))
    await clock.settle()
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    await pane.press({ key: 'object' })
    const verdict = await pending

    expect(verdict.decision).toBe('deny')
    expect(verdict.reason).toContain('the person objected from the gallery')
    expect(seen.calls).not.toContain('judge')
  })

  test('a retried conviction is contempt, decided with no model call', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const seen = seatCourt(on, verdictBench(GUILTY))

    const first = await $.tool.check(check('rm -rf src'))
    expect(first.decision).toBe('deny')
    const callsAfterTrial = seen.calls.length

    const retried = await $.tool.check(check('rm -fr   src'))

    expect(retried.decision).toBe('deny')
    expect(retried.reason).toMatch(/^Contempt of court!.*case #0001/)
    expect(seen.calls.length).toBe(callsAfterTrial)
  })

  test('contempt is stamped CONTEMPT in the guilty colour and filed as contempt', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    seatCourt(on, verdictBench(GUILTY))
    await $.tool.check(check('git push --force origin main'))
    await clock.advance(8_000)
    await $.tool.check(check('git push --force origin main'))
    await clock.advance(8_000)

    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    expect(await pane.find({ type: 'Text', text: /^✕ CONTEMPT\. / })).toBeDefined()
    expect(await pane.find({ text: /Case #0002/ })).toBeDefined()
    const fills = (await pane.findAll({ type: 'Text', text: /█/ })).map(run => run.props.color)
    expect(fills.length).toBeGreaterThan(0)
    expect(fills.every(color => color === PALETTE.guilty)).toBe(true)
    const docket = await $.ui.mount({ ...DOCKET_SITE, surface: 'terminal' })
    expect(await docket.find({ text: /CONTEMPT/ })).toBeDefined()
    expect(await docket.find({ text: /100%/ })).toBeDefined()
  })

  test('the sentence is read out under the court, and Claude is told it', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, verdictBench(GUILTY))
    const verdict = await $.tool.check(check('git push --force origin main'))
    await clock.advance(8_000)

    expect(verdict.reason).toContain('The sentence: Use git push --force-with-lease instead')
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    expect((await pane.find({ type: 'Text', text: /^SENTENCE$/ }))?.props.color).toBe(PALETTE.gold)
    expect(await pane.find({ text: /git push --force-with-lease/ })).toBeDefined()
  })

  test('an acquittal carries no sentence', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, verdictBench('VERDICT: NOT GUILTY\nREASON: it is a build folder'))
    const verdict = await $.tool.check(check('rm -rf build'))
    await clock.advance(8_000)

    expect(verdict.reason ?? '').not.toContain('sentence')
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    expect(await pane.find({ type: 'Text', text: /^SENTENCE$/ })).toBeUndefined()
  })

  test('a different target after a conviction still gets a trial', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const seen = seatCourt(on, verdictBench(GUILTY))

    await $.tool.check(check('rm -rf src'))
    const callsAfterTrial = seen.calls.length
    const other = await $.tool.check(check('rm -rf dist'))

    expect(other.reason).toMatch(/^Objection!/)
    expect(seen.calls.length).toBeGreaterThan(callsAfterTrial)
  })

  test('a new session forgives contempt', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    const seen = seatCourt(on, verdictBench(GUILTY))

    await $.tool.check(check('git push --force origin main'))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const callsBefore = seen.calls.length
    const again = await $.tool.check(check('git push --force origin main'))

    expect(again.reason).toMatch(/^Objection!/)
    expect(seen.calls.length).toBeGreaterThan(callsBefore)
  })

  test('the header numbers the case and counts prior convictions on the charge', async ($, on) => {
    mock.clock(on)
    mock.store(on, {
      cases: [
        { number: 3, command: 'git push -f', charge: 'force push', verdict: 'guilty', at: 1 },
        { number: 4, command: 'rm -rf x', charge: 'recursive delete', verdict: 'guilty', at: 2 },
        { number: 5, command: 'git push -f', charge: 'force push', verdict: 'acquitted', at: 3 },
        { number: 6, command: 'git push --force', charge: 'force push', verdict: 'guilty', at: 4 },
      ],
    })
    seatCourt(on, verdictBench(GUILTY))

    await $.tool.check(check('git push --force origin main'))

    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    expect(await pane.find({ text: /Case #0007/ })).toBeDefined()
    expect(await pane.find({ text: /Prior convictions: 2/ })).toBeDefined()
  })

  test('a ruled case is filed: the next trial is the next number with one more prior', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    seatCourt(on, verdictBench(GUILTY))

    await $.tool.check(check('git push --force'))
    await $.tool.check(check('git push --force origin main'))

    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    expect(await pane.find({ text: /Case #0002/ })).toBeDefined()
    expect(await pane.find({ text: /Prior convictions: 1/ })).toBeDefined()
  })

  test('/court docket shows the rate, the recent cases, the verdict strip and the rap sheet', async ($, on) => {
    mock.store(on, {
      cases: [
        { number: 1, command: 'git reset --hard', charge: 'hard reset', verdict: 'guilty', at: 1 },
        { number: 2, command: 'git push -f', charge: 'force push', verdict: 'guilty', at: 2 },
        { number: 3, command: 'rm -rf node_modules', charge: 'recursive delete', verdict: 'acquitted', at: 3 },
        { number: 4, command: 'git push --force', charge: 'force push', verdict: 'guilty', at: 4 },
        { number: 5, command: 'terraform destroy', charge: 'terraform destroy', verdict: 'hung', at: 5 },
        { number: 6, command: 'rm -rf dist', charge: 'recursive delete', verdict: 'acquitted', at: 6 },
      ],
    })
    const opened: string[] = []
    on('ui.open', ($, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })

    await $.command.run({
      command: 'court',
      args: 'docket',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 160 },
    })

    expect(opened).toEqual(['trial-run-docket'])
    const pane = await $.ui.mount({ ...DOCKET_SITE, surface: 'terminal' })
    expect(await pane.find({ text: /^THE DOCKET/ })).toBeDefined()
    expect(await pane.find({ text: /6 cases/ })).toBeDefined()
    // three guilty of five ruled
    expect((await pane.find({ type: 'Text', text: /60%$/ }))?.text).toBe(' 60%')
    expect((await pane.find({ type: 'Text', text: /^THE DOCKET$/ }))?.props.color).toBe(PALETTE.gold)
    expect((await pane.find({ type: 'Text', text: /^RAP SHEET$/ }))?.props.color).toBe(PALETTE.guilty)
    expect(await pane.find({ text: /#0006/ })).toBeDefined()
    // guilty, guilty, acquitted, guilty, mistrial, acquitted: one run per stretch of one verdict,
    // every mark one space from the next
    const strip = (await pane.findAll({ type: 'Text', text: /^[✕·?][✕·? ]*$/ })).map(run => [run.text, run.props.color])
    expect(strip).toEqual([
      ['✕ ✕ ', PALETTE.guilty],
      ['· ', PALETTE.acquitted],
      ['✕ ', PALETTE.guilty],
      ['? ', PALETTE.mistrial],
      ['·', PALETTE.acquitted],
    ])
    expect(await pane.find({ text: /^✕ guilty {3}· acquitted {3}\? mistrial$/ })).toBeDefined()
    expect(await pane.find({ text: /RAP SHEET/ })).toBeDefined()
    expect(await pane.find({ text: /^Most wanted: force push\.$/ })).toBeDefined()
    expect(await pane.find({ text: /^Considered armed and helpful\.$/ })).toBeDefined()
  })

  test('an empty docket says the court has heard no cases', async ($, on) => {
    mock.store(on)
    on('ui.open', () => ({ value: { isPlaced: true } }))

    await $.command.run({
      command: 'court',
      args: 'docket',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 160 },
    })

    const pane = await $.ui.mount({ ...DOCKET_SITE, surface: 'terminal' })
    expect(await pane.find({ text: /^No cases heard yet\.$/ })).toBeDefined()
  })

  test('within the shortest deliberation the pans tip one way, then the other, then back', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, {
      reply: async () => {
        await clock.sleep(60_000)
        return said(GUILTY)
      },
    })

    const pending = $.tool.check(check('git push --force'))
    await clock.settle()
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    const poses: string[] = []
    for (let elapsed = 0; elapsed < 1_800; elapsed += 100) {
      const drawn = JSON.stringify(await pane.drawn({ in: 'scales-bob' }))
      if (poses.at(-1) !== drawn) {
        poses.push(drawn)
      }
      await pane.advance(100)
    }
    // level, then three tips: one way, the other, and back
    expect(poses.length).toBeGreaterThanOrEqual(4)
    expect(new Set(poses.slice(1)).size).toBe(2)

    await clock.advance(60_000)
    await pending
  })

  test('while the jury deliberates, the pans bob and the bar counts the seconds down', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, {
      reply: async () => {
        await clock.sleep(60_000)
        return said(GUILTY)
      },
    })

    const pending = $.tool.check(check('git push --force'))
    await clock.settle()
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    const scales = async () => (await pane.drawn({ in: 'scales-bob' })) as unknown
    const left = async () => (await pane.find({ in: 'deliberation', key: 'left' }))?.text
    const filled = async () => (await pane.find({ in: 'deliberation', key: 'filled' }))?.text ?? ''

    const level = JSON.stringify(await scales())
    expect(await left()).toBe('9s left')
    await pane.advance(600)
    expect(JSON.stringify(await scales())).not.toBe(level)
    const before = [...(await filled())].length
    await pane.advance(3_000)
    expect(await left()).toBe('6s left')
    expect([...(await filled())].length).toBeGreaterThan(before)

    await clock.advance(9_000)
    await pending
  })

  test('the speech being revealed is typed out, the ones before it stand whole', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, {
      reply: async role => {
        if (role === 'judge') {
          await clock.sleep(3_000)
        }
        return verdictBench(GUILTY).reply(role)
      },
    })

    const pending = $.tool.check(check('git push --force'))
    await clock.settle()
    await clock.advance(1_800)
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })

    expect(await pane.find({ in: 'typed-prosecutor', text: 'It destroys work.' })).toBeUndefined()
    await pane.advance(2_000)
    expect(await pane.find({ in: 'typed-prosecutor', text: 'It destroys work.' })).toBeDefined()

    await clock.advance(700)
    expect(await pane.find({ text: 'It destroys work.' })).toBeDefined()
    expect(await pane.find({ in: 'typed-defense', text: 'It is a build folder.' })).toBeUndefined()
    await pane.advance(2_000)
    expect(await pane.find({ in: 'typed-defense', text: 'It is a build folder.' })).toBeDefined()

    await clock.advance(2_300)
    await pending
  })

  test('the stamp drops in from above, overshoots, inks then dries, and never changes colour', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, verdictBench(GUILTY))
    await $.tool.check(check('rm -rf ~'))
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    const inStamp = async () => pane.findAll({ type: 'Text', text: /[█▓]/, in: 'stamp-entrance' })
    const inkedRows = async () => {
      const tree = (await pane.drawn({ in: 'stamp-entrance' })) as { children?: unknown[] }
      return (tree.children ?? []).filter(row => /[█▓]/.test(textsOf(row).join(''))).length
    }

    expect((await pane.find({ key: 'frame' }))?.props.borderColor).not.toBe(PALETTE.guilty)
    for (let ms = 0; ms < 8_000 && (await pane.find({ type: 'Client', key: 'stamp-entrance' })) === undefined; ms += 50) {
      await clock.advance(50)
    }
    const frames: { rows: number; inked: boolean; colors: unknown[] }[] = []
    for (let step = 0; step < 10; step += 1) {
      const runs = await inStamp()
      frames.push({
        rows: await inkedRows(),
        inked: runs.some(run => run.text.includes('▓')),
        colors: runs.map(run => run.props.color),
      })
      await pane.advance(40)
    }
    const settledRows = Math.max(...frames.map(frame => frame.rows))
    expect(frames[0]?.rows).toBeLessThan(settledRows)
    expect(frames.some(frame => frame.inked)).toBe(true)
    expect(frames.flatMap(frame => frame.colors).every(color => color === PALETTE.guilty)).toBe(true)

    await clock.advance(2_000)
    expect(await pane.find({ type: 'Client' })).toBeUndefined()
    const settled = (await pane.findAll({ type: 'Text', text: /█/ })).map(run => run.props.color)
    expect(settled.every(color => color === PALETTE.guilty)).toBe(true)
    expect(await pane.find({ type: 'Text', text: /▓/ })).toBeUndefined()
    expect((await pane.find({ key: 'frame' }))?.props.borderColor).toBe(PALETTE.guilty)
  })

  test('while in session the pane shows the scales of justice, gone once stamped', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, verdictBench(GUILTY))
    await $.tool.check(check('rm -rf ~'))
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })

    expect(await pane.find({ key: 'scales' })).toBeDefined()
    await clock.advance(8_000)
    expect(await pane.find({ key: 'scales' })).toBeUndefined()
  })

  test('a surface with no Client still says the jury is deliberating, in plain text', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, {
      reply: async () => {
        await clock.sleep(60_000)
        return said(GUILTY)
      },
    })

    const pending = $.tool.check(check('git push --force'))
    await clock.settle()
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'vscode' })
    expect(await pane.find({ text: /^The jury is deliberating/ })).toBeDefined()
    expect(await pane.find({ type: 'Client' })).toBeUndefined()

    await clock.advance(9_000)
    await pending
  })

  test('a surface with no Client shows the speech being revealed whole, as plain text', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, {
      reply: async role => {
        if (role === 'judge') {
          await clock.sleep(3_000)
        }
        return verdictBench(GUILTY).reply(role)
      },
    })

    const pending = $.tool.check(check('git push --force'))
    await clock.settle()
    await clock.advance(1_800)
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'vscode' })
    expect(await pane.find({ type: 'Text', text: 'It destroys work.' })).toBeDefined()

    await clock.advance(3_000)
    await pending
  })

  test('a rambling speech is shown cut to its first two sentences', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, {
      reply: role =>
        said(role === 'judge' ? GUILTY : role === 'prosecutor' ? 'It is bad. It is worse. It is a lecture. It is a sermon.' : 'Fine.'),
    })
    await $.tool.check(check('rm -rf ~'))
    await clock.advance(8_000)
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    expect(await pane.find({ text: /^It is bad\. It is worse\.$/ })).toBeDefined()
    expect(await pane.find({ text: /lecture/ })).toBeUndefined()
  })

  test('after an objection the court says so in a sentence', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, {
      reply: async () => {
        await clock.sleep(60_000)
        return said(GUILTY)
      },
    })
    const pending = $.tool.check(check('git reset --hard'))
    await clock.settle()
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    await pane.press({ key: 'object' })
    await pending
    await clock.advance(8_000)
    expect(await pane.find({ text: /^The person objected from the gallery\.$/ })).toBeDefined()
  })

  test('skipping the trial: the court says the person waived it', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, {
      reply: async () => {
        await clock.sleep(60_000)
        return said(GUILTY)
      },
    })
    const pending = $.tool.check(check('rm -rf dist'))
    await clock.settle()
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    await pane.press({ key: 'overrule' })
    await pending
    await clock.advance(8_000)
    expect(await pane.find({ text: /^The person waived the trial\.$/ })).toBeDefined()
  })

  test('a waived trial is not an acquittal: it says WAIVED and files a waiver', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    seatCourt(on, {
      reply: async () => {
        await clock.sleep(60_000)
        return said(GUILTY)
      },
    })
    const pending = $.tool.check(check('rm -rf dist'))
    await clock.settle()
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    await pane.press({ key: 'overrule' })
    const result = await pending
    expect(result.decision).toBe('allow')
    await clock.advance(8_000)
    expect(await pane.find({ text: /^- WAIVED\. Over to your permission rules\.$/ })).toBeDefined()
    expect(await pane.find({ text: /NOT GUILTY/ })).toBeUndefined()
    await pane.unmount()
    const docket = await $.ui.mount({ ...DOCKET_SITE, surface: 'terminal' })
    expect(await docket.find({ text: /WAIVED/ })).toBeDefined()
    expect(await docket.find({ text: /NOT GUILTY/ })).toBeUndefined()
  })

  test('a mistrial says the decision goes back to the permission prompt, in sentences', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, { reply: role => (role === 'judge' ? refused : said('Words.')) })
    await $.tool.check(check('rm -rf ~'))
    await clock.advance(8_000)
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    expect(await pane.find({ text: /^\? MISTRIAL\. Back to your permission prompt\.$/ })).toBeDefined()
    expect(await pane.find({ text: /^The judge did not rule\.$/ })).toBeDefined()
  })

  test('Object and Skip are keyed o and s, stand apart, and the pane says how to reach them', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, {
      reply: async () => {
        await clock.sleep(60_000)
        return said(GUILTY)
      },
    })
    const pending = $.tool.check(check('git push --force'))
    await clock.settle()
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    expect((await pane.find({ type: 'Button', key: 'object' }))?.props.hotkey).toBe('o')
    expect((await pane.find({ type: 'Button', key: 'overrule' }))?.props.hotkey).toBe('s')
    expect(await pane.find({ key: 'button-gap' })).toBeDefined()
    const hint = await pane.find({ key: 'hint' })
    expect(textsOf(hint).join('')).toBe('ctrl+x tab: o object · s skip')
    const keys = await pane.findAll({ type: 'Text', text: /^[os]$/ })
    expect(keys.map(key => [key.text, key.props.bold])).toEqual([['o', true], ['s', true]])
    await clock.advance(60_000)
    await pending
  })

  test('a narrow pane breaks the case header between its parts', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, {
      reply: async () => new Promise(() => undefined),
    })
    void $.tool.check(check('rm -rf node_modules'))
    await clock.settle()
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal', props: { ...PANE_SITE.props, bodyColumns: 46 } })
    expect(await pane.find({ text: /^Charge: recursive delete$/ })).toBeDefined()
    expect(await pane.find({ text: /^Case #0001   ·   Prior convictions: 0$/ })).toBeDefined()
  })

  test('when the pane cannot be placed, the band tells the person to type /court', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, { reply: async () => new Promise(() => undefined), placed: false })
    void $.tool.check(check('git push --force'))
    await clock.settle()
    const band = await $.ui.mount({ ...BAND_SITE, surface: 'terminal' })
    expect(await band.find({ text: /Court in session: force push · type \/court to watch/ })).toBeDefined()
  })

  test('when the pane is placed, the band does not tell the person to open it', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, { reply: async () => new Promise(() => undefined) })
    void $.tool.check(check('git push --force'))
    await clock.settle()
    const band = await $.ui.mount({ ...BAND_SITE, surface: 'terminal' })
    expect(await band.find({ text: /^Court in session: force push$/ })).toBeDefined()
  })

  test("the court's ruling is shown as tight as the speeches", async ($, on) => {
    const clock = mock.clock(on)
    const ruling = `VERDICT: GUILTY\nREASON: ${'it rewrites shared history and '.repeat(9)}it must not run`
    seatCourt(on, { reply: role => said(role === 'judge' ? ruling : 'Words.') })
    const verdict = await $.tool.check(check('git push --force'))
    await clock.advance(8_000)
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    const court = (await pane.findAll({ type: 'Text', text: /^It rewrites shared history/ })).map(text => text.text)
    expect(court).toHaveLength(1)
    expect(court[0]?.length).toBeLessThanOrEqual(180)
    expect(court[0]?.endsWith('...')).toBe(true)
    // Claude still hears the whole reason
    expect(verdict.reason).toContain('it must not run')
  })

  test('a narrow band says the verdict in its short form, on one line', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, verdictBench(GUILTY))
    await $.tool.check(check('git push --force'))
    await clock.advance(8_000)
    const band = await $.ui.mount({ ...BAND_SITE, surface: 'terminal', props: { ...BAND_SITE.props, bodyColumns: 44 } })
    const line = await band.find({ type: 'Text', text: /^Verdict: / })
    expect(line?.text).toBe('Verdict: ✕ GUILTY. It does not run.')
  })

  test('the court asks for room: rows when it sits above the prompt, columns when it is docked', async ($, on) => {
    const asks: { id: string; rows?: number; columns?: number; title?: string }[] = []
    on('ui.open', ($, e) => {
      asks.push({ id: e.id, rows: e.rows, columns: e.columns, title: e.title })
      return { value: { isPlaced: true } }
    })
    mock.store(on)
    for (const args of ['', 'docket']) {
      await $.command.run({ command: 'court', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
    }
    for (const ask of asks) {
      expect(ask.rows, ask.id).toBeGreaterThanOrEqual(20)
      expect(ask.columns, ask.id).toBe(64)
    }
    expect(asks.map(ask => ask.id)).toEqual(['trial-run-court', 'trial-run-docket'])
    expect(asks.map(ask => ask.title)).toEqual(['trial-run · court', 'trial-run · docket'])
  })

  test('a court out of session with a docket points at the last case instead of saying no one was tried', async ($, on) => {
    mock.store(on, {
      cases: [
        { number: 12, command: 'rm -rf dist', charge: 'recursive delete', verdict: 'acquitted', at: 1 },
        { number: 13, command: 'git push --force origin main', charge: 'force push', verdict: 'guilty', at: 2 },
      ],
    })
    const court = await $.ui.mount({ ...PANE_SITE, surface: 'terminal', props: { ...PANE_SITE.props, bodyColumns: 80 } })
    expect((await court.find({ text: /^THE COURT IS NOT IN SESSION$/ }))?.props.color).toBe(PALETTE.gold)
    expect(await court.find({ text: /No one is on trial/ })).toBeUndefined()
    const last = await court.find({ key: 'last-case' })
    expect(textsOf(last).join('')).toBe('Last case  #0013 ✕ GUILTY     git push --force origin main')
    expect((await court.find({ type: 'Text', text: /^✕ GUILTY/ }))?.props.color).toBe(PALETTE.guilty)
    await court.unmount()
    // a narrow pane cuts the command, never the verdict
    const narrow = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    const cut = textsOf(await narrow.find({ key: 'last-case' })).join('')
    expect(cut).toBe('Last case  #0013 ✕ GUILTY     git push --force origin...')
    expect(cut.length).toBeLessThanOrEqual(PANE_SITE.props.bodyColumns - 4)
  })

  test('the empty docket and the empty court look like the court: a frame, a title, a line of copy', async ($, on) => {
    mock.store(on)
    const docket = await $.ui.mount({ ...DOCKET_SITE, surface: 'terminal' })
    expect((await docket.find({ key: 'docket' }))?.props.borderStyle).toBe('round')
    expect((await docket.find({ text: /^THE DOCKET$/ }))?.props.color).toBe(PALETTE.gold)
    expect(await docket.find({ text: /^No cases heard yet\.$/ })).toBeDefined()

    const court = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    expect((await court.find({ key: 'frame' }))?.props.borderStyle).toBe('round')
    expect((await court.find({ text: /^THE COURT IS NOT IN SESSION$/ }))?.props.color).toBe(PALETTE.gold)
    expect(await court.find({ text: /^No one is on trial\. Yet\.$/ })).toBeDefined()
  })

  test('once the gavel has struck it stays down while the court speaks: the scales do not come back', async ($, on) => {
    const clock = mock.clock(on)
    seatCourt(on, verdictBench(GUILTY))
    await $.tool.check(check('rm -rf ~'))
    const pane = await $.ui.mount({ ...PANE_SITE, surface: 'terminal' })
    for (let ms = 0; ms < 6_000 && (await pane.find({ text: /^THE COURT$/ })) === undefined; ms += 50) {
      await clock.advance(50)
    }
    expect(await pane.find({ text: /^THE COURT$/ })).toBeDefined()
    expect(await pane.find({ key: 'scales' })).toBeUndefined()
    expect(await pane.find({ key: 'gavel' })).toBeDefined()
  })
})

