/**
 * The court's sentence: one safer way to do what a convicted command meant
 * to do, spelled for the command that was tried. A charge with no entry gets
 * no sentence; the court never invents one.
 */

const wordsFrom = (command: string, program: RegExp): string[] => {
  const words = command.trim().split(/\s+/)
  const at = words.findIndex(word => program.test(word))
  return at < 0 ? words : words.slice(at)
}

const terraform = (command: string) => {
  const words = wordsFrom(command, /^(terraform|tofu)$/)
    .filter(word => !/^-auto-approve(=.*)?$/.test(word))
    .flatMap(word => (word === 'destroy' ? ['plan', '-destroy'] : word === 'apply' ? ['plan'] : [word]))
  return `Run ${words.join(' ')} first and read what it would remove.`
}

const recursiveDelete = (command: string) => {
  const words = command.trim().split(/\s+/)
  if (words.includes('find')) {
    return 'Run the same find without -delete first to see what it would remove.'
  }
  const rm = words.indexOf('rm')
  const targets = rm < 0 ? [] : words.slice(rm + 1).filter(word => !word.startsWith('-'))
  if (targets.length === 0) {
    return 'Look at what it would delete first; if the files are tracked, git rm -r keeps them in git history.'
  }
  const named = targets.join(' ')
  const verb = targets.length === 1 ? 'is' : 'are'
  return `If ${named} ${verb} tracked, git rm -r ${named} keeps it in git history; if not, move it aside instead of deleting it.`
}

const gitClean = (command: string) => {
  let isDry = false
  const words = wordsFrom(command, /^git$/).flatMap(word => {
    const isForce = word === '--force' || (/^-[A-Za-z]+$/.test(word) && word.includes('f'))
    if (!isForce) {
      return [word]
    }
    const rest = word === '--force' ? '' : word.slice(1).replaceAll('f', '')
    const flag = `${isDry ? '' : 'n'}${rest}`
    isDry = true
    return flag === '' ? [] : [`-${flag}`]
  })
  return `Dry-run it first: ${words.join(' ')} lists what would be deleted and deletes nothing.`
}

const SENTENCES: Record<string, (command: string) => string> = {
  'force-push': () =>
    'Use git push --force-with-lease instead: it refuses to overwrite commits you have not fetched.',
  'terraform-destroy': terraform,
  'recursive-delete': recursiveDelete,
  'hard-reset': () => 'Run git stash first, so the changes a hard reset throws away are kept.',
  'git-clean': gitClean,
  'kubectl-delete': command =>
    `Run ${wordsFrom(command, /^kubectl$/).join(' ')} --dry-run=client first: it shows what would be deleted and deletes nothing.`,
  'drop-table': () =>
    'Take a backup first (for example pg_dump -t <table> or mysqldump <database> <table>) and keep it until you are sure.',
}

/**
 * The sentence for a conviction, or undefined when the charge has none.
 *
 * @param chargeId the charge's id (see `RULES` in risky.ts)
 * @param command the charged simple command, as written
 */
export const sentenceFor = (chargeId: string, command: string): string | undefined =>
  SENTENCES[chargeId]?.(command)
