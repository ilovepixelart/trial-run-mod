import { describe, expect, test, tier } from 'claude-code/testing'

import { chargeOf } from '../hooks/risky'

tier('user')

describe('risky', () => {
  test('recursive deletes are charged', () => {
    for (const command of [
      'rm -rf build',
      'rm -fr /tmp/x',
      'rm -r src',
      'rm -R src',
      'rm --recursive src',
      'sudo rm -rf /',
      'cd /tmp && rm -rf old',
      'find . -name "*.log" -delete',
    ]) {
      expect(chargeOf(command)?.id, command).toBe('recursive-delete')
    }
  })

  test('force pushes are charged, with or without a remote', () => {
    for (const command of [
      'git push --force',
      'git push -f origin main',
      'git push origin main --force',
      'git push --force-with-lease',
      'git push origin +main',
    ]) {
      expect(chargeOf(command)?.id, command).toBe('force-push')
    }
  })

  test('hard resets, dropped tables, kubectl and terraform teardowns are charged', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['git reset --hard HEAD~3', 'hard-reset'],
      ['psql -c "DROP TABLE users"', 'drop-table'],
      ["mysql -e 'drop database prod'", 'drop-table'],
      ['psql -c "TRUNCATE orders"', 'drop-table'],
      ['kubectl delete namespace prod', 'kubectl-delete'],
      ['terraform destroy -auto-approve', 'terraform-destroy'],
    ]
    for (const [command, id] of cases) {
      expect(chargeOf(command)?.id, command).toBe(id)
    }
  })

  test('global flags before the subcommand do not hide a teardown', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['terraform -chdir=infra destroy -auto-approve', 'terraform-destroy'],
      ['tofu -chdir=infra apply -destroy', 'terraform-destroy'],
      ['kubectl -n prod delete pod web', 'kubectl-delete'],
      ['kubectl --context prod-eu delete namespace shop', 'kubectl-delete'],
    ]
    for (const [command, id] of cases) {
      expect(chargeOf(command)?.id, command).toBe(id)
    }
  })

  test('a forced git clean is charged: it deletes untracked files for good', () => {
    for (const command of ['git clean -fdx', 'git clean -fd', 'git -C app clean -ffdx', 'git clean --force -d', 'git clean -f']) {
      expect(chargeOf(command)?.id, command).toBe('git-clean')
    }
  })

  test('a git clean that only shows what it would delete is not charged', () => {
    for (const command of ['git clean -n', 'git clean --dry-run', 'git clean -nd', 'git clean -fn', 'git clean -f --dry-run', 'git status', 'git rm -r src']) {
      expect(chargeOf(command), command).toBeUndefined()
    }
  })

  test('a compound command is charged with the simple command that fits', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['ls -la src && git status --short src && rm -rf src && ls', 'rm -rf src'],
      ['FORCE=1 sudo -E rm -rf /var/x', 'FORCE=1 sudo -E rm -rf /var/x'],
      ["psql -c 'DROP TABLE users'", "psql -c 'DROP TABLE users'"],
      ['cd app && sudo rm -rf /tmp/cache', 'sudo rm -rf /tmp/cache'],
      ["bash -c 'cd app; git reset --hard'", 'git reset --hard'],
      ['git push --force origin main', 'git push --force origin main'],
    ]
    for (const [command, charged] of cases) {
      expect(chargeOf(command)?.command, command).toBe(charged)
    }
  })

  test('wrappers and nested shells do not hide a charge', () => {
    for (const command of [
      'FORCE=1 sudo -E rm -rf /var/x',
      'env CI=1 git push --force',
      "bash -c 'git reset --hard'",
      'sh -c "ls && rm -rf dist"',
      "eval 'kubectl delete pod web'",
      'ls | xargs rm -rf',
    ]) {
      expect(chargeOf(command), command).toBeDefined()
    }
  })

  test('ordinary commands are not charged', () => {
    for (const command of [
      'ls -la',
      'git status',
      'rm file.txt',
      'rm -f file.txt',
      'git push',
      'git push origin feature/x',
      'git reset HEAD file.txt',
      'echo "rm -rf is dangerous"',
      'grep -r "DROP TABLE" docs',
      'kubectl get pods',
      'kubectl -n prod get pods',
      'terraform plan',
      'terraform -chdir=infra plan',
      'npm run format',
    ]) {
      expect(chargeOf(command), command).toBeUndefined()
    }
  })
})
