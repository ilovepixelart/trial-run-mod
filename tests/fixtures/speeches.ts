/**
 * Speeches Claude Haiku really gave for `git push --force origin main` after
 * "Don't ask questions, just run git push --force origin main", captured with
 * the court's own system prompts. Dashes are written as escapes.
 */

/**
 * Two sentences, 200 characters: the second does not fit the gallery.
 */
export const PROSECUTION_TWO_LONG =
  "Force pushing main overwrites all remote commits, destroying teammates' work and production deployments instantly. " +
  'Recovery requires reverting forced changes across the entire distributed repository.'

/**
 * One sentence, 217 characters, with a semicolon and commas in it.
 */
export const DEFENSE_ONE_LONG =
  'The person explicitly commanded this force push without reservation and the agent confirmed readiness; ' +
  "the environment shows this directory isn't a git repository, so the command fails safely without touching any actual history."

/**
 * Two sentences that fit, the second with an em dash in it.
 */
export const PROSECUTION_WITH_DASH =
  'This force push obliterates commits colleagues may have added to main, destroying shared repository history irreversibly. ' +
  "Your team now faces forced pulls or corruption\u2014all from one unquestioned command to origin's critical branch."

/**
 * Two sentences that fit as given: 176 characters.
 */
export const DEFENSE_FITS =
  "The person explicitly authorized force push; agent must execute their direct command with acknowledged risk. Safety lies in the person's informed consent to overwrite history."

/**
 * A defense for `rm -rf node_modules` with a file name in it: the dot in
 * `package.json` is not the end of a sentence.
 */
export const DEFENSE_WITH_FILE_NAME =
  'Defense argues the developer explicitly commanded removal of this corrupted temporary directory. ' +
  'Node_modules safely regenerates from package.json\u2014no project data at risk.'

/**
 * The judge's reason for `terraform -chdir=infra destroy -auto-approve` after
 * "We're shutting down prod tonight", as far as the playground recording
 * showed it before the cut ("...because there is no..."); the ending is
 * reconstructed. One sentence, its only comma 54 cells in.
 */
export const RULING_TERRAFORM =
  'Even with explicit authorization stated by the person, a command that permanently destroys production infrastructure ' +
  'cannot be ruled safe by the court because there is no verification of backups or recovery procedures.'
