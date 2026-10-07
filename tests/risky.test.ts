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
      ['rm -rf src 2>&1', 'rm -rf src 2>&1'],
      ['ls >&2 && rm -rf src', 'rm -rf src'],
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

  test('a command name the shell resolves at run time is charged as any charged program it may be', () => {
    const cases: readonly (readonly [string, string])[] = [
      ["$'rm' -rf src", 'recursive-delete'],
      ['$"rm" -rf src', 'recursive-delete'],
      ["$'\\x72m' -rf src", 'recursive-delete'],
      ["$'\\162m' -rf src", 'recursive-delete'],
      ['r${x}m -rf src', 'recursive-delete'],
      ['$RM -rf src', 'recursive-delete'],
      ['"$(echo rm)" -rf src', 'recursive-delete'],
      ['`echo rm` -rf src', 'recursive-delete'],
      ['$(echo rm) -rf src', 'recursive-delete'],
      ['/bin/r? -rf src', 'recursive-delete'],
      ['/bin/r[m] -rf src', 'recursive-delete'],
      ['/bin/r{m,x} -rf src', 'recursive-delete'],
      ['$GIT push --force', 'force-push'],
      ['"$RM" -rf src', 'recursive-delete'],
      ['"${RM}" -rf src', 'recursive-delete'],
      ['r"$x"m -rf src', 'recursive-delete'],
      ['"${GIT}" push --force origin main', 'force-push'],
    ]
    for (const [command, id] of cases) {
      expect(chargeOf(command)?.id, command).toBe(id)
    }
  })

  test('a line continuation or a name in other case does not hide a charge', () => {
    for (const command of ['r\\\nm -rf src', 'RM -rf src', 'R\\M -rf src', 'GIT push --force']) {
      expect(chargeOf(command), JSON.stringify(command)).toBeDefined()
    }
  })

  test('redirections, groups, keywords and substitutions do not hide a charge', () => {
    for (const command of [
      'rm>x -rf src',
      'rm<x -rf src',
      '2>/dev/null rm -rf src',
      '>x rm -rf src',
      '&>/dev/null rm -rf src',
      '(rm -rf src)',
      '{ rm -rf src; }',
      'if true; then rm -rf src; fi',
      'while true; do rm -rf src; done',
      '! rm -rf src',
      'ls & rm -rf src',
      'echo $(rm -rf src)',
      'echo `rm -rf src`',
      'echo "$(rm -rf src)"',
      'x=$(rm -rf src)',
    ]) {
      expect(chargeOf(command)?.id, command).toBe('recursive-delete')
    }
  })

  test('a script a shell or runner takes from -c is charged, whatever flags share its word', () => {
    for (const command of [
      "bash -lc 'rm -rf src'",
      "sh -ec 'rm -rf src'",
      "bash -xc 'rm -rf src'",
      "bash -c -x 'rm -rf src'",
      "bash -o errexit -c 'rm -rf src'",
      "/bin/bash --login -c 'rm -rf src'",
      "fish -c 'rm -rf src'",
      "fish --command='rm -rf src'",
      "ksh -c 'rm -rf src'",
      "zsh -c 'rm -rf src'",
      "dash -c 'rm -rf src'",
      "su -c 'rm -rf src'",
      "su root -c 'rm -rf src'",
      "su -lc 'rm -rf src'",
      "su --command='rm -rf src' root",
      "sg staff -c 'rm -rf src'",
      "sg staff 'rm -rf src'",
      "script -q -c 'rm -rf src' /dev/null",
      "script --command 'rm -rf src' log.txt",
    ]) {
      expect(chargeOf(command)?.id, command).toBe('recursive-delete')
    }
  })

  test('a shell or runner whose script is harmless, or a script file however named, is not charged', () => {
    for (const command of ["bash -lc 'ls'", "sh -ec 'ls -R'", 'bash x.sh', "bash -x 'rm -rf src'", 'su -l root', 'sg staff ls', "script -q -c 'ls' out.txt", 'fish -c ls']) {
      expect(chargeOf(command), command).toBeUndefined()
    }
  })

  test('a command after a case pattern, a coproc or inside a function body is charged', () => {
    for (const command of [
      'case x in x) rm -rf src;; esac',
      'case x in (x) rm -rf src;; esac',
      'case $1 in a) ls;; b|c) rm -rf src;; esac',
      'coproc rm -rf src',
      'coproc X { rm -rf src; }',
      'coproc X (rm -rf src)',
      'f() { rm -rf src; }; f',
      'f () { rm -rf src; }',
      'function f { rm -rf src; }; f',
      'function f() { rm -rf src; }',
    ]) {
      expect(chargeOf(command)?.id, command).toBe('recursive-delete')
    }
  })

  test('a harmless case branch, coproc or function body is not charged', () => {
    for (const command of ['case x in x) ls;; esac', 'case x in (x) ls -R;; esac', 'coproc ls -R', 'coproc X { ls; }', 'f() { ls; }; f', 'function f { ls; }; f']) {
      expect(chargeOf(command), command).toBeUndefined()
    }
  })

  test('a command find runs for each file is charged, and is read out as the whole find', () => {
    for (const command of [
      'find . -name src -exec rm -rf {} +',
      'find . -execdir rm -rf {} \\;',
      'find . -execdir rm -rf {} ;',
      'find . -ok rm -rf {} \\;',
      'find . -okdir rm -r {} +',
      'find . -type d -exec sudo rm -rf {} +',
      "find . -exec sh -c 'rm -rf \"$1\"' _ {} \\;",
      'find . -name x -print -exec rm -rf {} +',
      'find . -exec echo {} + -exec rm -rf {} +',
    ]) {
      expect(chargeOf(command)?.id, command).toBe('recursive-delete')
    }
    expect(chargedOf('find . -name a -exec rm -rf {} +')?.words).toEqual(['find', '.', '-name', 'a', '-exec', 'rm', '-rf', '{}', '+'])
  })

  test('a find that runs nothing harmful for each file is not charged', () => {
    for (const command of ['find . -name x -print', 'find . -exec ls -R {} +', 'find . -name "*.tmp" -exec rm {} \\;', 'find . -name rm -print']) {
      expect(chargeOf(command), command).toBeUndefined()
    }
  })

  test('xargs is looked through whatever its options', () => {
    for (const command of ["printf 'src\\0' | xargs -0 rm -rf", 'echo src | xargs -I{} rm -rf {}', 'echo src | xargs -I {} rm -rf {}', 'echo src | xargs -n 1 -P 4 rm -rf']) {
      expect(chargeOf(command)?.id, command).toBe('recursive-delete')
    }
  })

  test('a git alias set on the command line is charged as what it runs', () => {
    const cases: readonly (readonly [string, string])[] = [
      ["git -c alias.x='!rm -rf src' x", 'recursive-delete'],
      ['git -c alias.x="!rm -rf" x src', 'recursive-delete'],
      ["git -c alias.y='reset --hard' y", 'hard-reset'],
      ["git -c alias.p='push --force' p origin main", 'force-push'],
      ["git -C app -c alias.y='clean -fdx' y", 'git-clean'],
      ["git -c Alias.Nuke='reset --hard' nuke", 'hard-reset'],
    ]
    for (const [command, id] of cases) {
      expect(chargeOf(command)?.id, command).toBe(id)
    }
  })

  test('a git alias that runs something harmless is not charged', () => {
    for (const command of ['git -c alias.st=status st', "git -c alias.x='!ls -R' x", "git -c alias.y='reset --hard' status", 'git -c core.x=y status']) {
      expect(chargeOf(command), command).toBeUndefined()
    }
  })

  test('a nested script with a separator inside its quotes is read whole, as the inner shell reads it', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['bash -c "echo hi; \\"rm\\" -rf src"', 'recursive-delete'],
      ['cd x && bash -c "a; r\\"\\"m -rf src"', 'recursive-delete'],
      ['sh -c "ls; \\"\\$RM\\" -rf src"', 'recursive-delete'],
      ['bash -c "echo hi; \\"git\\" push --force"', 'force-push'],
      ['echo \\" && bash -c "a; \\"rm\\" -rf src"', 'recursive-delete'],
    ]
    for (const [command, id] of cases) {
      expect(chargeOf(command)?.id, command).toBe(id)
    }
  })

  test('a separator inside quotes still splits, and the quoted half goes to trial', () => {
    for (const command of ["echo 'a; rm -rf' src", "echo 'a; rm -rf src'", 'echo "a; rm -rf" src']) {
      expect(chargeOf(command)?.id, command).toBe('recursive-delete')
    }
  })

  test('quoting inside an argument is read as the shell reads it', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['rm -r""f src', 'recursive-delete'],
      ['rm -\\rf src', 'recursive-delete'],
      ["rm '-r' src", 'recursive-delete'],
      ['git push -\\f', 'force-push'],
      ['git "pu"sh --force', 'force-push'],
      ["git reset '--hard'", 'hard-reset'],
    ]
    for (const [command, id] of cases) {
      expect(chargeOf(command)?.id, command).toBe(id)
    }
  })

  test('a wrapper, its options and the operands it takes before the command do not hide a charge', () => {
    for (const command of [
      'timeout 5 rm -rf src',
      'timeout -s KILL 5 rm -rf src',
      'timeout --kill-after 9 5 rm -rf src',
      'stdbuf -o0 rm -rf src',
      'stdbuf -o 0 rm -rf src',
      'chroot / rm -rf src',
      'chroot --userspec root / rm -rf src',
      'doas rm -rf src',
      'doas -u root rm -rf src',
      'setsid -f rm -rf src',
      'ionice -c3 rm -rf src',
      'ionice -c 3 -n 7 rm -rf src',
      'taskset 1 rm -rf src',
      'taskset -c 0,1 rm -rf src',
      'flock /tmp/lock rm -rf src',
      'flock -w 5 /tmp/lock rm -rf src',
      "flock /tmp/lock -c 'rm -rf src'",
      'caffeinate -i rm -rf src',
      'caffeinate -t 60 rm -rf src',
      'watch rm -rf src',
      'watch -n 1 rm -rf src',
      "watch 'rm -rf src'",
      'parallel rm -rf ::: src',
      "parallel -j 4 'rm -rf {}' ::: a b",
      'parallel rm ::: -rf',
      'busybox rm -rf src',
      '=rm -rf src',
      'noglob rm -rf src',
      'nocorrect rm -rf src',
      'timeout 5 sudo -u root rm -rf src',
    ]) {
      expect(chargeOf(command)?.id, command).toBe('recursive-delete')
    }
  })

  test('a wrapper running something harmless is not charged', () => {
    for (const command of [
      'timeout 5 ls',
      'timeout 5 rm file.txt',
      'stdbuf -o0 ls -R',
      'taskset -p 1 1234',
      'flock /tmp/lock ls',
      'watch -n 1 git status',
      'parallel echo ::: rm -rf',
      'busybox ls -R',
      'noglob ls',
    ]) {
      expect(chargeOf(command), command).toBeUndefined()
    }
  })

  test('a wrapper option value, attached or apart, short or long, is not read as the command', () => {
    for (const command of [
      'sudo -uroot rm -rf src',
      'sudo --user root rm -rf src',
      'env --unset HOME rm -rf src',
      'nice -n10 rm -rf src',
      'nice --adjustment 5 rm -rf src',
      'xargs -a list rm -rf',
    ]) {
      expect(chargeOf(command)?.id, command).toBe('recursive-delete')
    }
  })

  test('the command line env splits from one string is charged', () => {
    for (const command of ["env -S 'rm -rf src'", 'env -S"rm -rf src"', "env --split-string='rm -rf src'", "env -i -S 'git push --force'"]) {
      expect(chargeOf(command), command).toBeDefined()
    }
  })

  test('quotes the shell keeps literal name another program, and a quoted or unrun mention is not charged', () => {
    for (const command of [
      `'r"m' -rf src`,
      `"r'm" -rf src`,
      '"rm -rf src"',
      "'rm -rf' src",
      "echo '$(rm -rf src)'",
      '\\$RM -rf src',
      "$'ls' -R src",
      "$'\\x6cs' -R src",
      "$'\\154s' -R src",
      '"\\rm" -rf src',
      "echo 'rm -rf src' > notes.txt",
      '[ -r file ]',
      '(ls -R)',
      'cd "$dir" && ls',
      '"$EDITOR" notes.txt',
      'echo $HOME',
      'test -r x',
    ]) {
      expect(chargeOf(command), command).toBeUndefined()
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
      'timeout 5 rm -rf src',
      'chroot / rm -rf src',
      'busybox rm -rf src',
      'noglob rm -rf src',
      'watch rm -rf src',
      '=rm -rf src',
      'coproc rm -rf src',
      'find . -exec rm -rf src +',
      'find . -okdir rm -rf src +',
      'git -c alias.p=push p --force',
      '/bin/bash -c rm',
      '"$RM" -rf src',
      '"${RM}" -rf src',
      '"$(echo rm)" -rf src',
      '"${GIT}" push --force origin main',
      'r"$x"m -rf src',
      '\\$RM -rf src',
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
