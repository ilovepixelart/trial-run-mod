# Privacy

trial-run runs inside Claude Code on your machine. This page lists everything it sends and everything it keeps.

## What it sends, and when

Only when a Bash command matches a charge (see "What goes to trial" in the README) and goes to trial. Ordinary commands and contempt send nothing. The calls start as soon as court opens, so a trial you object to or skip has usually sent them already; pressing Object or Skip decides the case but does not recall a call in flight.

For each trial, the mod makes three model calls through Claude Code's own model access (`$.model.complete`, model `haiku`): the prosecution, the defense, then the judge. Each call carries:

- the charge label, such as `force push`;
- the command as written;
- your latest message and Claude's latest message, each cut to its last 600 characters;
- for the judge, also the prosecution's and the defense's speeches.

These calls go wherever Claude Code sends its own model requests, under your Claude Code account and settings. The mod makes no network calls of its own and sends no telemetry.

## What it keeps

In Claude Code's plugin store on this machine (`$.store`), one record per case: the case number, the charged command cut to 80 characters, the charge, the verdict and the time. At most the newest 200 cases are kept, plus the docket's layout version.

Nothing else is written. Sounds (the gavel and the spoken verdict) play locally.

## How to delete it

The docket is one file: `~/.claude/plugins/store/trial-run_<marketplace>-<hash>.json`, for example `trial-run_trial-run-mod-a11145457a04.json` when installed from this repository's marketplace. Delete that file to erase every case. The next trial starts a new docket at case #0001.
