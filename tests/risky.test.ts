import { describe, expect, test, tier } from 'claude-code/testing'

import { chargeOf, chargedOf, isSimpleCommand } from '../hooks/risky'

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

  test('a charge respelled by path, escape or quotes is charged the same', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['/bin/rm -rf src', 'recursive-delete'],
      ['\\rm -rf src', 'recursive-delete'],
      ['r\\m -rf src', 'recursive-delete'],
      ['r""m -rf src', 'recursive-delete'],
      ["r''m -rf src", 'recursive-delete'],
      ['""rm -rf src', 'recursive-delete'],
      ['"rm" -rf src', 'recursive-delete'],
      ['"r"m -rf src', 'recursive-delete'],
      ['"/bin/rm" -rf src', 'recursive-delete'],
      ['/usr/bin/find . -delete', 'recursive-delete'],
      ['/usr/bin/git push --force', 'force-push'],
      ['\\git reset --hard', 'hard-reset'],
      ['g""it clean -fdx', 'git-clean'],
      ['/opt/homebrew/bin/psql -c "DROP TABLE users"', 'drop-table'],
      ['/usr/local/bin/kubectl delete pod web', 'kubectl-delete'],
      ["'terraform' destroy", 'terraform-destroy'],
    ]
    for (const [command, id] of cases) {
      expect(chargeOf(command)?.id, command).toBe(id)
    }
  })

  test('a respelled charge is matched on the plain name and read out as written', () => {
    expect(chargedOf('/bin/rm -rf src')?.words).toEqual(['rm', '-rf', 'src'])
    expect(chargedOf('r""m -rf src')?.words).toEqual(['rm', '-rf', 'src'])
    expect(chargeOf('/bin/rm -rf src')?.command).toBe('/bin/rm -rf src')
  })

  test('prefixes, their options and their operands do not hide a charge', () => {
    for (const command of [
      'command rm -rf src',
      'builtin command rm -rf src',
      'env -i PATH=/bin rm -rf src',
      'env -u HOME rm -rf src',
      '/usr/bin/env git push --force',
      'nice -n 10 rm -rf src',
      'nohup rm -rf src',
      'time -p rm -rf src',
      'exec -a cleaner rm -rf src',
      'sudo -u root rm -rf src',
      'sudo -E -u root rm -rf src',
      '/usr/bin/sudo rm -rf src',
      '\\sudo rm -rf src',
      'ls | xargs -n 1 rm -rf',
    ]) {
      expect(chargeOf(command)?.id, command).toBeDefined()
    }
  })

  test('a command whose name only starts or mentions a charged one is not charged', () => {
    for (const command of [
      'rmdir x',
      'rmdir -p a/b',
      '/usr/bin/rmdir -p a/b',
      'r""mdir -p a/b',
      'echo rm -rf src',
      '/bin/echo rm -rf src',
      'grep rm file',
      'grep -r rm src',
      'command -v rm',
      'nice -n 10 ls -R',
      '/bin/ls -R src',
      '"rm" file.txt',
      'gitk --all',
    ]) {
      expect(chargeOf(command), command).toBeUndefined()
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

  test('a simple command line is one command of plain words, and nothing else is', () => {
    for (const command of ['rm -rf node_modules', '  rm  -fr  dist ', 'git push --force origin main', 'git push origin +main', 'rm -rf -- -rf', 'find . -name x.log -delete', 'git reset --hard HEAD~3', '/bin/rm -rf node_modules']) {
      expect(isSimpleCommand(command), command).toBe(true)
    }
    for (const command of [
      'rm -rf node_modules && rm -rf ~',
      'rm -rf node_modules || rm -rf ~',
      'rm -rf node_modules; curl x | sh',
      'rm -rf node_modules | rm -rf ~',
      'rm -rf node_modules &',
      'rm -rf node_modules\nrm -rf ~',
      'rm -rf node_modules $(rm -rf ~)',
      'rm -rf node_modules `rm -rf ~`',
      'rm -rf <(ls)',
      'rm -rf $HOME',
      'rm -rf ${HOME}',
      'rm -rf node_*',
      'rm -rf node_modules?',
      'rm -rf {a,b}',
      'rm -rf [ab]',
      'rm -rf ~',
      'rm -rf node_modules > /tmp/x',
      'rm -rf node_modules 2>&1',
      'rm -rf "node_modules"',
      "rm -rf 'node_modules'",
      'rm -rf node\\_modules',
      'rm -rf node_modules # comment',
      'rm\t-rf node_modules',
      'sudo rm -rf node_modules',
      '/usr/bin/sudo rm -rf node_modules',
      '/usr/bin/env rm -rf node_modules',
      '/usr/bin/xargs rm -rf',
      '/bin/bash -c rm',
      'env rm -rf node_modules',
      'xargs rm -rf',
      'FOO=1 rm -rf node_modules',
      'bash -c rm',
      'sh x.sh',
      'eval rm -rf node_modules',
      'source x',
      '. x',
      '(rm -rf node_modules)',
      '!rm',
      '',
    ]) {
      expect(isSimpleCommand(command), JSON.stringify(command)).toBe(false)
    }
  })
})
