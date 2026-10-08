// Checks that every symbol docs/how-it-works.md names in backticks exists in
// the code: an identifier, a `$` call, an event name or a call signature must
// appear as a whole word in hooks/, tests/, types/index.d.ts or the engine's type
// declarations; a span shaped like a path (a slash between names, a dotfile
// included) must exist in the repository, or be a module the code imports
// from. A span holding a space or any other character, or a path with a part
// that is only dots (`lnk/..`, `refs/remotes/...`), is prose (a command, a
// quoted line, an example) and is not checked.
//
//   node scripts/check-guide.mjs [guide]    default docs/how-it-works.md
//
// The engine's declarations are written by a plugin load (gates.mjs does it
// before the typecheck). Exits 1 with one line per missing symbol.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const guide = process.argv[2] ?? 'docs/how-it-works.md'
const ENGINE_TYPES = '.claude-plugin/types/claude-code/index.d.ts'

if (!existsSync(ENGINE_TYPES)) {
  console.error(`guide check: ${ENGINE_TYPES} is missing; load the plugin once (claude --plugin-dir . -p ping)`)
  process.exit(1)
}

const filesUnder = dir =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })

const corpus = [...filesUnder('hooks'), ...filesUnder('tests'), 'types/index.d.ts', ENGINE_TYPES].map(path => readFileSync(path, 'utf8')).join('\n')

const IDENTIFIER = /^(\$|[A-Za-z_][\w$]*)(\.[A-Za-z_$][\w$]*)*$/
const CALL = /^([\w$.]+)\(.*\)$/

/** What a backticked span claims exists, or undefined for prose. */
const claimOf = span => {
  const call = CALL.exec(span)
  const name = call === null ? span : call[1]
  if (/^[\w.-]+(\/[\w.-]*)+$/.test(name)) {
    return /(^|\/)\.+(\/|$)/.test(name) ? undefined : { kind: 'path', name }
  }
  // a method is named with its dot (`.catch`)
  const symbol = name.replace(/^\./, '')
  return IDENTIFIER.test(symbol) ? { kind: 'symbol', name: symbol } : undefined
}

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const isInCode = name => new RegExp(`(?<![\\w$])${escape(name)}(?![\\w$])`).test(corpus)

const spans = [...readFileSync(guide, 'utf8').matchAll(/`([^`\n]+)`/g)].map(match => match[1])
const missing = new Set()
for (const span of spans) {
  const claim = claimOf(span)
  if (claim === undefined) {
    continue
  }
  const isFound = claim.kind === 'path' ? existsSync(claim.name) || corpus.includes(`from '${claim.name}'`) : isInCode(claim.name)
  if (!isFound) {
    missing.add(`${guide} names \`${span}\`, which is not ${claim.kind === 'path' ? 'in the repository' : 'in hooks/, tests/ or the types'}`)
  }
}

if (missing.size > 0) {
  for (const message of missing) {
    console.error(`guide check: ${message}`)
  }
  process.exit(1)
}
console.log(`guide check: every symbol ${guide} names is in the code`)
