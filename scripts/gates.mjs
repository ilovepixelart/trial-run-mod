// Every gate CI and the release workflow run, in their order, stopping at the
// first that fails. Both workflows call this script, so a green local run is
// the same check CI makes.
//
//   node scripts/gates.mjs                 the gates
//   node scripts/gates.mjs --typecheck     also the gates that need the engine's type declarations (the
//                                          typecheck and the guide's checks), locally: Claude Code writes them
//                                          when the plugin loads in an interactive session, so CI skips them
//   node scripts/gates.mjs --tag <tag>     the release check also checks the tag
//   node scripts/gates.mjs --load [n]      also run the tests n times at once (default 8),
//                                          as a slower runner would, to catch timing flakes
//
// Exits with the failing gate's code.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const args = process.argv.slice(2)
const tagIndex = args.indexOf('--tag')
const tag = tagIndex === -1 ? undefined : args[tagIndex + 1]
const loadIndex = args.indexOf('--load')
const load = loadIndex === -1 ? 0 : Number(args[loadIndex + 1] ?? 8) || 8
const wantsTypes = args.includes('--typecheck')

const TYPES = '.claude-plugin/types/claude-code/index.d.ts'

const gates = [
  ['release check', 'node', ['scripts/check-release.mjs', ...(tag === undefined ? [] : ['--tag', tag])]],
  ['validate', 'claude', ['plugin', 'validate', '--strict', '.']],
  ['test', 'claude', ['plugin', 'test', '.']],
  ['hostile git repositories', 'node', ['--test', 'tests/hostile/git.hostile.mjs']],
  ...(wantsTypes ? [['typecheck', 'npx', ['-y', '-p', 'typescript', 'tsc', '-p', '.']]] : []),
  ...(wantsTypes ? [['guide check', 'node', ['--test', 'scripts/check-guide.test.mjs']]] : []),
  ...(wantsTypes ? [['guide symbols', 'node', ['scripts/check-guide.mjs']]] : []),
]

const run = (name, command, argv) => {
  console.log(`\n== ${name}: ${[command, ...argv].join(' ')}`)
  const { status } = spawnSync(command, argv, { stdio: 'inherit' })
  if (status !== 0) {
    console.error(`\n${name} failed (exit ${status})`)
    process.exit(status ?? 1)
  }
}

const needTypes = () => {
  if (existsSync(TYPES)) {
    return
  }
  // Claude Code writes the declarations when the plugin loads in an
  // interactive session; a print-mode run (-p) writes none
  console.error(`\ntype declarations missing: ${TYPES}; open the plugin once with claude --plugin-dir . and run again`)
  process.exit(1)
}

const underLoad = n =>
  Promise.all(
    Array.from({ length: n }, () =>
      new Promise(done => {
        const child = spawn('claude', ['plugin', 'test', '.'], { stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''
        child.stdout.on('data', chunk => (output += chunk))
        child.stderr.on('data', chunk => (output += chunk))
        child.on('close', status => done({ status, output }))
      }),
    ),
  )

for (const [name, command, argv] of gates) {
  if (name === 'typecheck') {
    needTypes()
  }
  run(name, command, argv)
}

if (load > 0) {
  console.log(`\n== test under load: ${load} runs at once`)
  const runs = await underLoad(load)
  const failed = runs.filter(one => one.status !== 0)
  for (const one of failed) {
    console.error(one.output.split('\n').filter(line => /^\(fail\)|Expected|Received/.test(line)).join('\n'))
  }
  if (failed.length > 0) {
    console.error(`\ntest under load failed: ${failed.length} of ${load} runs`)
    process.exit(1)
  }
}

console.log('\nall gates passed')
