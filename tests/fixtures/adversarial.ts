/**
 * Command lines built to make the lexer work hard, each of `n` characters
 * at most: deep nesting, long runs of one operator, many pieces.
 */
const fill = (unit: string, tail: string, n: number) => unit.repeat(Math.max(0, Math.floor((n - tail.length) / unit.length))) + tail

const seeded = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

export const ADVERSARIAL: Record<string, (n: number) => string> = {
  findExecNest: n => fill('find -exec ', 'rm -rf src', n),
  findExecNestDot: n => fill('find . -exec ', 'rm -rf src', n),
  findExecNestSemi: n => `${'find . -exec '.repeat(Math.floor(n / 16))}rm -rf src${' \;'.repeat(Math.floor(n / 16))}`,
  dollarParen: n => {
    const k = Math.floor((n - 10) / 3)
    return `${'$('.repeat(k)}rm -rf src${')'.repeat(k)}`
  },
  backticks: n => fill('`', '', n),
  backslashTicks: n => {
    let s = 'rm -rf x'
    while (s.length * 2 + 2 < n) s = `\`${s.replace(/[\\`]/g, m => `\\${m}`)}\``
    return s
  },
  semis: n => fill(';', '', n),
  parens: n => fill('(', '', n),
  parensClosed: n => '('.repeat(Math.floor(n / 2)) + ')'.repeat(Math.floor(n / 2)),
  braces: n => fill('{ ', '', n),
  dquoteSubst: n => {
    const k = Math.floor((n - 10) / 4)
    return `${'"$('.repeat(k)}rm -rf x${')"'.repeat(k)}`
  },
  procSub: n => {
    const k = Math.floor((n - 10) / 3)
    return `${'<('.repeat(k)}rm${')'.repeat(k)}`
  },
  heredocs: n => fill('cat <<E\n', '', n),
  heredocMany: n => fill('<<A ', '', n),
  bashC: n => fill('bash -c ', 'rm -rf x', n),
  bashCq: n => {
    let s = 'rm -rf x'
    while (s.length * 2 + 12 < n) s = `bash -c '${s.replace(/'/g, "'\\''")}'`
    return s
  },
  evalNest: n => fill('eval ', 'rm -rf x', n),
  evalSemis: n => fill('eval ";', 'rm -rf x', n),
  sudoMany: n => fill('sudo ', 'rm -rf x', n),
  envAssign: n => fill('A=1 ', 'rm -rf x', n),
  timeoutMany: n => fill('timeout 1 ', 'rm -rf x', n),
  xargsMany: n => fill('xargs ', 'rm -rf x', n),
  pipes: n => fill('cat|', 'bash', n),
  pipesSpaced: n => fill('cat | ', 'bash', n),
  pipesHere: n => `echo "rm -rf x"${fill('|cat', '|bash', n - 20)}`,
  ansiC: n => fill("$'\\x41'", '', n),
  quotes: n => fill('"', '', n),
  squotes: n => fill("'", '', n),
  mixedQuote: n => fill('"\'"', '', n),
  dollarBrace: n => fill('${', '', n),
  dollarBraceNest: n => {
    const k = Math.floor(n / 6)
    return '${a:-'.repeat(k) + '}'.repeat(k)
  },
  arith: n => fill('$((', '', n),
  caseMany: n => fill('case x in x) ', 'rm -rf x', n),
  functionMany: n => fill('f(){ ', 'rm -rf x', n),
  sqlComment: n => `psql -c "drop${fill('/*', '', n - 30)} table x"`,
  sqlCommentNest: n => `psql -c "drop ${fill('/*!', '', n - 30)} table x"`,
  sqlDash: n => `mysql -e "${fill('-- x\n', 'drop table t"', n - 10)}`,
  gitC: n => `git ${fill('-c alias.x=x ', 'push --force', n - 4)}`,
  gitAliasNest: n => `git ${fill("-c alias.p='!git p' ", 'p', n - 4)}`,
  backslashes: n => fill('\\', '', n),
  newlines: n => fill('\n', '', n),
  ampersands: n => fill('&', '', n),
  redirs: n => fill('<', '', n),
  redirs2: n => fill('<<<', '', n),
  brackets: n => fill('[', '', n),
  bracesOpen: n => fill('{a,', '', n),
  random: n => {
    const next = seeded(n)
    const alphabet = '`$(){}\'";|&<>! \n-#*~=rm'
    let s = ''
    for (let i = 0; i < n; i += 1) s += alphabet[Math.floor(next() * alphabet.length)]
    return s
  },
  randomTokens: n => {
    const next = seeded(n + 1)
    const tokens = ['`', '$(', ')', '(', '{', '}', ';', '|', '&', '&&', '<<', '<<<', '<', '>', "'", '"', '\\', '\n', ' ', '$', '${', '#', '*', 'rm', '-rf', 'find', '-exec', '\;', 'git', '-c', 'push', '--force', 'bash', 'eval', 'sudo', 'xargs', 'psql', 'drop', 'table', '/*', '*/', 'EOF', 'sh', '-s', 'env', '-S', 'x']
    let s = ''
    while (s.length < n) s += `${tokens[Math.floor(next() * tokens.length)]} `
    return s.slice(0, n)
  },
}
