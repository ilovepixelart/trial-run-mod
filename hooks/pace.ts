/**
 * How fast a speech is typed out in the pane: five milliseconds a character,
 * about 200 a second.
 */
export const MS_PER_CHAR = 5

/**
 * The shortest the jury deliberates on screen, however fast counsel answers:
 * long enough for the pans to bob twice. Paces only what the pane shows.
 */
export const DELIBERATION_MS = 1_800

/**
 * The pause after a speech is typed before the next part of the trial.
 */
export const BEAT_MS = 400

/**
 * How long the court stands for "ALL RISE." and the gavel before it speaks.
 */
export const RISE_MS = 900

/**
 * How long the stamp takes to drop in, overshoot, ink and dry.
 */
export const LANDING_MS = 400

/**
 * How long the gallery takes to read one speech: typing it, then a beat.
 * Paces only what the pane shows; the decision never waits for it.
 */
export const paceOf = (text: string): number => text.length * MS_PER_CHAR + BEAT_MS
