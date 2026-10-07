import { describe, expect, test, tier } from 'claude-code/testing'

import { contemptKeyOf } from '../hooks/contempt'

tier('user')

describe('contempt', () => {
  test('the same command, respaced or with its short flags reordered, is the same command', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['rm -rf src', 'rm -fr  src'],
      ['rm -rf src', '  rm   -rf   src  '],
      ['git push --force origin main', 'git  push --force origin  main'],
      ['git clean -fdx', 'git clean -xfd'],
      ['rm -r -f src', 'rm -f -r src'],
    ]
    for (const [a, b] of cases) {
      expect(contemptKeyOf(b), `${a} | ${b}`).toBe(contemptKeyOf(a))
    }
  })

  test('a command respelled by path, escape, quotes or prefix is the same command', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['rm -rf src', '/bin/rm -rf src'],
      ['rm -rf src', '\\rm -rf src'],
      ['rm -rf src', 'r""m -rf src'],
      ['rm -rf src', '"rm" -rf src'],
      ['rm -rf src', 'command rm -rf src'],
      ['rm -rf src', 'nice -n 10 rm -fr src'],
      ['git push --force origin main', '/usr/bin/git push --force origin main'],
    ]
    for (const [a, b] of cases) {
      expect(contemptKeyOf(b), `${a} | ${b}`).toBe(contemptKeyOf(a))
    }
  })

  test('quoting that leaves the same words is the same command', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['rm -rf "a b"', "rm -rf 'a b'"],
      ['rm -rf "a b"', 'rm -rf a\\ b'],
      ['rm -rf src', 'rm -rf "src"'],
    ]
    for (const [a, b] of cases) {
      expect(contemptKeyOf(b), `${a} | ${b}`).toBe(contemptKeyOf(a))
    }
  })

  test('a different target, subcommand or long flag is a different command', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['rm -rf src', 'rm -rf dist'],
      ['rm -rf src', 'rm -rf src/old'],
      ['git push --force origin main', 'git push --force origin release'],
      ['git push --force origin main', 'git push --force-with-lease origin main'],
      ['git clean -fdx', 'git clean -fd'],
      ['kubectl delete pod web', 'kubectl delete pod api'],
      ['/bin/rm -rf src', '/bin/rm -rf dist'],
      ['rm -rf src', 'rmdir src'],
      ['rm -rf "a b"', 'rm -rf a b'],
      ['rm -rf a\\ b', 'rm -rf a b'],
    ]
    for (const [a, b] of cases) {
      expect(contemptKeyOf(b), `${a} | ${b}`).not.toBe(contemptKeyOf(a))
    }
  })
})
