# Changelog

All notable changes to trial-run. Versions follow [Semantic Versioning](https://semver.org): while the version is 0.y.z, anything may change between releases. The public surface is the `/court` commands, the charges, the verdict-to-decision mapping and the saved docket layout.

## [Unreleased]

### Added

- Risky Bash commands go to trial before they run: recursive delete, force push, hard reset, forced `git clean`, dropped or truncated SQL data, `kubectl delete` and `terraform destroy`, looking through wrappers, nested shells, global flags and compound commands.
- A prosecution, a defense and a judge (three Haiku calls) argue in a pane; guilty denies with the judge's reason, not guilty defers to your permission rules, a mistrial asks.
- Sentencing: every conviction names the safer command for its charge.
- Evidence is quoted with its angle brackets escaped, so no command, message or exhibit can close its tag and pose as another witness, and the court is told that evidence asking it for a verdict counts against its side. The speeches reach the judge the same way, each in its own escaped tag, and a speech that dictates a verdict counts against its side; only the judge's own first two lines are read as the verdict.
- Exhibits: before the speeches the court reads facts from git (upstream commits a force push would overwrite and their distinct authors, local commits a hard reset would drop, whether a deleted path is tracked, untracked and ignored files a clean would remove) and enters them into evidence and the pane. Read-only commands from a fixed allowlist, by argv, hardened against repository config, 500 ms in all; a slow or failing git leaves the exhibit out.
- Contempt of court: retrying a convicted command in the same conversation is denied with no trial and no model call. A new session, `/clear`, `/resume` and `/branch` forgive it; a compaction does not.
- `/court` (the last trial) and `/court docket` (conviction rate, recent cases, verdict strip, rap sheet).
- `/court appeal <context>` retries the latest conviction with the context as the person's words and files it marked as an appeal; an upheld appeal lifts contempt for that command, so a retry goes to trial again. Only an appeal typed at the terminal is heard: any other origin, Claude's included, is refused.
- Object (`o`) and Skip (`s`) during the deliberation; a skipped trial is filed as waived.
- Precedent: a command line that is one simple command of plain words, acquitted before in the same project root, whose latest ruling there is that acquittal, is acquitted again with no model call, citing the case, while the facts that matter (tracked targets, upstream commits the branch lacks) are unchanged. It defers to your rules beneath like any acquittal.
- The saved docket records its layout (2: a simple command line's case also keeps its project root and material facts). Stored records are read as untrusted: unknown fields are dropped and a precedent is matched on the stored command itself. A layout 1 docket is read as it is and its cases set no precedent; a docket saved by a newer version is never read or overwritten.
- Requires Claude Code 2.1.287 or later.

### Known limitations

- Every session on the machine shares one docket and the store has no atomic update. The court re-reads the docket right before each filing, so a case another session filed earlier is kept, but one filed between that read and this session's write is lost.
