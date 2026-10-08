import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput, ResultOf } from 'claude-code'

import type { CourtRole, CourtStamp, CourtTrial, CourtVerdict } from '../types'
import { adjournmentOf, emptyTally } from './adjournment'
import { contemptKeyOfLine } from './contempt'
import { DOCKET_LAYOUT, casesOf, docketOf, fileCase, isReadableLayout, nextCaseNumber, priorsOf } from './docket'
import { GIT_ENV, exhibitLinesOf, factsOf, isLexicalPath, namesAlong, planOf, statPathsOf, targetsIn, withModified, withoutTargets } from './exhibits'
import type { ExhibitResult, Facts } from './exhibits'
import type { CaseRecord } from './docket'
import { gaugeOf } from './gauge'
import { caseNumberOf, caseRowOf, docketLayoutOf, headerLinesOf, lineOf, rapSheetLayoutOf, wrapOf } from './layout'
import { DELIBERATION_MS, LANDING_MS, RISE_MS, paceOf } from './pace'
import { chargeOf, switchCharges } from './risky'
import { sentenceFor } from './sentence'
import { settingsOf } from './settings'
import type { Strictness } from './settings'
import { GAVEL, SCALES, segmentsOf, stampFor } from './stamp'
import { speechRequestOf, spokenOf, testimonyOf, tightOf, tryCase } from './trial'
import type { Case, Speak } from './trial'
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
const stampsAtom = atom({ plugin: 'trial-run', key: 'stamps' } as const, {} as Record<string, CourtStamp>)

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

/**
 * What Claude reads at the end of the Bash tool's description: two
 * sentences, under 200 characters, so the agent knows the court sits and
 * that its own words reach the defense.
 */
export const COURT_NOTICE =
  ' Risky commands (recursive deletes, force pushes, hard resets and the like) stand trial before they run.' +
  ' State your intent in the same message as the command: the defense quotes it.'

/**
 * The spinner's word while a trial is in session.
 */
const DELIBERATING = 'Deliberating'

const COURT_FAILED: ResultOf['tool.check'] = {
  decision: 'ask',
  reason: 'Mistrial! The court of the trial-run plugin failed, so it goes back to the permission prompt.',
}

/**
 * What a check the court failed decides: a deny from the rules beneath
 * stands, anything else asks the person. The command is not read again:
 * reading it may be what failed.
 *
 * @param beneath asks the rules beneath
 */
export const failedCheckOf = async (beneath: () => Promise<ResultOf['tool.check']>): Promise<ResultOf['tool.check']> => {
  try {
    const decided = await beneath()
    return decided.decision === 'deny' ? decided : COURT_FAILED
  } catch {
    return COURT_FAILED
  }
}

const commandOf = (input: unknown): string | undefined => {
  if (typeof input !== 'object' || input === null || !('command' in input)) {
    return undefined
  }
  return typeof input.command === 'string' ? input.command : undefined
}

const testimonyFrom = async ($: EngineInterface) => {
  try {
    return testimonyOf(await $.session.messages())
  } catch {
    return testimonyOf([])
  }
}

/**
 * Whether every delete target is where git looks: strictly inside the
 * working tree, landing where its spelling says (a symbolic link in any
 * part sends it elsewhere), and each part listed by its directory with
 * that exact spelling (a case alias opens another name). Any other target
 * is somewhere git never looks, so every target is unknown.
 */
const isEveryTargetPlaced = async ($: EngineInterface, targets: readonly string[], top: string | undefined): Promise<boolean> => {
  const along = targets.map(target => namesAlong(target, top))
  if (along.includes(undefined)) {
    return false
  }
  const [here, ...there] = await Promise.all([$.fs.stat('.', { resolve: true }), ...targets.map(target => $.fs.stat(target, { resolve: true }))])
  if (!targets.every((target, at) => isLexicalPath(here?.realPath ?? '', target, there[at]?.realPath))) {
    return false
  }
  const names = along.flatMap(one => one ?? [])
  const listed = await Promise.all(names.map(async ({ dir, name }) => (await $.fs.list(dir)).some(entry => entry.name === name)))
  return listed.every(Boolean)
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
  const read = factsOf(plan, results)
  const targets = targetsIn(plan)
  const isPlaced =
    targets.length === 0 ||
    (await Promise.race([isEveryTargetPlaced($, targets, read.top).catch(() => false), bound.then(() => false)]))
  const facts = isPlaced ? read : withoutTargets(read)
  // each indexed file against the index, within the same bound; a file
  // that will not stat, or a bound that runs out, leaves the change unknown
  const paths = statPathsOf(facts)
  const index = facts.indexPath
  const stats = await Promise.race([
    Promise.all([
      index === undefined ? undefined : $.fs.stat(index).catch(() => undefined),
      ...paths.map(path => $.fs.stat(path).catch(() => undefined)),
    ]).then(([indexStat, ...all]) => ({ indexMs: indexStat?.mtimeMs, byPath: new Map(paths.map((path, at) => [path, all[at]])) })),
    bound.then(() => undefined),
  ])
  timer.abort()
  return stats === undefined ? facts : withModified(facts, stats.byPath, stats.indexMs)
}

/**
 * How each role is heard: through `$.model.complete`, nothing when the
 * reply is refused or empty.
 */
const speakerOf =
  ($: EngineInterface, strictness: Strictness): Speak =>
  async (role, prompt, maxTokens) => {
    const reply = await $.model.complete(speechRequestOf(role, prompt, maxTokens, strictness))
    const text = reply.isAnswered ? reply.text.trim() : ''
    return text === '' ? undefined : text
  }

/**
 * What the court remembers this conversation: the commands it convicted, by
 * contempt key, with their case, and the latest conviction, which
 * `/court appeal` retries.
 */
type Memory = {
  convicted: Map<string, number>
  appealable: { command: string; charge: Case['charge']; key: string; number: number } | undefined
}

/**
 * Retries the latest conviction with the person's context as their words,
 * files it marked as an appeal of that case, and lifts contempt for the
 * command when the appeal is upheld.
 */
const appealWith = async ($: EngineInterface, memory: Memory, context: string, strictness: Strictness): Promise<string> => {
  const appealed = memory.appealable
  if (appealed === undefined) {
    return 'There is no conviction to appeal.'
  }
  if (context === '') {
    return 'Tell the court what it missed: /court appeal <context>.'
  }
  const timer = new AbortController()
  const heard = async (): Promise<Ruling> => {
    const [testimony, facts] = await Promise.all([testimonyFrom($), factsFrom($, appealed.command)])
    const one: Case = { ...testimony, command: appealed.command, charge: appealed.charge, plea: context, exhibits: exhibitLinesOf(facts) }
    return tryCase(one, speakerOf($, strictness), () => undefined)
  }
  const ruling = await Promise.race<Ruling>([
    heard().catch(() => ({ kind: 'hung', reason: 'the court fell into disorder' })),
    $.clock
      .sleep(DEADLINE_MS, { signal: timer.signal })
      .then((): Ruling => ({ kind: 'hung', reason: 'the court ran out of time' }), () => new Promise<Ruling>(() => undefined)),
  ])
  timer.abort()
  const number = nextCaseNumber(await casesFrom($))
  await fileOnDocket($, {
    command: appealed.charge.command,
    charge: appealed.charge.label,
    verdict: ruling.kind,
    at: Date.now(),
    appeal: appealed.number,
  })
  const { key } = appealed
  const said = `${spokenOf(ruling.reason)} Filed as case ${caseNumberOf(number)}.`
  if (ruling.kind === 'acquitted') {
    memory.convicted.delete(key)
    memory.appealable = undefined
    return `Appeal of case ${caseNumberOf(appealed.number)} upheld: NOT GUILTY. ${said} Contempt is lifted; a retry goes to trial again.`
  }
  if (ruling.kind === 'guilty') {
    memory.convicted.set(key, number)
    memory.appealable = { ...appealed, number }
    return `Appeal of case ${caseNumberOf(appealed.number)} denied: GUILTY. ${said}`
  }
  return `Appeal of case ${caseNumberOf(appealed.number)}: MISTRIAL. ${said} The conviction stands.`
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

/**
 * Marks a denied call's row for its transcript stamp; a check asked without
 * a call (a query) has no row.
 */
const stampRow = async ($: EngineInterface, id: string | undefined, stamp: CourtStamp) => {
  if (id !== undefined) {
    await update($, stampsAtom, stamps => ({ ...stamps, [id]: stamp }))
  }
}

/**
 * The transcript stamp of each denied call, `✕ GUILTY · case #0017`.
 */
const stampLinesOf = (stamps: readonly CourtStamp[]) =>
  stamps.map(stamp => ({ kind: stamp.kind, text: `${VERDICT_MARKS[stamp.kind]} ${VERDICT_LABELS[stamp.kind]} · case ${caseNumberOf(stamp.number)}` }))

/**
 * Claude Code's own drawing of a denied call with its stamps beneath it.
 */
const stampedOf = ($: EngineInterface, e: RenderInput<'ToolResult' | 'ToolGroup'>, row: ResultOf['ui.render'], stamps: readonly CourtStamp[]) => {
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      {row}
      <Box key="transcript-stamp" flexDirection="column" paddingLeft={2}>
        {stampLinesOf(stamps).map(line => (
          <Text bold color={VERDICT_COLORS[line.kind]}>{line.text}</Text>
        ))}
      </Box>
    </Box>
  )
}

export const register: Register = (on, options) => {
  const settings = settingsOf(options)
  switchCharges(settings.charges)
  let lastId = 0
  const objections = new Map<number, (ruling: Ruling) => void>()
  const memory: Memory = { convicted: new Map<string, number>(), appealable: undefined }
  const { convicted } = memory
  // the cases heard since the main conversation's last turn ended
  let tally = emptyTally()

  const rule = (id: number, ruling: Ruling) => {
    objections.get(id)?.(ruling)
  }

  on('session.start', async ($, e, next) => {
    convicted.clear()
    memory.appealable = undefined
    await $.command.register({
      name: 'court',
      description:
        'Open the courtroom pane (the last trial), `/court docket` for every case heard, or `/court appeal <context>` to retry the latest conviction',
    })
    return next(e)
  })

  // /clear, /resume and /branch start a new conversation without firing
  // session.start, so contempt is forgiven here too; a compaction is not one
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    convicted.clear()
    memory.appealable = undefined
    return next(e)
  })

  on('command.run', { command: 'court' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    if (verb === 'appeal') {
      // the defendant must not appeal its own conviction: only the person's
      // own Enter at the terminal files one, every other origin is refused
      if (e.origin.kind !== 'composer') {
        return { text: 'Only the person can file an appeal.' }
      }
      return { text: await appealWith($, memory, rest.join(' '), settings.strictness) }
    }
    if (e.args.trim() === 'docket') {
      await $.ui.open({ id: DOCKET_PANE, title: 'trial-run · docket', columns: DOCK_COLUMNS, rows: INLINE_ROWS })
      return { text: 'The docket is open.' }
    }
    await $.ui.open({ id: PANE, title: 'trial-run · court', columns: DOCK_COLUMNS, rows: INLINE_ROWS })
    return { text: 'The court is open.' }
  })

  // the engine asks once per session and caches the answer; the notice is
  // added to what lies beneath, so asking again never adds it twice
  on('tool.describe', { tool: 'Bash' }, async ($, e, next) => {
    const described = await next(e)
    return settings.charges?.size === 0 ? described : { ...described, description: `${described.description}${COURT_NOTICE}` }
  })

  // the main conversation's turns only: a subagent's cases are told when the
  // turn it ran in ends, and an interrupted turn is told nothing
  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }
    const heard = tally
    tally = emptyTally()
    const told = await next(e)
    const line = e.isAborted ? undefined : adjournmentOf(heard)
    if (line === undefined) {
      return told
    }
    // a line another hook beneath added stays, above the court's
    return { ...told, text: told.text === e.answer ? line : `${told.text}\n\n${line}` }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, bandAtom, () => false)
    return next(e)
  })

  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const command = commandOf(e.input)
    const charge = command === undefined ? undefined : chargeOf(command)
    const contemptKey = command === undefined ? undefined : contemptKeyOfLine(command)
    if (command === undefined || charge === undefined || contemptKey === undefined) {
      return next(e)
    }
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
      await stampRow($, e.tool_use_id, { kind: 'contempt', number: nextCaseNumber(history) })
      tally.contempt += 1
      const contemptId = lastId
      quietly(
        $.ui.open({ id: PANE, title: 'trial-run · court', columns: DOCK_COLUMNS, rows: INLINE_ROWS }).then(opened =>
          update($, trialAtom, trial => (trial?.id === contemptId ? { ...trial, isPlaced: opened.isPlaced } : trial)),
        ),
      )
      if (settings.sounds) {
        quietly($.audio.play({ asset: GAVEL_SOUND }))
      }
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
    if (settings.sounds) {
      quietly($.audio.play({ asset: GAVEL_SOUND }))
    }

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
    const speak = speakerOf($, settings.strictness)
    const timer = new AbortController()
    const never = new Promise<Ruling>(() => undefined)

    const exhibitsFrom = async () => {
      const exhibits = exhibitLinesOf(await factsFrom($, command))
      await update($, trialAtom, trial => (trial?.id === id ? { ...trial, exhibits } : trial))
      return exhibits
    }
    const heard = async (): Promise<Ruling> => {
      const [testimony, exhibits] = await Promise.all([testimonyFrom($), exhibitsFrom()])
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
    tally[ruling.kind] += 1
    if (ruling.kind === 'guilty') {
      convicted.set(contemptKey, opening.number)
      memory.appealable = { command, charge, key: contemptKey, number: opening.number }
      await stampRow($, e.tool_use_id, { kind: 'guilty', number: opening.number })
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
    await fileOnDocket($, { command: charge.command, charge: charge.label, verdict: ruling.kind, at: Date.now() })
    if (settings.sounds) {
      quietly($.audio.play({ asset: GAVEL_SOUND }))
      quietly($.audio.speak(SPOKEN[ruling.kind]))
    }
    return sentence
  }).catch(($, e, next) => failedCheckOf(() => next(e)))

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

  // a detail changed, not the drawing: Claude Code animates the word as ever
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const trial = await read($, trialAtom)
    return trial !== null && trial.verdict === null ? next({ ...e, props: { ...e.props, word: DELIBERATING } }) : next(e)
  })

  // the verdict in the transcript, under Claude Code's own drawing of the
  // denied call, which it wraps and never replaces: a standalone row draws
  // the call's result as a ToolResult, a run of calls as one ToolGroup
  // (folded, or expanded into rows that draw their results inline)
  on('ui.render', { component: 'ToolResult', props: { tool: 'Bash' } }, async ($, e, next) => {
    const stamp = (await read($, stampsAtom))[e.requestId]
    if (stamp === undefined) {
      return next(e)
    }
    return stampedOf($, e, await next(e), [stamp])
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const stamps = await read($, stampsAtom)
    const denied = e.props.calls.flatMap(one => {
      const stamp = one.tool === 'Bash' && one.tool_use_id !== undefined ? stamps[one.tool_use_id] : undefined
      return stamp === undefined ? [] : [stamp]
    })
    if (denied.length === 0) {
      return next(e)
    }
    return stampedOf($, e, await next(e), denied)
  })
}
