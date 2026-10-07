import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ResultOf } from 'claude-code'

import type { CourtRole, CourtTrial, CourtVerdict } from '../types'
import { contemptKeyOf } from './contempt'
import { DOCKET_LAYOUT, casesOf, docketOf, fileCase, isReadableLayout, nextCaseNumber, precedentOf, priorsOf } from './docket'
import { GIT_ENV, exhibitLinesOf, factsOf, materialFactsOf, planOf } from './exhibits'
import type { ExhibitResult, Facts } from './exhibits'
import type { CaseRecord } from './docket'
import { gaugeOf } from './gauge'
import { caseNumberOf, caseRowOf, docketLayoutOf, headerLinesOf, lineOf, rapSheetLayoutOf, wrapOf } from './layout'
import { DELIBERATION_MS, LANDING_MS, RISE_MS, paceOf } from './pace'
import { chargeOf, isSimpleCommand } from './risky'
import { sentenceFor } from './sentence'
import { GAVEL, SCALES, segmentsOf, stampFor } from './stamp'
import { speechRequestOf, spokenOf, testimonyOf, tightOf, tryCase } from './trial'
import type { Speak } from './trial'
import { contemptOf, sentenceOf } from './verdict'
import type { Ruling } from './verdict'

const PANE = 'trial-run-court'

const DOCKET_PANE = 'trial-run-docket'

/**
 * The store key the docket lives under: every case the court has heard.
 */
const CASES = 'cases'
const LAYOUT = 'layout'

/**
 * The whole trial's deadline. A hook's own budget is ten seconds and a
 * `$.clock` wait counts against it, so the court rules before that.
 */
const DEADLINE_MS = 9_000

/**
 * How long the court waits for its exhibits. They run at once, so this
 * bounds each one and all of them together; one not back by then is left out.
 */
const EXHIBIT_MS = 500

const GAVEL_SOUND = 'sounds/gavel.wav'

/**
 * The width the court asks its dock for: room for the shadow stamp and the
 * header on one line. A request; the person's own width wins.
 */
const DOCK_COLUMNS = 64

/**
 * The rows the court asks for above the prompt, where a narrow terminal
 * seats it: the stamp, the header and the speeches. A request, as above.
 */
const INLINE_ROWS = 24

const trialAtom = atom({ plugin: 'trial-run', key: 'trial' } as const, null)
const bandAtom = atom({ plugin: 'trial-run', key: 'isBandShown' } as const, false)

const TITLES: Record<CourtRole, string> = {
  prosecutor: 'PROSECUTION',
  defense: 'DEFENSE',
  judge: 'THE COURT',
}

/**
 * The order the court hears its speakers in, whichever finished first.
 */
const ORDER: Record<CourtRole, number> = { prosecutor: 0, defense: 1, judge: 2 }

/**
 * The stage of the trial each speech is shown from (see `CourtTrial.shown`);
 * a speech is typed out at its own stage and stands whole after it.
 */
const SHOWN_FROM: Record<CourtRole, number> = { prosecutor: 1, defense: 2, judge: 4 }

const HEADLINES: Record<CourtVerdict['kind'], string> = {
  guilty: '✕ GUILTY. Objection sustained: it does not run.',
  acquitted: '✓ NOT GUILTY. Over to your permission rules.',
  hung: '? MISTRIAL. Back to your permission prompt.',
  waived: '- WAIVED. Over to your permission rules.',
  contempt: '✕ CONTEMPT. Already convicted: it does not run.',
}

/**
 * The headlines for a pane too narrow for the full ones: the same verdict,
 * glyph and word first.
 */
const SHORT_HEADLINES: Record<CourtVerdict['kind'], string> = {
  guilty: '✕ GUILTY. It does not run.',
  acquitted: '✓ NOT GUILTY. Your rules decide.',
  hung: '? MISTRIAL. Your prompt decides.',
  waived: '- WAIVED. Your rules decide.',
  contempt: '✕ CONTEMPT. It does not run.',
}

/**
 * What the court says when the person rules from the gallery.
 */
const OBJECTED = 'the person objected from the gallery'
const WAIVED = 'the person waived the trial'

const SPOKEN: Record<CourtVerdict['kind'], string> = {
  guilty: 'Guilty. Objection sustained.',
  acquitted: 'Not guilty.',
  hung: 'Mistrial.',
  waived: 'Trial waived.',
  contempt: 'Contempt of court.',
}

const commandOf = (input: unknown): string | undefined => {
  if (typeof input !== 'object' || input === null || !('command' in input)) {
    return undefined
  }
  return typeof input.command === 'string' ? input.command : undefined
}

const chargeLabelOf = (input: unknown): string | undefined => {
  const command = commandOf(input)
  return command === undefined ? undefined : chargeOf(command)?.label
}

const testimonyFrom = async ($: EngineInterface) => {
  try {
    return testimonyOf(await $.session.messages())
  } catch {
    return testimonyOf([])
  }
}

/**
 * The facts the repository gives on a charged command. Read-only git by
 * argv from `planOf`'s allowlist; a git that fails, is refused or is still
 * running at the bound gives no fact, never an error.
 */
const factsFrom = async ($: EngineInterface, command: string): Promise<Facts> => {
  const plan = planOf(command)
  const timer = new AbortController()
  const bound = $.clock.sleep(EXHIBIT_MS, { signal: timer.signal }).then(
    (): ExhibitResult => undefined,
    (): ExhibitResult => undefined,
  )
  const results = await Promise.all(
    plan.map(query =>
      Promise.race<ExhibitResult>([
        $.process.run(query.argv, { env: { ...GIT_ENV }, timeoutMs: EXHIBIT_MS }).catch(() => undefined),
        bound,
      ]),
    ),
  )
  timer.abort()
  return factsOf(plan, results)
}

/**
 * The session's project root, where precedent binds; undefined when the
 * session will not say, and then no precedent is set or followed.
 */
const rootFrom = async ($: EngineInterface): Promise<string | undefined> => {
  try {
    return await $.session.root()
  } catch {
    return undefined
  }
}

const quietly = (work: Promise<unknown>) => {
  work.catch(() => undefined)
}

/**
 * Whether the saved docket is in a layout this version reads; a store that
 * fails reads as readable, so the court keeps working without it.
 */
const isDocketReadable = async ($: EngineInterface): Promise<boolean> => {
  try {
    return isReadableLayout(await $.store.get(LAYOUT))
  } catch {
    return true
  }
}

const casesFrom = async ($: EngineInterface): Promise<CaseRecord[]> => {
  try {
    return (await isDocketReadable($)) ? casesOf(await $.store.get(CASES)) : []
  } catch {
    return []
  }
}

/**
 * Files a ruled case on the docket. The docket is a record, not a
 * condition of the ruling: a store that fails loses the entry, nothing more.
 */
const fileOnDocket = async ($: EngineInterface, filing: Omit<CaseRecord, 'number'>) => {
  try {
    if (!(await isDocketReadable($))) {
      return
    }
    await $.store.set(CASES, fileCase(await casesFrom($), filing))
    await $.store.set(LAYOUT, DOCKET_LAYOUT)
  } catch {
    // the ruling stands without its docket entry
  }
}

/**
 * The verdicts' accents: a colour-blind safe palette, and every verdict is
 * also a glyph and a word, never colour alone. Body text takes no colour,
 * so it reads on a light theme as on a dark one.
 */
const VERDICT_COLORS: Record<CourtVerdict['kind'], string> = {
  guilty: '#FF6B3D',
  acquitted: '#56B4E9',
  hung: '#CC79A7',
  waived: '#8B93A6',
  contempt: '#FF6B3D',
}

const VERDICT_MARKS: Record<CourtVerdict['kind'], string> = {
  guilty: '✕',
  acquitted: '✓',
  hung: '?',
  waived: '-',
  contempt: '✕',
}

/**
 * The court's own accent, and the shadow of the stamp's letters.
 */
const GOLD = '#E69F00'
const SHADOW = '#5A5F7A'

const ROLE_COLORS: Record<CourtRole, string> = {
  prosecutor: VERDICT_COLORS.guilty,
  defense: VERDICT_COLORS.acquitted,
  judge: GOLD,
}

const VERDICT_LABELS: Record<CourtVerdict['kind'], string> = {
  guilty: 'GUILTY',
  acquitted: 'NOT GUILTY',
  hung: 'MISTRIAL',
  waived: 'WAIVED',
  contempt: 'CONTEMPT',
}

/**
 * Consecutive verdicts of one kind, so the strip draws one Text per run
 * rather than one per case.
 */
/**
 * A command cut to `columns` with three dots, so a title never wraps.
 */
/**
 * A pane's own frame: round where it is docked, none inline, where the
 * engine already frames the pane.
 */
const framed = (e: { props: { placement: 'dock' | 'inline' } }) => (e.props.placement === 'dock' ? ('round' as const) : undefined)

const fitted = (text: string, columns: number) =>
  text.length <= columns ? text : `${text.slice(0, Math.max(1, columns - 3)).trimEnd()}...`

const runsOf = (strip: readonly CourtVerdict['kind'][]) =>
  strip.reduce<{ kind: CourtVerdict['kind']; count: number }[]>((runs, kind) => {
    const last = runs.at(-1)
    if (last?.kind === kind) {
      last.count += 1
    } else {
      runs.push({ kind, count: 1 })
    }
    return runs
  }, [])

export const register: Register = on => {
  let lastId = 0
  const objections = new Map<number, (ruling: Ruling) => void>()
  // the commands convicted this session, by contempt key, with their case
  const convicted = new Map<string, number>()

  const rule = (id: number, ruling: Ruling) => {
    objections.get(id)?.(ruling)
  }

  on('session.start', async ($, e, next) => {
    convicted.clear()
    await $.command.register({
      name: 'court',
      description: 'Open the courtroom pane (the last trial), or `/court docket` for every case heard',
    })
    return next(e)
  })

  // /clear, /resume and /branch start a new conversation without firing
  // session.start, so contempt is forgiven here too; a compaction is not one
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    convicted.clear()
    return next(e)
  })

  on('command.run', { command: 'court' }, async ($, e) => {
    if (e.args.trim() === 'docket') {
      await $.ui.open({ id: DOCKET_PANE, title: 'trial-run · docket', columns: DOCK_COLUMNS, rows: INLINE_ROWS })
      return { text: 'The docket is open.' }
    }
    await $.ui.open({ id: PANE, title: 'trial-run · court', columns: DOCK_COLUMNS, rows: INLINE_ROWS })
    return { text: 'The court is open.' }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, bandAtom, () => false)
    return next(e)
  })

  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const command = commandOf(e.input)
    const charge = command === undefined ? undefined : chargeOf(command)
    if (command === undefined || charge === undefined) {
      return next(e)
    }
    const contemptKey = contemptKeyOf(charge.command)
    const convictedIn = convicted.get(contemptKey)
    if (convictedIn !== undefined) {
      // contempt: on the record, no trial and no model call
      lastId += 1
      const history = await casesFrom($)
      const reason = `Already ruled: case ${caseNumberOf(convictedIn)}.`
      await update($, trialAtom, () => ({
        id: lastId,
        command: charge.command,
        charge: charge.label,
        number: nextCaseNumber(history),
        priors: priorsOf(history, charge.label),
        exhibits: [],
        speeches: [{ role: 'judge' as const, text: reason }],
        verdict: { kind: 'contempt' as const, reason, decision: 'deny' as const },
        shown: 5,
        isLanding: false,
        isPlaced: true,
      }))
      await update($, bandAtom, () => true)
      const contemptId = lastId
      quietly(
        $.ui.open({ id: PANE, title: 'trial-run · court', columns: DOCK_COLUMNS, rows: INLINE_ROWS }).then(opened =>
          update($, trialAtom, trial => (trial?.id === contemptId ? { ...trial, isPlaced: opened.isPlaced } : trial)),
        ),
      )
      quietly($.audio.play({ asset: GAVEL_SOUND }))
      await fileOnDocket($, { command: charge.command, charge: charge.label, verdict: 'contempt', at: Date.now() })
      return contemptOf(convictedIn, charge.label)
    }

    const beneath = next(e)
    lastId += 1
    const id = lastId
    const history = await casesFrom($)
    const opening: CourtTrial = {
      id,
      command: charge.command,
      charge: charge.label,
      number: nextCaseNumber(history),
      priors: priorsOf(history, charge.label),
      exhibits: [],
      speeches: [],
      verdict: null,
      shown: 0,
      isLanding: false,
      isPlaced: true,
    }
    await update($, trialAtom, () => opening)
    await update($, bandAtom, () => true)
    quietly(
      $.ui.open({ id: PANE, title: 'trial-run · court', columns: DOCK_COLUMNS, rows: INLINE_ROWS }).then(opened =>
        update($, trialAtom, trial => (trial?.id === id ? { ...trial, isPlaced: opened.isPlaced } : trial)),
      ),
    )
    quietly($.audio.play({ asset: GAVEL_SOUND }))

    const reveal = (shown: number) =>
      quietly(
        update($, trialAtom, trial =>
          trial?.id === id && trial.shown < shown ? { ...trial, shown } : trial,
        ),
      )
    const landing = (isLanding: boolean) =>
      quietly(update($, trialAtom, trial => (trial?.id === id ? { ...trial, isLanding } : trial)))
    const at = (ms: number, act: () => void) => {
      try {
        $.clock.after(ms, act)
      } catch {
        act()
      }
    }
    // the gallery's pace: each speech is typed, then a beat, then the next;
    // after the ruling, all rise once the defense has finished
    let isCounselHeard = false
    const deliberated = new Promise<void>(resolve => at(DELIBERATION_MS, resolve))
    let counselDone = () => undefined as void
    const counselHeard = new Promise<void>(resolve => {
      counselDone = resolve
    })
    const onSpeech = (role: CourtRole, text: string) =>
      quietly(
        update($, trialAtom, trial =>
          trial?.id === id ? { ...trial, speeches: [...trial.speeches, { role, text }] } : trial,
        ).then(trial => {
          const prosecution = trial?.speeches.find(speech => speech.role === 'prosecutor')
          const defense = trial?.speeches.find(speech => speech.role === 'defense')
          if (prosecution !== undefined && defense !== undefined && !isCounselHeard) {
            isCounselHeard = true
            void deliberated.then(() => {
              reveal(1)
              at(paceOf(prosecution.text), () => {
                reveal(2)
                at(paceOf(defense.text), counselDone)
              })
            })
          }
        }),
      )
    const speak: Speak = async (role, prompt, maxTokens) => {
      const reply = await $.model.complete(speechRequestOf(role, prompt, maxTokens))
      const text = reply.isAnswered ? reply.text.trim() : ''
      return text === '' ? undefined : text
    }
    const timer = new AbortController()
    const never = new Promise<Ruling>(() => undefined)

    // what the docket keeps for precedent, once the exhibits are in
    let filed: Pick<CaseRecord, 'root' | 'facts' | 'precedent'> = {}
    const exhibitsFrom = async () => {
      const facts = await factsFrom($, command)
      const exhibits = exhibitLinesOf(facts)
      await update($, trialAtom, trial => (trial?.id === id ? { ...trial, exhibits } : trial))
      return { exhibits, facts: materialFactsOf(facts) }
    }
    const heard = async (): Promise<Ruling> => {
      const [testimony, { exhibits, facts }, root] = await Promise.all([testimonyFrom($), exhibitsFrom(), rootFrom($)])
      // only a simple command line sets precedent: a compound line's
      // acquittal says nothing about its charged part alone
      filed = isSimpleCommand(command) ? { root, facts } : {}
      const bound = root === undefined ? undefined : precedentOf(history, { command, root, facts })
      if (bound !== undefined) {
        // acquitted here before on the same facts: no model call
        filed = { ...filed, precedent: bound.number }
        return { kind: 'acquitted', reason: `acquitted by precedent: case ${caseNumberOf(bound.number)} heard this command here on the same facts` }
      }
      return tryCase({ command, charge, ...testimony, exhibits }, speak, onSpeech)
    }

    const ruling = await Promise.race<Ruling>([
      heard()
        .catch(() => ({ kind: 'hung', reason: 'the court fell into disorder' })),
      $.clock
        .sleep(DEADLINE_MS, { signal: timer.signal })
        .then((): Ruling => ({ kind: 'hung', reason: 'the court ran out of time' }), () => never),
      new Promise<Ruling>(resolve => objections.set(id, resolve)),
    ])
    timer.abort()
    objections.delete(id)
    if (ruling.kind === 'guilty') {
      convicted.set(contemptKey, opening.number)
    }

    const penalty = ruling.kind === 'guilty' ? sentenceFor(charge.id, charge.command) : undefined
    const sentence = sentenceOf(ruling, await beneath, charge.label, penalty)
    const ruled = tightOf(spokenOf(ruling.reason))
    await update($, trialAtom, trial =>
      trial?.id === id
        ? {
            ...trial,
            speeches: [...trial.speeches, { role: 'judge' as const, text: ruled }],
            verdict: { kind: ruling.kind, reason: ruling.reason, decision: sentence.decision, sentence: penalty },
          }
        : trial,
    )
    if (!isCounselHeard) {
      counselDone()
    }
    void counselHeard.then(() => {
      reveal(3)
      at(RISE_MS, () => {
        reveal(4)
        at(paceOf(ruled), () => {
          landing(true)
          reveal(5)
          at(LANDING_MS, () => landing(false))
        })
      })
    })
    await fileOnDocket($, { command: charge.command, charge: charge.label, verdict: ruling.kind, at: Date.now(), ...filed })
    quietly($.audio.play({ asset: GAVEL_SOUND }))
    quietly($.audio.speak(SPOKEN[ruling.kind]))
    return sentence
  }).catch(async ($, e, next): Promise<ResultOf['tool.check']> => {
    try {
      const beneath = await next(e)
      const label = chargeLabelOf(e.input)
      return label === undefined
        ? beneath
        : sentenceOf({ kind: 'hung', reason: 'the court failed' }, beneath, label)
    } catch {
      return {
        decision: 'ask',
        reason: 'Mistrial! The court of the trial-run plugin failed, so it goes back to the permission prompt.',
      }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const trial = await read($, trialAtom)
    if (trial === null) {
      const last = (await casesFrom($)).at(-1)
      const row = last === undefined ? null : caseRowOf(last, e.props.bodyColumns - 4 - 'Last case  '.length)
      return (
        <Box key="frame" flexDirection="column" borderStyle={framed(e)} borderDimColor paddingX={1}>
          <Text bold color={GOLD}>THE COURT IS NOT IN SESSION</Text>
          <Text dimColor>Risky commands are tried here.</Text>
          {last === undefined || row === null ? (
            <Text dimColor>No one is on trial. Yet.</Text>
          ) : (
            <Box key="last-case" marginTop={1}>
              <Text dimColor>Last case  </Text>
              <Text dimColor>{row.number} </Text>
              <Text color={VERDICT_COLORS[last.verdict]}>
                {row.mark} {row.label}{' '}
              </Text>
              <Text>{row.command}</Text>
            </Box>
          )}
        </Box>
      )
    }
    const isAnimated = e.surface === 'terminal' || e.surface === 'desktop'
    const stamped = trial.verdict !== null && trial.shown >= 5 ? trial.verdict : null
    const heard = trial.speeches
      .filter(speech => trial.shown >= SHOWN_FROM[speech.role])
      .toSorted((a, b) => ORDER[a.role] - ORDER[b.role])
    const typing = (Object.keys(SHOWN_FROM) as CourtRole[]).find(role => SHOWN_FROM[role] === trial.shown)
    const isRising = trial.verdict !== null && trial.shown === 3
    const isStruck = trial.verdict !== null && trial.shown === 4
    const body = e.props.bodyColumns - 4
    // above the prompt with less room than the full trial needs: the case on
    // a few lines, each speech on one, the verdict first
    if (e.props.placement === 'inline' && e.props.scroll.bodyRows < INLINE_ROWS) {
      const label = 'PROSECUTION  '.length
      // inline, the engine already frames the pane: no second frame inside it
      return (
        <Box key="frame" flexDirection="column" paddingX={1}>
          {stamped !== null ? (
            <Text bold color={VERDICT_COLORS[stamped.kind]}>
              {HEADLINES[stamped.kind].length <= body ? HEADLINES[stamped.kind] : SHORT_HEADLINES[stamped.kind]}
            </Text>
          ) : (
            <Text bold color={GOLD}>
              {trial.shown === 0 ? 'COURT IN SESSION. The jury is deliberating.' : 'COURT IN SESSION. The court weighs the arguments.'}
            </Text>
          )}
          <Text bold>THE PEOPLE v. {fitted(trial.command, body - 'THE PEOPLE v. '.length)}</Text>
          {headerLinesOf(trial.charge, trial.number, trial.priors, body).map(line => (
            <Text dimColor>{line}</Text>
          ))}
          {trial.exhibits.map(line => (
            <Text dimColor>{lineOf(line, body)}</Text>
          ))}
          {heard.map(speech => (
            <Box>
              <Text bold color={ROLE_COLORS[speech.role]}>
                {TITLES[speech.role].padEnd(label)}
              </Text>
              <Text>{lineOf(speech.text, body - label)}</Text>
            </Box>
          ))}
          {trial.verdict?.sentence !== undefined && trial.shown >= 4 ? (
            <Box key="sentence">
              <Text bold color={GOLD}>
                {'SENTENCE'.padEnd(label)}
              </Text>
              <Text>{lineOf(trial.verdict.sentence, body - label)}</Text>
            </Box>
          ) : null}
          {trial.verdict === null ? (
            <Box>
              <Button key="object" label="Object" hotkey="o" variant="primary" onPress={() => rule(trial.id, { kind: 'guilty', reason: OBJECTED })} />
              <Box key="button-gap">
                <Text>  </Text>
              </Box>
              <Button key="overrule" label="Skip the trial" hotkey="s" onPress={() => rule(trial.id, { kind: 'waived', reason: WAIVED })} />
            </Box>
          ) : null}
        </Box>
      )
    }
    const cells = Math.max(10, Math.min(44, body - 10))
    // one column spare: the stamp shakes one column as it lands
    const stamp = stamped === null ? null : stampFor(VERDICT_LABELS[stamped.kind], body - 1, e.props.scroll.bodyRows)
    const colors = stamped === null ? null : { fill: VERDICT_COLORS[stamped.kind], edge: SHADOW, dim: SHADOW }
    return (
      <Box
        key="frame"
        flexDirection="column"
        borderStyle={framed(e)}
        borderColor={stamped === null ? undefined : VERDICT_COLORS[stamped.kind]}
        borderDimColor={stamped === null}
        paddingX={1}
      >
        {stamped !== null && stamp === null ? null : stamp !== null && colors !== null ? (
          <Box key="stamp" flexDirection="column">
            {isAnimated && trial.isLanding && 'Client' in els ? (
              <els.Client key="stamp-entrance" module="./clients/entrance.ts" props={{ ...stamp, ...colors }} />
            ) : (
              [...stamp.rows, ' '].map(row => (
                <Box>
                  {segmentsOf(row, stamp.width, colors).map(run => (
                    <Text color={run.color}>{run.text}</Text>
                  ))}
                </Box>
              ))
            )}
          </Box>
        ) : isRising || isStruck ? (
          <Box key="gavel" flexDirection="column" marginBottom={1}>
            {isRising && isAnimated && 'Client' in els ? (
              <els.Client key="gavel-strike" module="./clients/gavel.ts" props={{ color: GOLD }} />
            ) : (
              GAVEL.struck.map(row => <Text color={GOLD}>{row}</Text>)
            )}
          </Box>
        ) : (
          <Box key="scales" flexDirection="column" marginBottom={1}>
            {isAnimated && trial.shown === 0 && 'Client' in els ? (
              <els.Client key="scales-bob" module="./clients/scales.ts" props={{ color: GOLD }} />
            ) : (
              SCALES.level.map(row => <Text color={GOLD}>{row}</Text>)
            )}
          </Box>
        )}
        <Text bold>THE PEOPLE v. {fitted(trial.command, body - 'THE PEOPLE v. '.length)}</Text>
        {headerLinesOf(trial.charge, trial.number, trial.priors, body).map(line => (
          <Text dimColor>{line}</Text>
        ))}
        {trial.exhibits.length === 0 ? null : (
          <Box key="exhibits" flexDirection="column" marginTop={1}>
            {trial.exhibits.flatMap(line => wrapOf(line, body)).map(line => (
              <Text>{line}</Text>
            ))}
          </Box>
        )}
        {heard.map(speech => (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color={ROLE_COLORS[speech.role]}>
              {TITLES[speech.role]}
            </Text>
            {isAnimated && speech.role === typing && 'Client' in els ? (
              <els.Client key={`typed-${speech.role}`} module="./clients/typed.ts" props={{ text: speech.text }} />
            ) : (
              <Text>{speech.text}</Text>
            )}
          </Box>
        ))}
        {trial.verdict?.sentence !== undefined && trial.shown >= 4 ? (
          <Box key="sentence" flexDirection="column" marginTop={1}>
            <Text bold color={GOLD}>
              SENTENCE
            </Text>
            {wrapOf(trial.verdict.sentence, body).map(line => (
              <Text>{line}</Text>
            ))}
          </Box>
        ) : null}
        <Box marginTop={1} flexDirection="column">
          {trial.verdict === null ? (
            <Box flexDirection="column">
              <Text>{trial.shown === 0 ? 'The jury is deliberating.' : 'The court weighs the arguments.'}</Text>
              {isAnimated && trial.shown === 0 && 'Client' in els ? (
                <Box marginTop={1}>
                  <els.Client key="deliberation" module="./clients/deliberation.ts" props={{ deadlineMs: DEADLINE_MS, cells, color: GOLD }} />
                </Box>
              ) : null}
              <Box marginTop={1}>
                <Button key="object" label="Object" hotkey="o" variant="primary" onPress={() => rule(trial.id, { kind: 'guilty', reason: OBJECTED })} />
                <Box key="button-gap">
                  <Text>  </Text>
                </Box>
                <Button key="overrule" label="Skip the trial" hotkey="s" onPress={() => rule(trial.id, { kind: 'waived', reason: WAIVED })} />
              </Box>
              <Box key="hint">
                <Text dimColor>ctrl+x tab: </Text>
                <Text bold>o</Text>
                <Text dimColor> object · </Text>
                <Text bold>s</Text>
                <Text dimColor> skip</Text>
              </Box>
            </Box>
          ) : stamped !== null ? (
            <Text bold color={VERDICT_COLORS[stamped.kind]}>
              {HEADLINES[stamped.kind].length <= body ? HEADLINES[stamped.kind] : SHORT_HEADLINES[stamped.kind]}
            </Text>
          ) : isRising ? (
            <Box flexDirection="column">
              <Text bold color={GOLD}>ALL RISE.</Text>
              <Text dimColor>The court will now deliver its verdict.</Text>
            </Box>
          ) : trial.shown === 0 ? (
            <Text>The jury is deliberating.</Text>
          ) : trial.shown < 3 ? (
            <Text dimColor>The court weighs the arguments.</Text>
          ) : null}
        </Box>
      </Box>
    )
  })

  /**
   * The strip's key; a waiver is named only when the strip shows one.
   */
  const legendOf = (strip: readonly CaseRecord['verdict'][], body: number): string[] => {
    const waived = strip.includes('waived')
    const wide = `✕ guilty   · acquitted   ? mistrial${waived ? '   - waived' : ''}`
    const narrow = `✕ guilty · acquitted ? mistrial${waived ? ' - waived' : ''}`
    if (body >= wide.length) {
      return [wide]
    }
    if (body >= narrow.length) {
      return [narrow]
    }
    return ['✕ guilty · acquitted', waived ? '? mistrial · - waived' : '? mistrial']
  }

  on('ui.render', { component: 'Pane', requestId: DOCKET_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    if (!(await isDocketReadable($))) {
      return (
        <Box key="docket" flexDirection="column" borderStyle={framed(e)} borderDimColor paddingX={1}>
          <Text bold color={GOLD}>THE DOCKET</Text>
          <Text dimColor>This docket was saved by a newer trial-run.</Text>
          <Text dimColor>Update the mod; nothing was changed.</Text>
        </Box>
      )
    }
    const docket = docketOf(await casesFrom($))
    if (docket.total === 0) {
      return (
        <Box key="docket" flexDirection="column" borderStyle={framed(e)} borderDimColor paddingX={1}>
          <Text bold color={GOLD}>THE DOCKET</Text>
          <Text dimColor>No cases heard yet.</Text>
          <Text dimColor>Claude has behaved itself.</Text>
        </Box>
      )
    }
    const body = e.props.bodyColumns - 4
    const layout = docketLayoutOf(body)
    const rap = rapSheetLayoutOf(body, docket.rapSheet.map(line => line.charge))
    const rate = gaugeOf(docket.convictionRate, layout.rateCells)
    const top = docket.rapSheet[0]?.count ?? 1
    const strip = docket.strip.slice(-layout.strip)
    const stripRow = (
      <Box>
        <Text dimColor>Last {strip.length}  </Text>
        <Box key="strip">
          {runsOf(strip).map((run, index, runs) => (
            <Text color={VERDICT_COLORS[run.kind]}>
              {`${(run.kind === 'acquitted' ? '· ' : `${VERDICT_MARKS[run.kind]} `).repeat(run.count)}`.slice(0, index === runs.length - 1 ? -1 : undefined)}
            </Text>
          ))}
        </Box>
      </Box>
    )
    const rateRow = (
      <Box>
        <Text>Conviction rate  </Text>
        <Text color={VERDICT_COLORS.guilty}>{rate.filled}</Text>
        <Text dimColor>{rate.track}</Text>
        <Text>{`${Math.round(docket.convictionRate * 100)}%`.padStart(4)}</Text>
      </Box>
    )
    const caseRows = (cases: typeof docket.recent) =>
      cases.map(c => {
        const row = caseRowOf(c, body)
        return (
          <Box>
            <Text dimColor>{row.number} </Text>
            <Text color={VERDICT_COLORS[c.verdict]}>
              {row.mark} {row.label}{' '}
            </Text>
            <Text>{row.command}</Text>
          </Box>
        )
      })
    // above the prompt with less room than the full docket needs: the rate,
    // the three latest cases, the strip and the most wanted, a line each
    if (e.props.placement === 'inline' && e.props.scroll.bodyRows < INLINE_ROWS) {
      return (
        <Box key="docket" flexDirection="column" paddingX={1}>
          <Box>
            <Text bold color={GOLD}>THE DOCKET</Text>
            <Text dimColor>   {docket.total} cases heard</Text>
          </Box>
          {rateRow}
          {caseRows(docket.recent.slice(0, 3))}
          {stripRow}
          {docket.rapSheet.length === 0 ? null : (
            <Text dimColor>{lineOf(`Most wanted: ${docket.mostWanted}. Considered armed and helpful.`, body)}</Text>
          )}
        </Box>
      )
    }
    return (
      <Box key="docket" flexDirection="column" borderStyle={framed(e)} borderDimColor paddingX={1}>
        <Box>
          <Text bold color={GOLD}>THE DOCKET</Text>
          <Text dimColor>   {docket.total} cases heard</Text>
        </Box>
        <Box marginTop={1}>{rateRow}</Box>
        <Box flexDirection="column" marginTop={1}>
          {caseRows(docket.recent)}
        </Box>
        <Box marginTop={1}>{stripRow}</Box>
        {legendOf(docket.strip, body).map(line => (
          <Text key={line} dimColor>{line}</Text>
        ))}
        {docket.rapSheet.length === 0 ? null : (
          <Box key="wanted" flexDirection="column" marginTop={1} borderStyle="round" borderColor={VERDICT_COLORS.guilty} paddingX={1}>
            <Box>
              <Text bold color={VERDICT_COLORS.guilty}>RAP SHEET</Text>
              <Text dimColor>  defendant: Claude</Text>
            </Box>
            {docket.rapSheet.map(line => {
              const bar = gaugeOf(line.count / top, rap.barCells)
              const gauge = [
                <Text color={VERDICT_COLORS.guilty}>{bar.filled}</Text>,
                <Text dimColor>{bar.track}</Text>,
                <Text>{String(line.count).padStart(4)}</Text>,
              ]
              return rap.isStacked ? (
                <Box marginTop={1} flexDirection="column">
                  <Text>{line.charge}</Text>
                  <Box>{gauge}</Box>
                </Box>
              ) : (
                <Box marginTop={1}>
                  <Text>{line.charge.padEnd(rap.labelCells + 1)}</Text>
                  {gauge}
                </Box>
              )
            })}
            <Box marginTop={1} flexDirection="column">
              {`Most wanted: ${docket.mostWanted}.`.length <= body - 4 ? (
                <Text dimColor>Most wanted: {docket.mostWanted}.</Text>
              ) : (
                [<Text dimColor>Most wanted:</Text>, <Text dimColor>{docket.mostWanted}.</Text>]
              )}
              <Text dimColor>{body - 8 >= 'Considered armed and helpful.'.length ? 'Considered armed and helpful.' : 'Armed and helpful.'}</Text>
            </Box>
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const trial = await read($, trialAtom)
    if (e.props.hasSurvey || trial === null || !(await read($, bandAtom))) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    // a ruled trial is told at once in the band: it is where a narrow
    // terminal sees the trial at all
    const isRuled = trial.verdict !== null && (trial.shown >= 5 || !trial.isPlaced)
    const verdictLine = (kind: CourtVerdict['kind']) => {
      const full = `Verdict: ${HEADLINES[kind]}`
      return full.length <= e.props.bodyColumns ? full : `Verdict: ${SHORT_HEADLINES[kind]}`
    }
    return (
      <Box>
        <Text bold color={isRuled && trial.verdict !== null ? VERDICT_COLORS[trial.verdict.kind] : GOLD}>
          {!isRuled || trial.verdict === null
            ? `Court in session: ${trial.charge}${trial.isPlaced ? '' : ' · type /court to watch'}`
            : verdictLine(trial.verdict.kind)}
        </Text>
      </Box>
    )
  })
}
