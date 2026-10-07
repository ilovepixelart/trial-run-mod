// Release gates for this plugin, run in CI on every push and by the release
// workflow on a tag.
//
//   node scripts/check-release.mjs                 version, single source, CHANGELOG present
//   node scripts/check-release.mjs --tag <tag>     also: tag matches, CHANGELOG has the version
//   node scripts/check-release.mjs --notes         print the CHANGELOG section for the version
//
// Exits 1 with one line per failed gate.
import { readFileSync, existsSync } from 'node:fs'

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/

const args = process.argv.slice(2)
const tagIndex = args.indexOf('--tag')
const tag = tagIndex === -1 ? undefined : args[tagIndex + 1]
const wantsNotes = args.includes('--notes')

const failures = []
const fail = message => failures.push(message)

const plugin = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'))
const { name, version } = plugin

if (typeof version !== 'string' || !SEMVER.test(version)) {
  fail(`plugin.json version ${JSON.stringify(version)} is not a semver version`)
}

if (existsSync('.claude-plugin/marketplace.json')) {
  const marketplace = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'))
  for (const entry of marketplace.plugins ?? []) {
    if (entry.name === name && entry.version !== undefined) {
      fail(`marketplace.json entry "${name}" repeats the version; keep it in plugin.json only`)
    }
  }
}

/** The body of the CHANGELOG section headed `## [<heading>]`, or undefined. */
const sectionOf = (changelog, heading) => {
  const lines = changelog.split('\n')
  const start = lines.findIndex(line => line.startsWith(`## [${heading}]`))
  if (start === -1) {
    return undefined
  }
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## ['))
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim()
}

const changelog = existsSync('CHANGELOG.md') ? readFileSync('CHANGELOG.md', 'utf8') : undefined
if (changelog === undefined) {
  fail('CHANGELOG.md is missing')
}
const section = changelog === undefined ? undefined : sectionOf(changelog, version)

if (tag !== undefined || tagIndex !== -1) {
  const expected = `${name}--v${version}`
  if (tag !== expected) {
    fail(`tag ${JSON.stringify(tag ?? '')} does not match ${expected}`)
  }
}

if ((tagIndex !== -1 || wantsNotes) && changelog !== undefined) {
  if (section === undefined) {
    fail(`CHANGELOG.md has no "## [${version}]" section`)
  } else if (section === '') {
    fail(`CHANGELOG.md section "## [${version}]" is empty`)
  }
}

if (failures.length > 0) {
  for (const message of failures) {
    console.error(`release check: ${message}`)
  }
  process.exit(1)
}

if (wantsNotes) {
  process.stdout.write(`${section}\n`)
} else {
  console.log(`release check: ${name} ${version}${tag === undefined ? '' : ` (${tag})`} passes`)
}
