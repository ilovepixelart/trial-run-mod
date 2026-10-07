import { describe, expect, test, tier } from 'claude-code/testing'

import { sentenceFor } from '../hooks/sentence'

tier('user')

describe('sentence', () => {
  test('every charge has one safer alternative, spelled for the command that was tried', () => {
    const cases: readonly (readonly [string, string, string])[] = [
      [
        'force-push',
        'git push --force origin main',
        'Use git push --force-with-lease instead: it refuses to overwrite commits you have not fetched.',
      ],
      [
        'terraform-destroy',
        'terraform -chdir=infra destroy -auto-approve',
        'Run terraform -chdir=infra plan -destroy first and read what it would remove.',
      ],
      ['terraform-destroy', 'tofu apply -destroy', 'Run tofu plan -destroy first and read what it would remove.'],
      [
        'recursive-delete',
        'rm -rf src',
        'If src is tracked, git rm -r src keeps it in git history; if not, move it aside instead of deleting it.',
      ],
      [
        'recursive-delete',
        'find . -name "*.log" -delete',
        'Run the same find without -delete first to see what it would remove.',
      ],
      ['hard-reset', 'git reset --hard HEAD~3', 'Run git stash first, so the changes a hard reset throws away are kept.'],
      ['git-clean', 'git clean -fdx', 'Dry-run it first: git clean -ndx lists what would be deleted and deletes nothing.'],
      ['git-clean', 'git -C app clean --force -d', 'Dry-run it first: git -C app clean -n -d lists what would be deleted and deletes nothing.'],
      [
        'kubectl-delete',
        'kubectl -n prod delete pod web',
        'Run kubectl -n prod delete pod web --dry-run=client first: it shows what would be deleted and deletes nothing.',
      ],
      [
        'drop-table',
        'psql -c "DROP TABLE users"',
        'Take a backup first (for example pg_dump -t <table> or mysqldump <database> <table>) and keep it until you are sure.',
      ],
    ]
    for (const [charge, command, sentence] of cases) {
      expect(sentenceFor(charge, command), `${charge}: ${command}`).toBe(sentence)
    }
  })

  test('a recursive delete with no target named suggests looking first, not git rm', () => {
    expect(sentenceFor('recursive-delete', 'ls | xargs rm -rf')).toBe(
      'Look at what it would delete first; if the files are tracked, git rm -r keeps them in git history.',
    )
  })

  test('unknown charge, no sentence', () => {
    expect(sentenceFor('arson', 'set fire')).toBeUndefined()
  })
})
