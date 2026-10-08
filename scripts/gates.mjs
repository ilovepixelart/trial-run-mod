// Every gate CI and the release workflow run, in their order, stopping at the
// first that fails. Both workflows call this script, so a green local run is
// the same check CI makes.
//
//   node scripts/gates.mjs                 the gates
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

const TYPES = '.claude-plugin/types/claude-code/index.d.ts'

const gates = [
  ['release check', 'node', ['scripts/check-release.mjs', ...(tag === undefined ? [] : ['--tag', tag])]],
  ['validate', 'claude', ['plugin', 'validate', '--strict', '.']],
  ['test', 'claude', ['plugin', 'test', '.']],
  ['hostile git repositories', 'node', ['--test', 'tests/hostile/git.hostile.mjs']],
  ['typecheck', 'npx', ['-y', '-p', 'typescript', 'tsc', '-p', '.']],
  ['guide symbols', 'node', ['scripts/check-guide.mjs']],
]

const run = (name, command, argv) => {
  console.log(`\n== ${name}: ${[command, ...argv].join(' ')}`)
  const { status } = spawnSync(command, argv, { stdio: 'inherit' })
  if (status !== 0) {
    console.error(`\n${name} failed (exit ${status})`)
    process.exit(status ?? 1)
  }
}

const writeTypes = () => {
  if (existsSync(TYPES)) {
    return
  }
  // the plugin load writes the declarations, then stops at the login check
  // when there are no credentials, so its exit code is not the gate
  console.log(`\n== type declarations: claude --plugin-dir . -p ping`)
  spawnSync('claude', ['--plugin-dir', '.', '-p', 'ping'], { stdio: 'inherit' })
  if (!existsSync(TYPES)) {
    console.error(`\ntype declarations failed: ${TYPES} was not written`)
    process.exit(1)
  }
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
    writeTypes()
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
