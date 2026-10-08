# trial-run 0.1.0: release candidate 1

## Problem and outcome

trial-run puts risky shell commands on trial. Live runs show three gaps: an agent can retry a convicted command and trigger a fresh trial each time, a conviction tells the agent what not to do but not what to do instead, and the court rules on words alone ("colleagues' work" for a solo repository). The release adds contempt, sentencing, exhibits gathered from the repository and appeals, and ships a clean, documented, versioned 0.1.0.

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

- **EXHIBIT-001** Before the speeches, the court gathers facts with read-only git commands only, from a fixed allowlist run through `$.process.run` with an argv array (never a shell string): `git rev-parse --is-inside-work-tree --show-toplevel --show-prefix --git-path index` (repository, directory within it, index file) and `git rev-parse --abbrev-ref --verify --quiet HEAD` (branch; a detached HEAD is unknown; exit 1 with no output is a branch with no commits); for a force push naming exactly one remote and one plain branch (not `HEAD`), `git rev-list --count --end-of-options refs/heads/<branch>..refs/remotes/<remote>/<branch>`, `git log -20 --no-show-signature --format=%ae --end-of-options refs/heads/<branch>..refs/remotes/<remote>/<branch>` and `git config --get-regexp '^(remote\.<remote>\.(push|pushurl|mirror)|url\..*\.pushinsteadof)$'` (any match leaves the push unknown); for a hard reset `git rev-list --count @{upstream}..HEAD`; for `rm` of 1 to 3 targets none ending in `/` and none with a `..` or `.git` part, `git ls-files --stage -z -- <path>`, `git ls-tree -r -z HEAD -- <path>`, `git ls-files --others --exclude-standard -- <path>` and `git ls-files --others --ignored --exclude-standard -- <path>`, all reported or none; for `git clean` `git ls-files --others --exclude-standard`, plus `--ignored` when `-x` or `-X` is given. Exhibits are read only for a simple command line (`isSimpleCommand`) whose `git` has no options before its subcommand; any target the shell would read differently than git (quoting, escapes, expansion, globs, a compound line, `git -C`, an unnamed or `src:dst` push) leaves the facts unknown: no exhibit. Every call runs as `git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.untrackedCache=false -c log.showSignature=false --literal-pathspecs --no-optional-locks --no-pager ...` (every path read as written, never as pathspec magic) with `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `GIT_PAGER=cat`, `PAGER=cat`, `GIT_ASKPASS=`, `SSH_ASKPASS=`, `LC_ALL=C`. `git status` and `git diff` are excluded: against a repository whose config names a clean filter and an external diff, both ran those programs even with the flags above, while every allowlisted command ran none. Check: `exhibits.test.ts` "only allowlisted git argv run" over every charge, and `tests/hostile/git.hostile.mjs` (config, `include.path` and `includeIf` variants, each with a positive control, no file under `.git` changed, and `:src`, `:(glob)*`, `:!src`, `:/src` read literally).
- **EXHIBIT-002** Each exhibit has a deadline (500 ms) and a total budget; a slow, failing or absent git yields "no exhibit", never a mistrial and never a delay past the trial deadline. Check: `exhibits.test.ts` timeout and failure cases with `mock.clock`.
- **EXHIBIT-003** Exhibits reach all three roles as quoted evidence inside tags and are listed in the pane as "Exhibit A ...". Check: `court.test.ts` "exhibits are entered into evidence".
- **EXHIBIT-004** Output passed to the models is truncated and stripped of control characters; author emails are reduced to a count of distinct authors. Check: `exhibits.test.ts` sanitising table.
- **EXHIBIT-005** README access section lists the git commands and states they are read-only. Check: README review clause REL-004.
- **EXHIBIT-006** For each delete target the exhibits count the untracked, ignored and changed files under it, the changed count from `git -c core.quotePath=false ls-files --debug -- <path>` (the index's size and mtime, parsed strictly: a quoted, indented or malformed entry is unknown) against `$.fs.stat` of each file, up to 200 files, with a file not strictly older than the index file (`rev-parse --git-path index`, a linked worktree's own) unknown, as is any failed stat; `ls-files -m` and `diff-files` are not used because both ran a repository's clean filter. A tracked target whose changed count is unknown is entered with "uncommitted changes under it were not checked". A target that does not land where it is spelled from the real working directory (`$.fs.stat(<path>, { resolve: true })`), because of a symbolic link in any component or because it does not resolve, has no target facts at all; nor has a target any part of which its directory does not list with that exact spelling (`$.fs.list`: a case alias on a case-insensitive file system), the working directory itself, or an absolute path not strictly inside the repository's top level. Check: `targets.test.ts`, and `exhibits.test.ts` "a clean target" and "a target behind a symbolic link".
- **EXHIBIT-007** A tracked delete target is entered as "history keeps it" only when every index entry under it (`ls-files --stage -z`, stage 0) is in HEAD with the same mode and object (`ls-tree -r -z HEAD`), none is an intent to add (the `ls-files --debug` flag, since it records the empty file), none is a gitlink, no untracked or ignored listing entry under it ends in `/`, and its changed count is known. A target the index holds otherwise is entered with "not all of it is committed, so history does not keep all of it". A gitlink (a submodule or an embedded repository) or a listing entry ending in `/` (a nested repository or a linked worktree, which git lists as one directory) is entered as "holds a nested repository, whose contents were not checked", and no untracked, ignored or changed count is entered for that target, nor a repository count for `git clean`. A branch with no commits is entered as "this repository has no commits on its current branch", never as "not a git repository", and nothing in it is kept by history. A record not read exactly (a conflict stage, another tree entry type, a cut or garbled record) leaves every target unknown. Check: `tests/hostile/git.hostile.mjs` "a clean folder and file committed in HEAD are kept by history", "an embedded repository tracked as a gitlink", "a submodule with untracked and changed work inside", "a file or folder added with intent to add", "a tracked folder holding nested repositories or a linked worktree" and "a repository with no commits", and `exhibits.test.ts` "what history keeps of a tracked target".

### Appeals

Precedent (acquitting a repeated command without a trial) is removed from 0.1.0: every charged command goes to trial, and an earlier acquittal never decides a later one. It may return in a later release under its own spec. Its IDs are kept for traceability. Check: `court.test.ts` "the same command repeated in the same project on the same clean facts is tried again" and "an old docket record that carries facts loads, and its facts are ignored".

- **PRECEDENT-001** Removed from this release (acquittal of an identical simple command line without model calls).
- **PRECEDENT-002** Removed from this release (precedent deferring to the permission decision beneath).
- **PRECEDENT-003** Removed from this release (precedent bound to the project root).
- **PRECEDENT-004** Removed from this release (precedent bound to unchanged material facts). Its target reads stay as evidence under EXHIBIT-006.
- **APPEAL-001** `/court appeal <context>` re-tries the most recent conviction with the added context as evidence and files the result as a new case marked appeal; a successful appeal clears contempt for that command. Check: `court.test.ts` appeal both outcomes.
- **APPEAL-002** An appeal with no conviction to appeal says so and files nothing. Check: `court.test.ts` "nothing to appeal".

### Showcase: what trial-run demonstrates about mods

The court doubles as a reference mod: each clause uses a mods capability the court did not use before, in service of the story.

- **SHOW-001 Verdict in the transcript.** A `ui.render` hook on the `ToolResult` site (and `ToolUse` where the denied call is drawn) adds a one-line stamp to the denied Bash row: `✕ GUILTY · case #0017` (or `✕ CONTEMPT · case #0018`), drawn by wrapping Claude Code's own tree, never replacing it. Rows for other tools and for commands that did not go to trial are untouched. Check: `transcript.test.ts` "a convicted call's row carries the stamp" and "an ordinary row is returned unchanged"; art widths at 80 and 120.
- **SHOW-002 Court-aware Claude.** A `tool.describe` hook appends two sentences to the Bash tool description: risky commands stand trial, and stating the intent in the same message helps the defense. It changes only the Bash description, once per session, and stays under 200 characters added. Check: `describe.test.ts` "Bash description gains the notice", "other tools are untouched"; a live check that Claude states its intent before a risky command.
- **SHOW-003 Settings in /config.** `userConfig` in plugin.json declares: `strictness` (`lenient`, `fair`, `hanging`; default `fair`), `sounds` (boolean, default true), `charges` (multiple, default every charge). `register(on, options)` reads them; strictness changes the judge's doctrine sentence only, never the decision mapping (a model's acquittal can still only defer); a charge switched off is never tried. Check: `register.test.ts` per option, and `claude plugin validate --strict` passes with `userConfig`. **Built:** `register.test.ts` "settings": "by default every charge goes to trial", "a charge switched off is never tried", "a charge switched off does not hide another one on the same line", "no charge switched on tries nothing", "the fair court is the default doctrine", "a lenient court changes the judge's doctrine sentence and nothing else" (and hanging), "a lenient court keeps the decision mapping" (and hanging), "an acquittal by a lenient court still only hands back the rules", "a conviction by a lenient court still denies", "a strictness the court does not know is the fair court", "with sounds on, the gavel bangs and the verdict is spoken", "with sounds off, the court is silent, contempt included"; `charges` is a list field, which `/config` does not draw as a row.
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
- Contempt changes cost and latency claims in the README and the article; REL-004 and the article sync cover it.

## Decisions (owner, resolved)

1. Exhibits: read-only git access is approved, allowlist only (EXHIBIT-001).
2. Precedent: removed from 0.1.0; every charged command goes to trial (PRECEDENT-001 to 004).
3. Contempt: per session (CONTEMPT-005).

## Micro-tasks, in order

1. CONTEMPT-002 normaliser (pure) and tests.
2. CONTEMPT-001, 003, 005 wiring in `tool.check`, reason text.
3. CONTEMPT-004 stamp, docket verdict, art tests.
4. SENTENCE-001, 004 table (pure).
5. SENTENCE-002, 003 reason and pane.
6. EXHIBIT-001, 002, 004 gatherer (pure argv plan plus a runner over `$.process.run`).
7. EXHIBIT-003 evidence in prompts and pane; EXHIBIT-005 README.
8. PRECEDENT-001 to 004: removed from this release.
9. APPEAL-001, 002, with CONTEMPT-005, SESSION-001 and STORE-001 before the features that depend on them.
10. SHOW-003, SHOW-002, SHOW-001, SHOW-004, SHOW-005, then SHOW-006 last so it describes the finished code.
11. REL-001 to 004, then live playground verification of every feature, then REL-006 recording after the usage banner clears, then REL-005 and REL-007 on the owner's go-ahead.
