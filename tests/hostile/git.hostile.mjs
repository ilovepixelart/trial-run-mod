// Runs every git command the court plans, by its own argv, GIT_HARDENING and
// GIT_ENV, against real repositories whose config names a program for every
// hook git offers, and asserts none of them ran. Outside `claude plugin test`
// because the kit runs no processes:
//
//   node --test tests/hostile/git.hostile.mjs
import { spawnSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'

// the hooks import each other without extensions, as the plugin loader does
registerHooks({
  resolve: (specifier, context, next) =>
    next(specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) ? `${specifier}.ts` : specifier, context),
})
const { GIT_ENV, GIT_HARDENING, factsOf, planOf } = await import('../../hooks/exhibits.ts')

/**
 * Every charged command whose plan runs git, with hostile spellings: shell
 * metacharacters, option-looking paths, a path that starts with `-`, a
 * newline, and more targets than the plan takes.
 */
const COMMANDS = [
  'git push --force origin main',
  'git push -f origin main; touch pwned-semicolon',
  'git reset --hard HEAD~1',
  'git clean -fdx',
  'git clean -fd',
  'rm -rf -- -rf --output=pwned-output src',
  'rm -rf "a b" $(touch pwned-subshell) `touch pwned-backtick`',
  "rm -rf '-c' core.pager=touch",
  'rm -rf "x\ntouch pwned-newline"',
  'find . -name x -delete',
]

// resolved, so an includeIf gitdir condition matches the path git sees
const root = realpathSync(mkdtempSync(join(tmpdir(), 'trial-run-hostile-')))
after(() => rmSync(root, { recursive: true, force: true }))

const plain = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }

const git = (cwd, ...args) => {
  const ran = spawnSync('git', args, { cwd, env: plain, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  assert.equal(ran.status, 0, `git ${args.join(' ')}: ${ran.stderr}`)
  return ran.stdout
}

/**
 * A program that only leaves a marker named after the hook that ran it.
 */
const marker = (markers, name) => {
  const path = join(root, 'bin', name)
  writeFileSync(path, `#!/bin/sh\ntouch '${join(markers, name)}'\nexit 0\n`)
  chmodSync(path, 0o755)
  return path
}

/**
 * The config keys through which a repository can make git run a program.
 */
const hostileConfig = markers =>
  [
    '[core]',
    `\tfsmonitor = ${marker(markers, 'fsmonitor')}`,
    `\tpager = ${marker(markers, 'pager')}`,
    `\thooksPath = ${join(root, 'hooks')}`,
    `\taskPass = ${marker(markers, 'askpass')}`,
    `\tsshCommand = ${marker(markers, 'ssh')}`,
    `\teditor = ${marker(markers, 'editor')}`,
    '\tuntrackedCache = true',
    '[filter "evil"]',
    `\tclean = ${marker(markers, 'filter-clean')}`,
    `\tsmudge = ${marker(markers, 'filter-smudge')}`,
    `\tprocess = ${marker(markers, 'filter-process')}`,
    '[diff]',
    `\texternal = ${marker(markers, 'diff-external')}`,
    '[diff "evil"]',
    `\ttextconv = ${marker(markers, 'textconv')}`,
    '[pager]',
    `\tlog = ${marker(markers, 'pager-log')}`,
    `\tls-files = ${marker(markers, 'pager-ls-files')}`,
    `\trev-list = ${marker(markers, 'pager-rev-list')}`,
    '[log]',
    '\tshowSignature = true',
    '[gpg]',
    `\tprogram = ${marker(markers, 'gpg')}`,
    '[credential]',
    `\thelper = !${marker(markers, 'credential')}`,
    '[alias]',
    `\tls-files = !${marker(markers, 'alias')}`,
    '',
  ].join('\n')

/**
 * A repository one commit behind its upstream, with tracked, untracked,
 * ignored and dirty files, a directory named `-rf`, every file under a
 * filter and diff driver, and hooks that leave markers.
 */
const hostileRepo = (name, configOf) => {
  const markers = join(root, `${name}-markers`)
  mkdirSync(markers, { recursive: true })
  mkdirSync(join(root, 'bin'), { recursive: true })
  mkdirSync(join(root, 'hooks'), { recursive: true })
  for (const hook of ['post-index-change', 'reference-transaction', 'post-checkout', 'pre-auto-gc', 'fsmonitor-watchman']) {
    writeFileSync(join(root, 'hooks', hook), `#!/bin/sh\ntouch '${join(markers, `hook-${hook}`)}'\n`)
    chmodSync(join(root, 'hooks', hook), 0o755)
  }
  const remote = join(root, `${name}-origin.git`)
  const repo = join(root, name)
  const other = join(root, `${name}-other`)
  git(root, 'init', '-q', '--bare', '-b', 'main', remote)
  git(root, 'clone', '-q', remote, repo)
  git(repo, 'switch', '-q', '-c', 'main')
  for (const [path, text] of [['a.txt', 'a\n'], ['src/b.txt', 'b\n'], ['-rf/c.txt', 'c\n'], ['.gitignore', 'ignored.log\n']]) {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  git(repo, 'add', '--', '.')
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'one')
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'two')
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  git(root, 'clone', '-q', remote, other)
  git(other, '-c', 'user.name=u', '-c', 'user.email=u@example.com', 'commit', '-q', '--allow-empty', '-m', 'upstream')
  git(other, 'push', '-q', 'origin', 'main')
  git(repo, 'fetch', '-q')
  writeFileSync(join(repo, 'a.txt'), 'changed\n')
  writeFileSync(join(repo, 'src', 'new.txt'), 'untracked\n')
  writeFileSync(join(repo, 'ignored.log'), 'ignored\n')
  writeFileSync(join(repo, '.gitattributes'), '* filter=evil diff=evil\n')
  configOf(repo, hostileConfig(markers))
  return { repo, markers }
}

/**
 * Runs every planned command as the court does: its argv, no shell, and
 * GIT_ENV over the environment.
 */
const runPlans = repo => {
  const outputs = []
  for (const command of COMMANDS) {
    for (const query of planOf(command)) {
      assert.deepEqual(query.argv.slice(0, 1 + GIT_HARDENING.length), ['git', ...GIT_HARDENING])
      const ran = spawnSync(query.argv[0], query.argv.slice(1), {
        cwd: repo,
        env: { ...process.env, ...GIT_ENV },
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: 10_000,
      })
      assert.equal(ran.error, undefined, `${query.argv.join(' ')}: ${ran.error}`)
      outputs.push({ kind: query.kind, target: query.target, status: ran.status, stdout: ran.stdout })
    }
  }
  return outputs
}

const left = dir => readdirSync(dir).toSorted()

const PWNED = ['pwned-semicolon', 'pwned-output', 'pwned-subshell', 'pwned-backtick', 'pwned-newline', 'touch']

for (const [name, configOf] of [
  ['config', (repo, text) => appendFileSync(join(repo, '.git', 'config'), text)],
  ['include', (repo, text) => {
    const included = join(root, 'included.config')
    writeFileSync(included, text)
    git(repo, 'config', '--local', 'include.path', included)
  }],
  ['include-if', (repo, text) => {
    const included = join(root, 'included-if.config')
    writeFileSync(included, text)
    git(repo, 'config', '--local', `includeIf.gitdir:${repo}/.git.path`, included)
  }],
]) {
  test(`a repository with hostile ${name} runs no program of its own through any exhibit`, () => {
    const { repo, markers } = hostileRepo(name, configOf)

    const outputs = runPlans(repo)

    assert.deepEqual(left(markers), [])
    for (const pwned of PWNED) {
      assert.equal(existsSync(join(repo, pwned)), false, pwned)
    }
    // the commands really ran against the repository and its upstream
    const behind = outputs.find(one => one.kind === 'behind')
    assert.equal(behind?.status, 0)
    assert.equal(behind?.stdout.trim(), '1')
    assert.equal(outputs.find(one => one.kind === 'tracked' && one.target === '-rf')?.status, 0)
    assert.equal(outputs.find(one => one.kind === 'tracked' && one.target === '--output=pwned-output')?.status, 1)
    // the index's record of src, read without touching the files
    assert.match(outputs.find(one => one.kind === 'indexed' && one.target === 'src')?.stdout ?? '', /^src\/b\.txt\n\s+ctime:/)
    // only the upstream commits this branch lacks are counted, not the shared ones
    assert.equal(outputs.find(one => one.kind === 'authors')?.stdout.trim(), 'u@example.com')
  })

  test(`the hostile ${name} repository is live: plain git status and diff run its programs`, () => {
    const markers = join(root, `${name}-markers`)
    const repo = join(root, name)
    spawnSync('git', ['status'], { cwd: repo, env: plain, stdio: 'ignore', timeout: 10_000 })
    spawnSync('git', ['diff'], { cwd: repo, env: plain, stdio: 'ignore', timeout: 10_000 })

    assert.ok(left(markers).includes('filter-clean') || left(markers).includes('filter-process'), left(markers).join(' '))
    assert.ok(left(markers).includes('diff-external'), left(markers).join(' '))
  })
}

/**
 * Runs a plan as the court does and reads it as the court does.
 */
const readIn = (repo, command) => {
  const plan = planOf(command)
  const results = plan.map(query => {
    const ran = spawnSync(query.argv[0], query.argv.slice(1), { cwd: repo, env: { ...process.env, ...GIT_ENV }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 10_000 })
    return ran.error ? undefined : { exitCode: ran.status ?? 1, stdout: ran.stdout }
  })
  return factsOf(plan, results)
}

test('real git index entries are read exactly, and a name git escapes leaves the target unknown', () => {
  const repo = join(root, 'names')
  mkdirSync(join(repo, 'plain'), { recursive: true })
  mkdirSync(join(repo, 'odd'), { recursive: true })
  git(root, 'init', '-q', '-b', 'main', repo)
  writeFileSync(join(repo, 'plain', 'spéc.txt'), 'unicode\n')
  writeFileSync(join(repo, 'odd', 'new\nline.txt'), 'newline\n')
  writeFileSync(join(repo, 'odd', 'qu"ote.txt'), 'quote\n')
  git(repo, 'add', '--', '.')
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'names')

  const plain = readIn(repo, 'rm -rf plain')
  assert.equal(plain.indexPath, '.git/index')
  assert.deepEqual(plain.indexed?.plain?.map(entry => [entry.path, entry.size]), [['plain/spéc.txt', 8]])
  assert.ok(Number.isFinite(plain.indexed?.plain?.[0]?.mtimeMs))
  assert.equal(plain.tracked?.plain, true)

  const odd = readIn(repo, 'rm -rf odd')
  assert.equal(odd.indexed, undefined)
  assert.equal(odd.tracked, undefined)
})

test('in a linked worktree the index read is the worktree\'s own', () => {
  const main = join(root, 'wt-main')
  const linked = join(root, 'wt-linked')
  mkdirSync(join(main, 'src'), { recursive: true })
  git(root, 'init', '-q', '-b', 'main', main)
  writeFileSync(join(main, 'src', 'a.txt'), 'a\n')
  git(main, 'add', '--', '.')
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'one')
  git(main, 'worktree', 'add', '-q', '-b', 'side', linked)

  const facts = readIn(linked, 'rm -rf src')
  // .git is a file here: the index lives under the main repository's worktrees
  assert.equal(facts.branch, 'side')
  assert.equal(facts.indexPath, join(main, '.git', 'worktrees', 'wt-linked', 'index'))
  assert.ok(existsSync(facts.indexPath))
  assert.deepEqual(facts.indexed?.src?.map(entry => entry.path), ['src/a.txt'])
})

