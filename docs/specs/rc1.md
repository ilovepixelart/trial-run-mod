# trial-run 0.1.0: release candidate 1

## Problem and outcome

trial-run puts risky shell commands on trial. Live runs show three gaps: an agent can retry a convicted command and trigger a fresh trial each time, a conviction tells the agent what not to do but not what to do instead, and the court rules on words alone ("colleagues' work" for a solo repository). The release adds contempt, sentencing, exhibits gathered from the repository, precedent and appeals, and ships a clean, documented, versioned 0.1.0.

## Acceptance clauses

### Contempt of court

- **CONTEMPT-001** A command identical to one convicted earlier in the same session is denied without a trial and without any model call. Check: `court.test.ts` "a retried conviction is contempt, decided with no model call".
- **CONTEMPT-002** Identical means the same charged simple command after normalising whitespace and flag order of short flags (`rm -rf src` equals `rm -fr  src`). Check: `contempt.test.ts` normalisation table, both directions (different target paths are not contempt).
- **CONTEMPT-003** The denial reason names contempt and the earlier case number, in character. Check: `verdict.test.ts` "contempt reason cites the case".
- **CONTEMPT-004** The pane shows a CONTEMPT stamp in the guilty colour and files the case with verdict `contempt`; the docket counts it as a conviction. Check: `art.test.ts` widths for the contempt stamp; `docket.test.ts` "contempt counts as a conviction".
- **CONTEMPT-005** Contempt memory is per conversation: cleared on `session.start` and on `classic.SessionStart` with `source` `clear`, `resume` or `fork` (`/clear`, `/resume` and `/branch` do not fire `session.start`). Check: `court.test.ts` "a new session forgives contempt" and "/clear forgives contempt".

### Sessions and the store

- **SESSION-001** Any `$.state` value seeded from `$.store` is reloaded on `classic.SessionStart` for `clear`, `resume` and `fork`, so the pane, band and docket never show "not in session" after `/clear`. Check: the kit's "test a drawing after /clear" pattern.
- **STORE-001** Every docket write re-reads `cases` immediately before filing (never from a copy loaded earlier), because every session on the machine shares `$.store`. The remaining narrow race is documented as a known limitation. Check: `docket.test.ts` "a stale read does not lose a case".

### Sentencing

- **SENTENCE-001** A guilty ruling carries a sentence: one safer alternative for the charged command, taken from a table per charge (force push to `--force-with-lease`, terraform destroy to `plan -destroy` first, recursive delete of a tracked path to `git rm -r`, hard reset to `git stash` first, git clean to `git clean -n`, kubectl delete to `--dry-run=client`, SQL drop to a backup first). Check: `sentence.test.ts` table, one row per charge.
- **SENTENCE-002** The sentence is appended to the deny reason Claude receives, so the agent can take the safe path. Check: `verdict.test.ts` "guilty reason carries the sentence".
- **SENTENCE-003** The pane shows "SENTENCE" under the court's ruling. Check: `court.test.ts` "the sentence is read out".
- **SENTENCE-004** A charge without a table entry gets no sentence line rather than an invented one. Check: `sentence.test.ts` "unknown charge, no sentence".

### Exhibits from the repository

- **EXHIBIT-001** Before the speeches, the court gathers facts with read-only git commands only, from a fixed allowlist run through `$.process.run` with an argv array (never a shell string): `git rev-parse --is-inside-work-tree --show-toplevel --show-prefix --abbrev-ref HEAD` (repository, directory within it, branch; a detached HEAD is unknown); for a force push naming exactly one remote and one plain branch (not `HEAD`), `git rev-list --count --end-of-options refs/heads/<branch>..refs/remotes/<remote>/<branch>`, `git log -20 --no-show-signature --format=%ae --end-of-options refs/heads/<branch>..refs/remotes/<remote>/<branch>` and `git config --get-regexp '^remote\.<remote>\.(push|mirror)$'` (any match leaves the push unknown); for a hard reset `git rev-list --count @{upstream}..HEAD`; for `rm` of 1 to 3 targets none ending in `/`, `git ls-files --error-unmatch -- <path>`, `git ls-files --others --exclude-standard -- <path>` and `git ls-files --others --ignored --exclude-standard -- <path>`, all reported or none; for `git clean` `git ls-files --others --exclude-standard`, plus `--ignored` when `-x` or `-X` is given. Exhibits are read only for a simple command line (`isSimpleCommand`) whose `git` has no options before its subcommand; any target the shell would read differently than git (quoting, escapes, expansion, globs, a compound line, `git -C`, an unnamed or `src:dst` push) leaves the facts unknown: no exhibit, no precedent. Every call runs as `git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.untrackedCache=false -c log.showSignature=false --literal-pathspecs --no-optional-locks --no-pager ...` (every path read as written, never as pathspec magic) with `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `GIT_PAGER=cat`, `PAGER=cat`, `GIT_ASKPASS=`, `SSH_ASKPASS=`, `LC_ALL=C`. `git status` and `git diff` are excluded: against a repository whose config names a clean filter and an external diff, both ran those programs even with the flags above, while every allowlisted command ran none. Check: `exhibits.test.ts` "only allowlisted git argv run" over every charge, and `tests/hostile/git.hostile.mjs` (config, `include.path` and `includeIf` variants, each with a positive control, and `:src`, `:(glob)*`, `:!src`, `:/src` read literally).
- **EXHIBIT-002** Each exhibit has a deadline (500 ms) and a total budget; a slow, failing or absent git yields "no exhibit", never a mistrial and never a delay past the trial deadline. Check: `exhibits.test.ts` timeout and failure cases with `mock.clock`.
- **EXHIBIT-003** Exhibits reach all three roles as quoted evidence inside tags and are listed in the pane as "Exhibit A ...". Check: `court.test.ts` "exhibits are entered into evidence".
- **EXHIBIT-004** Output passed to the models is truncated and stripped of control characters; author emails are reduced to a count of distinct authors. Check: `exhibits.test.ts` sanitising table.
- **EXHIBIT-005** README access section lists the git commands and states they are read-only. Check: README review clause REL-004.

### Precedent and appeals

- **PRECEDENT-001** A whole command line identical (CONTEMPT-002 normalisation, applied to the whole line, not the charged part) to one acquitted in this project before is acquitted by precedent without model calls, citing the case. Only a line that is one simple command of plain words (`isSimpleCommand`: no compound operator, newline, substitution, variable, glob, brace or tilde expansion, redirection, quoting, env assignment, wrapper or nested shell, failing closed on anything else) sets or follows precedent; the match is re-derived from the stored command, never from a stored key, and a command cut to fit the docket is never precedent. Contempt stays keyed on the charged simple command: it only denies, so the wider match only tightens. Check: `court.test.ts` "a compound, substituted, redirected or wrapped line never follows precedent", "a stored record that claims a key it does not hold binds nothing", `risky.test.ts` simple-command table, and "precedent acquits with no model call".
- **PRECEDENT-002** Precedent never overrides your rules: an acquittal by precedent still defers to the permission decision beneath, as any acquittal does. Check: `court.test.ts` "precedent is as weak as an acquittal" (through the court, since precedent is an ordinary acquittal ruling).
- **PRECEDENT-003** Precedent only binds within the same project root. Check: `docket.test.ts` "precedent is per project", `court.test.ts` "precedent binds only in the project root it was set in".
- **PRECEDENT-004** Precedent does not expire, but it only applies when the current exhibits match the precedent case's exhibits on the facts that matter (upstream ahead count is zero in both, the target's tracked state is the same); otherwise the case goes to trial. The precedent case stores its exhibit summary, including where git ran (repository top level, directory within it, branch); a change in any of them means trial. Each delete target must read clean both then and now: 0 untracked, 0 ignored and 0 changed files under it, the changed count from `git -c core.quotePath=false ls-files --debug -- <path>` (the index's size and mtime, parsed strictly: a quoted, indented or malformed entry is unknown) against `$.fs.stat` of each file, up to 200 files, with a file not strictly older than the index file (`rev-parse --git-path index`, a linked worktree's own) unknown, as is any failed stat; `ls-files -m` and `diff-files` are not used because both ran a repository's clean filter. A target that does not land where it is spelled from the real working directory (`$.fs.stat(<path>, { resolve: true })`), because of a symbolic link in any component or because it does not resolve, has no target facts at all. Fails closed: precedent binds only when every material fact the plan asks for was read now (in a repository, parsed strictly) and is stored on the precedent case; an unread fact (no git, not a repository, no upstream, a timeout, unparseable output, a stored null) never matches, unknown never equals unknown, and a charge with no material facts never sets precedent. Check: `precedent.test.ts` "precedent fails closed", `exhibits.test.ts` "unknown never equals unknown". Check: `court.test.ts` "changed facts reopen the case".
- **APPEAL-001** `/court appeal <context>` re-tries the most recent conviction with the added context as evidence and files the result as a new case marked appeal; a successful appeal clears contempt for that command. Check: `court.test.ts` appeal both outcomes.
- **APPEAL-002** An appeal with no conviction to appeal says so and files nothing. Check: `court.test.ts` "nothing to appeal".

### Showcase: what trial-run demonstrates about mods

The court doubles as a reference mod: each clause uses a mods capability the court did not use before, in service of the story.

- **SHOW-001 Verdict in the transcript.** A `ui.render` hook on the `ToolResult` site (and `ToolUse` where the denied call is drawn) adds a one-line stamp to the denied Bash row: `✕ GUILTY · case #0017` (or `✕ CONTEMPT · case #0018`), drawn by wrapping Claude Code's own tree, never replacing it. Rows for other tools and for commands that did not go to trial are untouched. Check: `transcript.test.ts` "a convicted call's row carries the stamp" and "an ordinary row is returned unchanged"; art widths at 80 and 120.
- **SHOW-002 Court-aware Claude.** A `tool.describe` hook appends two sentences to the Bash tool description: risky commands stand trial, and stating the intent in the same message helps the defense. It changes only the Bash description, once per session, and stays under 200 characters added. Check: `describe.test.ts` "Bash description gains the notice", "other tools are untouched"; a live check that Claude states its intent before a risky command.
- **SHOW-003 Settings in /config.** `userConfig` in plugin.json declares: `strictness` (`lenient`, `fair`, `hanging`; default `fair`), `sounds` (boolean, default true), `charges` (multiple, default every charge). `register(on, options)` reads them; strictness changes the judge's doctrine sentence only, never the decision mapping (a model's acquittal can still only defer); a charge switched off is never tried. Check: `register.test.ts` per option, and `claude plugin validate --strict` passes with `userConfig`.
- **SHOW-004 Spinner.** A `ui.render` hook on the `Spinner` site shows the word `Deliberating` while a trial is in session, and leaves the spinner untouched otherwise. Check: `court.test.ts` "the spinner deliberates during a trial only".
- **SHOW-005 Adjournment.** A `turn.complete` hook adds one line under the answer when the turn held at least one trial: `Court adjourned. 1 conviction, 1 acquittal this turn.` No line for a turn without trials. Check: `court.test.ts` both cases.
- **SHOW-006 How it works.** `docs/how-it-works.md` explains each mods concept the court uses, why, and where in the code: the hooks module and `register(on, options)`; `tool.check` as middleware and why the court only tightens (`next(e)` first, then a stricter decision); `.catch` as the fail-closed path; render sites (`Pane`, `AbovePrompt`, `ToolResult`, `Spinner`) and `Client` modules for animation; `$.state` atoms declared in `types/index.d.ts`; `$.store` with its layout version; `$.model.complete`; `$.process.run` with an argv allowlist (exhibits); `userConfig`; tiers and how an organisation could seat the court with `prependPlugins`; testing with `claude plugin test` and the kit's mocks, and `claude plugin validate` as the access report. Pointers and constraints only, no pasted code beyond one-line signatures. Check: every symbol it names exists in the code (a grep per symbol, as REL-004 does for the README).

Technique, from the official mods docs:

- **SHOW-001 (technique)** Wrap, never replace: `await next(e)` inside a `Box` with the stamp line, at the `ToolResult` site keyed by the denied call's id (`e.requestId`); verify which event field carries that id in the build's types before relying on it.
- **SHOW-004 (technique)** Change a detail: `next({ ...e, props: { ...e.props, word: 'Deliberating' } })`, keeping Claude Code's animation.
- **SHOW-005 (scope)** Main conversation only: skip `turn.complete` events with `e.agentId` set, and turns with `e.isAborted`.

### Release

- **REL-001** Version lives in `plugin.json` only; `marketplace.json` matches it; a test asserts they agree. Check: `release.test.ts`.
- **REL-002** CHANGELOG.md with 0.1.0, the public surface listed: commands (`/court`, `/court docket`, `/court appeal`), charges, store keys, required Claude Code version. Check: review.
- **REL-003** Byte scan finds no em or en dashes; no secrets, no `.env`, no generated files tracked (`.claude-plugin/types/` ignored). Check: `scratchpad/dash_scan.py`, `git status --ignored` review.
- **REL-004** README matches behaviour: every command, charge, access item and limitation in the code appears, and nothing absent from the code is claimed. Check: grep for each symbol, clause by clause.
- **REL-005** Gates green as one chain: `claude plugin validate --strict .` && `claude plugin test .` && `npx -y -p typescript tsc -p .`; CI workflow green on GitHub on the pushed head SHA (after the owner approves the push).
- **REL-006** Demo GIF recorded with no usage banner and no slash menu in any frame; every beat present. Check: frame sheet review.
- **REL-007** Commits are small and logical, authored by the owner, no AI attribution; tag `trial-run--v0.1.0` via `claude plugin tag`. Check: `git log` review (only when the owner asks to commit).

## Out of scope

Desktop SVG rendering, sounds beyond the existing gavel, a public directory submission (after the owner reviews the release), light themes.

## Risks

- Exhibits widen access from none to read-only `git`; a malicious repository cannot inject through argv, but output reaches the model, hence EXHIBIT-004.
- Contempt and precedent change cost and latency claims in the README and the article; REL-004 and the article sync cover it.
- Precedent could acquit a command whose context changed (now on a shared branch). Mitigation: precedent requires the same project root and, when exhibits differ materially (upstream ahead now, not before), falls back to a trial. Open question below.

## Decisions (owner, resolved)

1. Exhibits: read-only git access is approved, allowlist only (EXHIBIT-001).
2. Precedent: no expiry; changed exhibits reopen the case (PRECEDENT-004).
3. Contempt: per session (CONTEMPT-005).

## Micro-tasks, in order

1. CONTEMPT-002 normaliser (pure) and tests.
2. CONTEMPT-001, 003, 005 wiring in `tool.check`, reason text.
3. CONTEMPT-004 stamp, docket verdict, art tests.
4. SENTENCE-001, 004 table (pure).
5. SENTENCE-002, 003 reason and pane.
6. EXHIBIT-001, 002, 004 gatherer (pure argv plan plus a runner over `$.process.run`).
7. EXHIBIT-003 evidence in prompts and pane; EXHIBIT-005 README.
8. PRECEDENT-001 to 004.
9. APPEAL-001, 002, with CONTEMPT-005, SESSION-001 and STORE-001 before the features that depend on them.
10. SHOW-003, SHOW-002, SHOW-001, SHOW-004, SHOW-005, then SHOW-006 last so it describes the finished code.
11. REL-001 to 004, then live playground verification of every feature, then REL-006 recording after the usage banner clears, then REL-005 and REL-007 on the owner's go-ahead.
