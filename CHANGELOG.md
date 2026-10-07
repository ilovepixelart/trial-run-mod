# Changelog

All notable changes to trial-run. Versions follow [Semantic Versioning](https://semver.org): while the version is 0.y.z, anything may change between releases. The public surface is the `/court` commands, the charges, the verdict-to-decision mapping and the saved docket layout.

## [Unreleased]

### Added

- Risky Bash commands go to trial before they run: recursive delete, force push, hard reset, forced `git clean`, dropped or truncated SQL data, `kubectl delete` and `terraform destroy`, looking through wrappers, nested shells, global flags and compound commands.
- A prosecution, a defense and a judge (three Haiku calls) argue in a pane; guilty denies with the judge's reason, not guilty defers to your permission rules, a mistrial asks.
- Sentencing: every conviction names the safer command for its charge.
- Contempt of court: retrying a convicted command in the same session is denied with no trial and no model call.
- `/court` (the last trial) and `/court docket` (conviction rate, recent cases, verdict strip, rap sheet).
- Object (`o`) and Skip (`s`) during the deliberation; a skipped trial is filed as waived.
- The saved docket records its layout (1); a docket saved by a newer version is never read or overwritten.
- Requires Claude Code 2.1.287 or later.
