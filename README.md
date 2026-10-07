# trial-run

**Risky commands stand trial before they run.**

Your AI tried to force-push to main. It got a trial. It lost.

![A force push goes on trial in Claude Code and is found guilty](assets/demo.gif)

A Claude Code mod that puts risky shell commands on trial before they run.

## All rise

When Claude reaches for `rm -rf`, a force push or a `DROP TABLE`, court is called into session in a pane beside the transcript:

1. **The jury deliberates.** A gavel bangs, the scales of justice go up with their pans bobbing, and the case is read into the record with its number and the defendant's prior convictions on the charge. A bar counts down the seconds to the court's deadline. You can **Object** (the command is denied on the spot) or **Skip the trial** (the case is filed as `- WAIVED` and goes to your usual rules): press ctrl+x tab to reach the pane, then `o` or `s`.
2. **The prosecution** explains, in two dramatic sentences at most, what the command could destroy, typed out as it is delivered.
3. **The defense** argues that the agent needs it, citing what you and Claude actually said. It has to argue for its client, however hopeless the case.
4. **ALL RISE.** The gavel comes down, the judge rules, and the verdict drops onto the pane in very large letters, still wet with ink. The frame turns the verdict's colour, and it is read out loud.
5. **Claude hears the verdict too.** A guilty command is refused with the judge's reason and a **sentence**: one safer way to do the same job, read out under the ruling. Claude tells you the court has ruled and offers you the sentence.

The court is strict but not unreasonable: `rm -rf node_modules` for a clean reinstall walks free, and "force push main, don't ask questions" does not.

## Install

Requires Claude Code 2.1.287 or later (mods). Developed and tested on 2.1.292. The court is designed for a dark Claude Code theme; on a light theme some text in the pane is hard to read.

```
/plugin marketplace add ilovepixelart/trial-run-mod
/plugin install trial-run@trial-run-mod
/reload-plugins
```

To stay on one release, add the marketplace at its tag instead: `/plugin marketplace add ilovepixelart/trial-run-mod#trial-run--v<version>` (release tags are listed on the repository's Releases page). To take a newer release later, run `claude plugin update trial-run@trial-run-mod` in your shell.

To try it from a clone without installing: `claude --plugin-dir /path/to/trial-run-mod`.

### Versioning

Versions follow [Semantic Versioning](https://semver.org); while trial-run is 0.y.z, any release may change behaviour. Each release is tagged `trial-run--v<version>` and described in [CHANGELOG.md](CHANGELOG.md). The saved docket carries a layout number, and a version that finds a newer layout leaves it untouched.

## What goes to trial

Only Bash calls whose command matches a charge in [`hooks/risky.ts`](hooks/risky.ts) (`RULES`, one table): recursive deletes, force pushes, hard resets, a forced `git clean`, SQL `DROP`/`TRUNCATE` through a SQL client, `kubectl delete` and `terraform destroy`. Wrappers (`sudo`, `env`, `xargs`), nested shells (`bash -c`, `eval`) and global flags before the subcommand (`terraform -chdir=infra destroy`, `kubectl -n prod delete`) are looked through. In a compound command (`ls src && rm -rf src`) the case is named after the part that is charged, spelled as written (quotes and `sudo` included), and the court still sees the whole command. Every other command passes untouched, with no model call.

`git rm -r` is not charged: what it removes is tracked, so git history has it back. `git clean -f` is: the untracked files it deletes are in no history at all.

## How a verdict becomes a decision

The court can only tighten your rules, never loosen them.

| Ruling | Decision |
| --- | --- |
| Guilty | `deny`, with the judge's reason |
| Not guilty | whatever your rules decided without the court (allow, ask or deny) |
| Mistrial: no ruling within 9 seconds, a model error, a reply the court cannot read, or the mod failing | `ask` (or `deny` where your rules already deny) |
| Waived: you pressed Skip | whatever your rules decided without the court, and the docket says you waived it |
| Contempt: the same command the court convicted earlier this session | `deny` at once, with no trial and no model call |

The judge must answer exactly `VERDICT: GUILTY|NOT GUILTY` then `REASON: ...`; anything else is a mistrial. The decision is returned the moment the judge rules; the reveal in the pane never holds the command up, so a command the court acquits may already be running while the court is still speaking.

A mistrial's `ask` goes to Claude Code's permission prompt like any other. In auto mode that prompt is answered by auto mode, not by you: the court cannot tell which mode is on, so a mistrial there is only as strict as auto mode.

`/court` reopens the pane with the last trial.

## Sentencing

A conviction comes with one safer alternative, from a table per charge in [`hooks/sentence.ts`](hooks/sentence.ts), spelled for the command that was tried:

| Charge | Sentence |
| --- | --- |
| force push | `git push --force-with-lease`, which refuses to overwrite commits you have not fetched |
| terraform destroy | the same command as `plan -destroy` first |
| recursive delete | `git rm -r <path>` if the path is tracked (git history keeps it), otherwise move it aside; for `find -delete`, the same find without `-delete` |
| hard reset | `git stash` first |
| git clean | the same command with `-n` in place of `-f` |
| kubectl delete | the same command with `--dry-run=client` first |
| dropped or truncated data | a backup first (`pg_dump -t <table>`, `mysqldump <database> <table>`) |

A charge with no entry gets no sentence; the court does not invent one.

## Contempt of court

Retry a convicted command in the same session and the court does not sit again: the retry is denied at once as `✕ CONTEMPT`, citing the case that convicted it, with no model call. Same means the same simple command once whitespace and the order of short flags are set aside (`rm -rf src` and `rm -fr src` are the same; `rm -rf dist` is not). Contempt is on the docket as a conviction. A new session starts with a clean slate.

## On a narrow terminal

Claude Code only draws a pane a plugin opens on its own from 144 columns (110 once you have opened the court yourself). Narrower, the trial runs without its pane: the line above the prompt says `Court in session: force push · type /court to watch`, and then the verdict. Type `/court` and the pane opens at any width.

## The docket

`/court docket` opens the court's record: how many cases it has heard, the conviction rate, the six latest cases with their verdicts, a strip of the last thirty verdicts (`✕` guilty or contempt, `·` acquitted, `?` mistrial), and Claude's rap sheet, the charges it has been convicted of most. Most wanted is usually force push. Considered armed and helpful.

The docket keeps the latest 200 cases (the command, cut to 80 characters, its charge, the verdict and when). A mistrial is on the record but is no ruling, so it does not count toward the conviction rate; contempt counts as a conviction.

## Easy on the eyes

Every verdict is a glyph and a word as well as a colour (`✕ GUILTY`, `✓ NOT GUILTY`, `? MISTRIAL`, `- WAIVED`, `✕ CONTEMPT`), in a palette chosen to stay apart for colour-blind readers. Body text takes no colour, so it follows your terminal's foreground. Nothing flashes. The art keeps to box-drawing and block characters every common monospace font has, fits panes from 36 columns up (a narrower pane gets smaller letters, the narrowest none, with the verdict still in its headline), and the tests hold all of that to account.

## This is not a security boundary

It is theatre on top of your permission rules. Matching is by spelling and best effort: a command built at run time (a variable, a script file) is never charged. An acquittal is a model's opinion, which is exactly why it can only hand the call back to your rules. Keep your real deny rules.

## Cost and access

- **Cost:** three Haiku calls per trial (prosecution and defense at once, then the judge). Ordinary commands and contempt cost nothing.
- **What it reads:** your latest message and Claude's latest message (`$.session.messages`), quoted to the court as evidence.
- **What it keeps:** the docket, in the mod's own store (`$.store`), as above. Nothing else is written.
- **Sound:** the gavel (`sounds/gavel.wav`) and the spoken verdict play through `afplay` and `say` on macOS; elsewhere the court is silent.
- **Everything it calls,** as `claude plugin validate .` reports: `$.audio.play`, `$.audio.speak`, `$.clock.after`, `$.clock.sleep`, `$.command.register`, `$.model.complete`, `$.session.messages`, `$.state`, `$.store`, `$.ui.open`, `$.ui.resolve`. The animations run in two surface modules (`hooks/clients/`) on the drawing's own frame clock.

No file system, process or network access. [PRIVACY.md](PRIVACY.md) lists exactly what is sent to the model and what is kept, and how to delete it.

## Development

```sh
claude plugin validate --strict .
claude plugin test .
npx -p typescript tsc -p .
```

`tsc` needs the type declarations Claude Code writes into `.claude-plugin/types/` when it loads the plugin (any `claude --plugin-dir .` run does it). The gavel is synthesized: `python3 scripts/make_gavel.py sounds/gavel.wav` regenerates it. The demo is recorded with [vhs](https://github.com/charmbracelet/vhs) from a scratch repository.

## License

MIT
