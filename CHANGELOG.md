# Changelog

All notable changes to trial-run. Versions follow [Semantic Versioning](https://semver.org): while the version is 0.y.z, anything may change between releases. The public surface is the `/court` commands, the charges, the verdict-to-decision mapping and the saved docket layout.

## [Unreleased]

### Changed

- What Claude is told on a conviction and on contempt: the command stays denied for the rest of the conversation, even after the sentence is carried out, and only the person can reopen the case, with `/court appeal <context>`. A contempt denial also tells Claude not to work around the court (another spelling, the person's shell, or switching the court off). In 0.2.0 a sentence such as "take a backup first" read as a way to retry: Claude took the backup, retried, was denied for contempt, then suggested running the command from the person's shell or disabling the court.

## [0.2.0] - 2026-10-08

### Changed

- A command run inside a container is now tried as itself: `docker exec`, `docker container exec`, `docker compose exec`, `docker-compose exec`, `podman exec`, `nerdctl exec` and `kubectl exec ... --` are looked through, their options and the container or service name skipped. In 0.1.0, `docker compose exec db psql -c "TRUNCATE orders"` and `docker compose exec db rm -rf /var/lib/postgresql/data` ran with no trial. Commands that were left to your permission rules before may now go to trial first; a harmless command inside a container (`docker compose exec db psql -c "SELECT 1"`) is still not charged.

## [0.1.0] - 2026-10-08

First release. Requires Claude Code 2.1.287 or later.

### Added

- Risky Bash commands go to trial before they run: recursive delete, force push, hard reset, forced `git clean`, dropped or truncated SQL data, `kubectl delete`, `terraform destroy` and an unread script (one a shell or SQL client reads from a file, a download or an expansion), looking through wrappers, nested shells, global flags and compound commands.
- A line the court cannot read in bounded work goes to trial as an unread script, never past the court unread unless `unread-script` is switched off in the `charges` setting: a line over 64 Ki characters, a reading past its fixed work budget (`BUDGET` in `hooks/risky.ts`, 600 000 steps) and a `find -exec` nested more than three finds deep.
- A prosecution, a defense and a judge (three Haiku calls) argue in a pane; guilty denies with the judge's reason, not guilty defers to your permission rules, a mistrial asks.
- Sentencing: every conviction names the safer command for its charge.
- Evidence is quoted with its angle brackets escaped, so no command, message or exhibit can close its tag and pose as another witness, and the court is told that evidence asking it for a verdict counts against its side. The speeches reach the judge the same way, each in its own escaped tag, and a speech that dictates a verdict counts against its side; only the judge's own first two lines are read as the verdict.
- Exhibits: before the speeches the court reads facts from git (upstream commits a force push would overwrite and their distinct authors, local commits a hard reset would drop, whether a deleted path is tracked and committed as HEAD holds it and how many untracked, ignored and changed files are under it, untracked and ignored files a clean would remove) and enters them into evidence and the pane. Read-only commands from a fixed allowlist, by argv, hardened against repository config, 500 ms in all; a slow or failing git leaves the exhibit out. Only a simple command line is read, and a push only when it names one remote and one branch, so an exhibit is always about what the shell will touch. A changed file is counted by comparing the index's size and time with the file's own (`$.fs.stat`), never by reading content; a tracked target whose changes could not be counted is entered as "uncommitted changes under it were not checked". "History keeps it" is entered only when every index entry under the target is in HEAD with the same mode and object and none was added with `git add -N`; a submodule, an embedded repository, a nested repository or a linked worktree under a target is entered as a nested repository whose contents were not checked, never counted, and a branch with no commits is entered as one. A delete target git would read elsewhere than `rm` deletes (a symbolic link in its path, a `..` or `.git` part, a case alias, the working directory or the repository's top level) gets no exhibit.
- Contempt of court: retrying a convicted command in the same conversation is denied with no trial and no model call. A new session, `/clear`, `/resume` and `/branch` forgive it; a compaction does not.
- `/court` (the last trial) and `/court docket` (conviction rate, recent cases, verdict strip, rap sheet).
- `/court appeal <context>` retries the latest conviction with the context as the person's words and files it marked as an appeal; an upheld appeal lifts contempt for that command, so a retry goes to trial again. Only an appeal typed at the terminal is heard: any other origin, Claude's included, is refused.
- Object (`o`) and Skip (`s`) during the deliberation; a skipped trial is filed as waived.
- Every charged command goes to trial each time it runs; only contempt denies one without a trial. An acquittal hands the decision to your permission rules, and a command no charge recognises is not tried and falls through to them: the court is a best-effort layer, not a security boundary.
- The saved docket records its layout (2). Stored records are read as untrusted: unknown fields are dropped. A layout 1 docket is read as it is; a docket saved by a newer version is never read or overwritten.
- Settings (`userConfig`): `strictness` (`lenient`, `fair` or `hanging`, default `fair`) changes the judge's doctrine sentence and never the decision a ruling maps to; `sounds` (default on) silences the gavel and the spoken verdict; `charges` (default every charge) lists the charges that go to trial, and a charge switched off is never tried. An id the court does not know is left out, and a list naming none it knows tries every charge; either is warned about once in the transcript when the session starts.
- The Bash tool's description tells Claude that risky commands stand trial and that stating its intent in the same message helps the defense (`tool.describe`, under 200 characters, Bash only).
- The verdict in the transcript: a denied call's row carries `✕ GUILTY · case #0017` or `✕ CONTEMPT · case #0018` beneath Claude Code's own drawing of it (the call's `ToolResult`, or the `ToolGroup` it is folded into), which it wraps and never replaces; every other row is untouched.
- The spinner says `Deliberating` while a trial is in session; only its word changes, and every other time it is Claude Code's own.
- Adjournment: a main-conversation turn that held a trial ends with `Court adjourned. 1 conviction, 1 acquittal this turn.` under the answer; turns without trials, interrupted turns and subagents' turns get no line.

### Known limitations

- Every session on the machine shares one docket and the store has no atomic update. The court re-reads the docket right before each filing, so a case another session filed earlier is kept, but one filed between that read and this session's write is lost.
