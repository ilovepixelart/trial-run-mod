// Runs every git command the court plans, by its own argv, GIT_HARDENING and
// GIT_ENV, against real repositories whose config names a program for every
// hook git offers, and asserts none of them ran. Outside `claude plugin test`
// because the kit runs no processes:
//
//   node --test tests/hostile/git.hostile.mjs
import { spawnSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
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
const { GIT_ENV, GIT_HARDENING, exhibitLinesOf, factsOf, planOf, statPathsOf, withModified } = await import('../../hooks/exhibits.ts')

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
    `\trev-parse = ${marker(markers, 'pager-rev-parse')}`,
    `\tls-tree = ${marker(markers, 'pager-ls-tree')}`,
    '[log]',
    '\tshowSignature = true',
    '[gpg]',
    `\tprogram = ${marker(markers, 'gpg')}`,
    '[credential]',
    `\thelper = !${marker(markers, 'credential')}`,
    '[alias]',
    `\tls-files = !${marker(markers, 'alias')}`,
    `\tls-tree = !${marker(markers, 'alias-ls-tree')}`,
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

/**
 * Every file under `dir` with its size and modification time, so a run
 * that writes, rewrites or adds any file there shows.
 */
const snapshotOf = dir =>
  readdirSync(dir, { recursive: true })
    .toSorted()
    .map(path => {
      const stat = lstatSync(join(dir, path))
      return `${path} ${stat.size} ${stat.mtimeMs}`
    })

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
    const store = snapshotOf(join(repo, '.git'))

    const outputs = runPlans(repo)

    assert.deepEqual(left(markers), [])
    // no file under .git is written, rewritten or added
    assert.deepEqual(snapshotOf(join(repo, '.git')), store)
    for (const pwned of PWNED) {
      assert.equal(existsSync(join(repo, pwned)), false, pwned)
    }
    // the commands really ran against the repository and its upstream
    const behind = outputs.find(one => one.kind === 'behind')
    assert.equal(behind?.status, 0)
    assert.equal(behind?.stdout.trim(), '1')
    // the index's and HEAD's records of -rf, and none for a path never tracked
    assert.match(outputs.find(one => one.kind === 'tracked' && one.target === '-rf')?.stdout ?? '', /^100644 [0-9a-f]{40} 0\t-rf\/c\.txt\0$/)
    assert.match(outputs.find(one => one.kind === 'committed' && one.target === '-rf')?.stdout ?? '', /^100644 blob [0-9a-f]{40}\t-rf\/c\.txt\0$/)
    for (const kind of ['tracked', 'committed']) {
      const read = outputs.find(one => one.kind === kind && one.target === '--output=pwned-output')
      assert.deepEqual([read?.status, read?.stdout], [0, ''], kind)
    }
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

/**
 * The court's reads for one `rm` target: the plan for a placeholder with the
 * target put in its place, so a target the plan refuses is still read with
 * the argv it would get.
 */
const readsOf = target =>
  planOf('rm -rf placeholder')
    .filter(query => query.target === 'placeholder' && ['tracked', 'committed', 'untracked'].includes(query.kind))
    .map(query => ({ ...query, argv: query.argv.map(word => (word === 'placeholder' ? target : word)), target }))

const runReads = (repo, target) =>
  readsOf(target).map(query => {
    const ran = spawnSync(query.argv[0], query.argv.slice(1), {
      cwd: repo,
      env: { ...process.env, ...GIT_ENV },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 10_000,
    })
    return { kind: query.kind, status: ran.status, stdout: ran.stdout.replace(/[\0\n]+$/, '').replace(/ [0-9a-f]{40}/, ' <oid>') }
  })

test('a target spelled as pathspec magic is read as the path rm deletes', () => {
  const repo = join(root, 'magic')
  mkdirSync(join(repo, 'src'), { recursive: true })
  git(root, 'init', '-q', '-b', 'main', repo)
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  writeFileSync(join(repo, 'src', 'b.txt'), 'b\n')
  git(repo, 'add', '--', '.')
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'one')
  const magic = [':src', ':(glob)*', ':!src', ':/src']
  for (const target of magic) {
    mkdirSync(join(repo, target), { recursive: true })
    writeFileSync(join(repo, target, 'x.txt'), 'x\n')
  }
  const planned = planOf('rm -rf :src').filter(query => query.target !== undefined)
  assert.ok(planned.length > 0 && planned.every(query => query.target === ':src'))

  for (const target of magic) {
    assert.deepEqual(runReads(repo, target), [
      { kind: 'tracked', status: 0, stdout: '' },
      { kind: 'committed', status: 0, stdout: '' },
      { kind: 'untracked', status: 0, stdout: `${target}/x.txt` },
    ], target)
  }
  assert.deepEqual(runReads(repo, 'src'), [
    { kind: 'tracked', status: 0, stdout: '100644 <oid> 0\tsrc/b.txt' },
    { kind: 'committed', status: 0, stdout: '100644 blob <oid>\tsrc/b.txt' },
    { kind: 'untracked', status: 0, stdout: '' },
  ])
})

/**
 * The upstream count a force push of main to origin is entered with in
 * `repo`, read by the court's own plan, argv and environment.
 */
const behindOf = repo => {
  const plan = planOf('git push --force origin main')
  const results = plan.map(query => {
    const ran = spawnSync(query.argv[0], query.argv.slice(1), {
      cwd: repo,
      env: { ...process.env, ...GIT_ENV },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 10_000,
    })
    return { exitCode: ran.status ?? -1, stdout: ran.stdout }
  })
  return factsOf(plan, results).behind
}

test('a push url or push rewrite in the repository config leaves the push undescribed', () => {
  const remote = join(root, 'pushurl-origin.git')
  const repo = join(root, 'pushurl')
  git(root, 'init', '-q', '--bare', '-b', 'main', remote)
  git(root, 'clone', '-q', remote, repo)
  git(repo, 'switch', '-q', '-c', 'main')
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'one')
  git(repo, 'push', '-q', '-u', 'origin', 'main')

  // control: a plain remote is described
  assert.equal(behindOf(repo), 0)

  git(repo, 'config', 'remote.origin.pushurl', join(root, 'elsewhere.git'))
  assert.equal(behindOf(repo), undefined)
  git(repo, 'config', '--unset', 'remote.origin.pushurl')

  git(repo, 'config', `url.${join(root, 'elsewhere.git')}.pushInsteadOf`, remote)
  assert.equal(behindOf(repo), undefined)
})

const commit = (repo, message) => git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', message)

/**
 * A fresh repository with `files` committed, or only staged when `isCommitted` is false.
 */
const repoWith = (name, files, isCommitted = true) => {
  const repo = join(root, name)
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  git(repo, 'add', '--', '.')
  if (isCommitted) {
    commit(repo, 'one')
  }
  return repo
}

const fileStat = path => {
  try {
    const link = lstatSync(path)
    const stat = statSync(path)
    return { kind: stat.isDirectory() ? 'dir' : 'file', size: stat.size, mtimeMs: stat.mtimeMs, isLink: link.isSymbolicLink() }
  } catch {
    return undefined
  }
}

/**
 * The exhibit lines the court enters for `command` in `repo`: its plan run
 * by argv, every indexed file stat'd as register.tsx does, after the index
 * file is made newer than every file so none is racily clean.
 */
const linesIn = (repo, command) => {
  const index = join(repo, git(repo, 'rev-parse', '--git-path', 'index').trim())
  if (existsSync(index)) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
    utimesSync(index, new Date(), new Date())
  }
  const facts = readIn(repo, command)
  const stats = new Map(statPathsOf(facts).map(path => [path, fileStat(join(repo, path))]))
  return exhibitLinesOf(withModified(facts, stats, fileStat(index)?.mtimeMs))
}

const KEEPS = /history keeps it\.$/

test('a clean folder and file committed in HEAD are kept by history', () => {
  const repo = repoWith('kept', { 'src/a.txt': 'a\n', 'src/deep/b.txt': 'b\n', 'c.txt': 'c\n' })

  assert.deepEqual(linesIn(repo, 'rm -rf src'), ['Exhibit A: src is tracked by git, so history keeps it.'])
  assert.deepEqual(linesIn(repo, 'rm -rf c.txt'), ['Exhibit A: c.txt is tracked by git, so history keeps it.'])
})

test('an embedded repository tracked as a gitlink is a nested repository, never kept by history', () => {
  const repo = repoWith('gitlink', { 'a.txt': 'a\n' })
  const nested = join(repo, 'nested')
  mkdirSync(nested)
  git(nested, 'init', '-q', '-b', 'main')
  writeFileSync(join(nested, 'f.txt'), 'f\n')
  git(nested, 'add', '--', '.')
  commit(nested, 'inner')
  git(repo, 'add', '--', 'nested')
  commit(repo, 'gitlink')

  const lines = linesIn(repo, 'rm -rf nested')
  assert.equal(lines.some(line => KEEPS.test(line)), false, lines.join('\n'))
  assert.deepEqual(lines, ['Exhibit A: nested is tracked by git, but holds a nested repository, whose contents were not checked.'])
})

test('a submodule with untracked and changed work inside is a nested repository, never kept by history', () => {
  const upstream = repoWith('sub-upstream', { 'f.txt': 'f\n' })
  const repo = repoWith('super', { 'a.txt': 'a\n' })
  git(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', upstream, 'sub')
  commit(repo, 'sub')
  writeFileSync(join(repo, 'sub', 'f.txt'), 'changed\n')
  writeFileSync(join(repo, 'sub', 'work.txt'), 'untracked\n')

  const lines = linesIn(repo, 'rm -rf sub')
  assert.equal(lines.some(line => KEEPS.test(line)), false, lines.join('\n'))
  assert.deepEqual(lines, ['Exhibit A: sub is tracked by git, but holds a nested repository, whose contents were not checked.'])
})

test('a file or folder added with intent to add, or staged and never committed, is not kept by history', () => {
  const repo = repoWith('intent', { 'a.txt': 'a\n', 'src/b.txt': 'b\n', 'empty.txt': '' })
  // an intent to add records the empty file, as HEAD records this one
  git(repo, 'rm', '-q', '--cached', '--', 'empty.txt')
  writeFileSync(join(repo, 'empty.txt'), 'never committed\n')
  git(repo, 'add', '-N', '--', 'empty.txt')
  writeFileSync(join(repo, 'new.txt'), 'never committed\n')
  mkdirSync(join(repo, 'dir'))
  writeFileSync(join(repo, 'dir', 'x.txt'), 'never committed\n')
  git(repo, 'add', '-N', '--', 'new.txt', 'dir/x.txt')
  writeFileSync(join(repo, 'src', 'b.txt'), 'staged, never committed\n')
  git(repo, 'add', '--', 'src/b.txt')

  for (const target of ['new.txt', 'dir', 'src', 'empty.txt']) {
    const lines = linesIn(repo, `rm -rf ${target}`)
    assert.equal(lines.some(line => KEEPS.test(line)), false, lines.join('\n'))
    assert.equal(lines[0], `Exhibit A: ${target} is tracked by git, but not all of it is committed, so history does not keep all of it.`, lines.join('\n'))
  }
})

test('a tracked folder holding nested repositories or a linked worktree is never kept or counted short', () => {
  const repo = repoWith('holder', { 'src/x.txt': 'x\n', '.gitignore': 'src/ign/\n' })
  for (const name of ['src/inner', 'src/ign']) {
    const nested = join(repo, name)
    mkdirSync(nested)
    git(nested, 'init', '-q', '-b', 'main')
    for (const file of ['f.txt', 'g.txt', 'h.txt']) {
      writeFileSync(join(nested, file), 'f\n')
    }
    git(nested, 'add', '--', '.')
    commit(nested, 'inner')
  }
  const worktreeRepo = repoWith('holder-wt', { 'src/x.txt': 'x\n' })
  git(worktreeRepo, 'worktree', 'add', '-q', '-b', 'side', join(worktreeRepo, 'src', 'wt'))
  writeFileSync(join(worktreeRepo, 'src', 'wt', 'work.txt'), 'uncommitted\n')

  for (const [at, lines] of [linesIn(repo, 'rm -rf src'), linesIn(worktreeRepo, 'rm -rf src')].entries()) {
    assert.equal(lines.some(line => KEEPS.test(line)), false, `${at}: ${lines.join('\n')}`)
    assert.deepEqual(lines, ['Exhibit A: src is tracked by git, but holds a nested repository, whose contents were not checked.'], `${at}`)
  }
  // an untracked folder holding one: no count of what it holds
  const loose = repoWith('loose', { 'a.txt': 'a\n' })
  const inner = join(loose, 'vendor', 'lib')
  mkdirSync(inner, { recursive: true })
  git(inner, 'init', '-q', '-b', 'main')
  writeFileSync(join(inner, 'f.txt'), 'f\n')
  writeFileSync(join(loose, 'vendor', 'g.txt'), 'g\n')
  assert.deepEqual(linesIn(loose, 'rm -rf vendor'), [
    'Exhibit A: vendor is not tracked by git, so history does not keep it.',
    'Exhibit B: vendor holds a nested repository, whose contents were not checked.',
  ])
})

test('a repository with no commits reads as one, and history keeps none of it', () => {
  const repo = repoWith('unborn', { 'src/a.txt': 'a\n' }, false)

  const facts = readIn(repo, 'rm -rf src')
  assert.equal(facts.isRepo, true)
  assert.equal(facts.hasCommits, false)
  assert.deepEqual(linesIn(repo, 'rm -rf src'), [
    'Exhibit A: this repository has no commits on its current branch.',
    'Exhibit B: src is tracked by git, but not all of it is committed, so history does not keep all of it.',
  ])
})
