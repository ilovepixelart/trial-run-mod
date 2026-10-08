# Privacy

trial-run runs inside Claude Code on your machine. This page lists everything it sends and everything it keeps.

## What it sends, and when

Only when a Bash command matches a charge (see "What goes to trial" in the README) and goes to trial. Ordinary commands and contempt send nothing. The calls start as soon as court opens, so a trial you object to or skip has usually sent them already; pressing Object or Skip decides the case but does not recall a call in flight.

For each trial, the mod makes three model calls through Claude Code's own model access (`$.model.complete`, model `haiku`): the prosecution, the defense, then the judge. Each call carries:

- the charge label, such as `force push`;
- the command as written;
- the exhibits: counts and states the court read from git on this machine (see "Exhibits" in the README), such as how many commits the upstream branch has that yours lacks and by how many distinct authors, or whether a path is tracked. Author addresses are counted locally and never sent; a path is named as the command names it, cut to 60 characters with control characters removed;
- your latest message and Claude's latest message, each cut to its last 600 characters;
- for the judge, also the prosecution's and the defense's speeches;
- on `/court appeal <context>`, the context you typed, in place of your latest message, for the three calls of the appeal.

Claude's own words are among this evidence, so the defendant can try to sway the court; an acquittal still only hands the decision back to your permission rules. The git commands run locally and fetch nothing; the court also reads the size and time of the tracked files under a delete target (`$.fs.stat`), never their content, and sends only the count of changed ones, and lists each directory a delete target passes through (`$.fs.list`) only to compare names with the target's spelling; no listed name is sent or kept. These calls go wherever Claude Code sends its own model requests, under your Claude Code account and settings. The mod makes no network calls of its own and sends no telemetry.

## What it keeps

In Claude Code's plugin store on this machine (`$.store`), one record per case: the case number, the charged command cut to 80 characters, the charge, the verdict, the time, and for an appeal the case it retried. The exhibits are not kept. At most the newest 200 cases are kept, plus the docket's layout version.

Nothing else is written. Sounds (the gavel and the spoken verdict) play locally.

## How to delete it

The docket is one file: `~/.claude/plugins/store/trial-run_<marketplace>-<hash>.json`, for example `trial-run_trial-run-mod-a11145457a04.json` when installed from this repository's marketplace. Delete that file to erase every case. The next trial starts a new docket at case #0001.
