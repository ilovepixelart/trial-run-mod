export type CourtRole = 'prosecutor' | 'defense' | 'judge'

export type CourtSpeech = { role: CourtRole; text: string }

export type CourtVerdict = {
  kind: 'guilty' | 'acquitted' | 'hung' | 'waived' | 'contempt'
  reason: string
  decision: 'allow' | 'ask' | 'deny'
  /**
   * The court's sentence for a conviction: a safer way to do it.
   */
  sentence?: string
}

export type CourtTrial = {
  id: number
  command: string
  charge: string
  /**
   * The case's number on the docket, and the defendant's prior convictions
   * on the same charge.
   */
  number: number
  priors: number
  /**
   * The facts the court read from the repository, as "Exhibit A: ..." lines.
   */
  exhibits: string[]
  speeches: CourtSpeech[]
  verdict: CourtVerdict | null
  /**
   * How much of the trial the gallery has been shown: 0 nothing yet (the
   * jury deliberates), 1 the prosecution, 2 the defense too, 3 all rise,
   * 4 the court, 5 the verdict stamped.
   */
  shown: number
  /**
   * Whether the stamp is still landing.
   */
  isLanding: boolean
  /**
   * Whether the court's pane is drawn: a pane the court opens on its own
   * waits undrawn on a narrow terminal, and the band says how to open it.
   */
  isPlaced: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'trial-run': { trial: CourtTrial | null; isBandShown: boolean }
  }
}
