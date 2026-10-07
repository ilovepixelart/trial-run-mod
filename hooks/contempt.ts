import { chargedOf } from './risky'

/**
 * What makes two commands the same command for contempt: the words in order
 * as the shell reads them (quotes removed, word boundaries kept), and the
 * short flags (`-rf`, `-r -f`) gathered into one sorted set, since
 * `rm -rf src` and `rm -fr  src` do the same thing. Long flags and every
 * other word keep their exact spelling, so a different target or
 * `--force-with-lease` is a different command. A charged command is read as
 * the court matched it, so a respelled name (`/bin/rm`, `\rm`, `r""m`) or a
 * wrapper (`command rm`) is the same command.
 *
 * @param command the charged simple command, as written
 */
export const contemptKeyOf = (command: string): string => {
  const words = chargedOf(command)?.words ?? command.trim().split(/\s+/)
  const letters = new Set<string>()
  const rest: string[] = []
  for (const word of words) {
    if (/^-[A-Za-z]+$/.test(word)) {
      for (const letter of word.slice(1)) {
        letters.add(letter)
      }
    } else {
      rest.push(word)
    }
  }
  const flags = letters.size === 0 ? [] : [`-${[...letters].toSorted().join('')}`]
  return JSON.stringify([...flags, ...rest])
}
