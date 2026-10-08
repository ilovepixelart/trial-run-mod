// Runs scripts/check-guide.mjs on small guides and asserts which spans it
// holds to the repository:
//
//   node --test scripts/check-guide.test.mjs
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'

const dir = mkdtempSync(join(tmpdir(), 'guide-check-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const checked = text => {
  const guide = join(dir, `${Math.random().toString(36).slice(2)}.md`)
  writeFileSync(guide, text)
  return spawnSync('node', ['scripts/check-guide.mjs', guide], { encoding: 'utf8' })
}

test('a dotfile path that does not exist fails the check', () => {
  const { status, stderr } = checked('The workflow is `.github/workflows/gone.yml`.\n')
  assert.equal(status, 1)
  assert.match(stderr, /`\.github\/workflows\/gone\.yml`, which is not in the repository/)
})

test('a path under a top directory that does not exist fails the check', () => {
  const { status, stderr } = checked('The hooks are in `hookz/register.tsx`.\n')
  assert.equal(status, 1)
  assert.match(stderr, /`hookz\/register\.tsx`, which is not in the repository/)
})

test('paths that exist, dotfile or not, and a method named with its dot pass', () => {
  const { status, stderr } = checked('See `.github/workflows/ci.yml`, `.claude-plugin/plugin.json`, `hooks/register.tsx` and `.catch`.\n')
  assert.equal(stderr, '')
  assert.equal(status, 0)
})

test('a method named with its dot that is not in the code fails the check', () => {
  const { status, stderr } = checked('Call `.notInTheCodeAnywhere`.\n')
  assert.equal(status, 1)
  assert.match(stderr, /`\.notInTheCodeAnywhere`, which is not in hooks\/, tests\/ or the types/)
})

test('a module the code imports from passes, one it does not import fails', () => {
  assert.equal(checked('The kit is `claude-code/testing`.\n').status, 0)
  const { status, stderr } = checked('The kit is `claude-code/testin`.\n')
  assert.equal(status, 1)
  assert.match(stderr, /`claude-code\/testin`, which is not in the repository/)
})

test('a path with a part that is only dots is an example, not checked', () => {
  const { status, stderr } = checked('Git folds `lnk/..` and reads `refs/remotes/...`.\n')
  assert.equal(stderr, '')
  assert.equal(status, 0)
})
