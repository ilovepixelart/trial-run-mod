# Changelog

All notable changes to trial-run. Versions follow [Semantic Versioning](https://semver.org): while the version is 0.y.z, anything may change between releases. The public surface is the `/court` commands, the charges, the verdict-to-decision mapping and the saved docket layout.

## [Unreleased]

### Added

- Risky Bash commands go to trial before they run: recursive delete, force push, hard reset, forced `git clean`, dropped or truncated SQL data, `kubectl delete`, `terraform destroy` and an unread script (one a shell or SQL client reads from a file, a download or an expansion), looking through wrappers, nested shells, global flags and compound commands.
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
- Settings (`userConfig`): `strictness` (`lenient`, `fair` or `hanging`, default `fair`) changes the judge's doctrine sentence and never the decision a ruling maps to; `sounds` (default on) silences the gavel and the spoken verdict; `charges` (default every charge) lists the charges that go to trial, and a charge switched off is never tried.
- The Bash tool's description tells Claude that risky commands stand trial and that stating its intent in the same message helps the defense (`tool.describe`, under 200 characters, Bash only).
- The verdict in the transcript: a denied call's row carries `✕ GUILTY · case #0017` or `✕ CONTEMPT · case #0018` beneath Claude Code's own drawing of it (the call's `ToolResult`, or the `ToolGroup` it is folded into), which it wraps and never replaces; every other row is untouched.
- Requires Claude Code 2.1.287 or later.

### Known limitations

- Every session on the machine shares one docket and the store has no atomic update. The court re-reads the docket right before each filing, so a case another session filed earlier is kept, but one filed between that read and this session's write is lost.
