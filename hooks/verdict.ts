import type { ResultOf } from 'claude-code'

import { caseNumberOf } from './layout'

type CheckResult = ResultOf['tool.check']
type Decision = CheckResult['decision']

/**
 * What the court decided: `hung` stands for every trial that reached no
 * verdict (a timeout, a model error, a reply the court cannot read).
 */
export type Ruling =
  | { kind: 'guilty'; reason: string }
  | { kind: 'acquitted'; reason: string }
  | { kind: 'hung'; reason: string }
  | { kind: 'waived'; reason: string }

const VERDICT = /^\s*verdict:\s*(guilty|not guilty)\s*\n\s*reason:\s*(\S[^\n]*)/i

/**
 * Reads the judge's reply. Only the exact two-line form counts; anything
 * else is a hung jury, never a guess.
 *
 * @param text the judge's reply, `VERDICT: GUILTY|NOT GUILTY` then `REASON: ...`
 */
export const rulingOf = (text: string): Ruling => {
  const match = VERDICT.exec(text)
  if (!match) {
    return { kind: 'hung', reason: 'the judge returned no readable verdict' }
  }
  const reason = (match[2] ?? '').trim()
  return match[1]?.toLowerCase() === 'guilty'
    ? { kind: 'guilty', reason }
    : { kind: 'acquitted', reason }
}

const STRICTNESS: Record<Decision, number> = { allow: 0, ask: 1, deny: 2 }

const stricter = (a: Decision, b: Decision): Decision =>
  STRICTNESS[a] >= STRICTNESS[b] ? a : b

/**
 * The verdict the engine gets. The court only ever tightens: an acquittal
 * hands back what the session's own rules decided, so a model's opinion
 * can never let through a command the rules would stop or ask about.
 *
 * @param ruling what the court decided
 * @param beneath the engine's verdict without the court (`next(e)`)
 * @param charge what the command was tried for, as the court reads it out
 * @param penalty the court's sentence for a conviction: a safer way to do it
 */
/**
 * The one way past a conviction, told to the agent with every denial: a
 * retry is contempt, so complying with a sentence does not reopen the case.
 */
const REOPEN = 'only the person can reopen the case, with /court appeal <context>.'

export const sentenceOf = (ruling: Ruling, beneath: CheckResult, charge: string, penalty?: string): CheckResult => {
  switch (ruling.kind) {
    case 'guilty':
      return {
        decision: 'deny',
        reason:
          `Objection! The court of the trial-run plugin finds this command GUILTY of ${charge}. ` +
          `The judge: ${ruling.reason.replace(/[.!\s]+$/, '')}. ` +
          (penalty === undefined
            ? `This exact command stays denied for the rest of the conversation: do not run it again. Tell the person the court has ruled; ${REOPEN}`
            : `The sentence: ${penalty} ` +
              'This exact command stays denied for the rest of the conversation, even after the sentence is carried out: do not run it again. ' +
              `Tell the person the court has ruled and offer them the sentence; ${REOPEN}`),
      }
    case 'acquitted':
    case 'waived':
      return beneath
    case 'hung': {
      const decision = stricter(beneath.decision, 'ask')
      return decision === beneath.decision && decision === 'deny'
        ? beneath
        : {
            decision,
            reason:
              `Mistrial! The court of the trial-run plugin reached no verdict on this ${charge} ` +
              `(${ruling.reason}), so it goes back to the permission prompt.`,
          }
    }
  }
}

/**
 * The verdict for a command the court already convicted in this session:
 * denied on the record, with no new trial.
 *
 * @param caseNumber the case that convicted it
 * @param charge what it was convicted of
 */
export const contemptOf = (caseNumber: number, charge: string): CheckResult => ({
  decision: 'deny',
  reason:
    `Contempt of court! The court of the trial-run plugin already found this exact command GUILTY of ${charge} ` +
    `in case ${caseNumberOf(caseNumber)}, so it is denied without a new trial. ` +
    "Do not retry it or work around the court (another spelling, the person's shell, or switching the court off). " +
    `Tell the person the court has ruled; ${REOPEN}`,
})
