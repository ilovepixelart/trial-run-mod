# How trial-run works

The court only tightens your permission rules. A conviction denies the command. An acquittal, or a trial you skip, hands the decision to your own permission rules, as if the court had not sat. A command the charges in `hooks/risky.ts` do not recognise is not tried at all and falls through to those same rules. Every charged command goes to trial each time it runs; an earlier acquittal never decides a later one. The court is a best-effort layer on top of your rules, not a security boundary.

The court is also a reference mod: each section below names one concept of Claude Code's function hooks the court uses, why it uses it, and where to read it. The code is the source of truth; this page points at it and records the constraints the code cannot state.

## The hooks module

[`hooks/hooks.json`](../hooks/hooks.json) lists one module, [`hooks/register.tsx`](../hooks/register.tsx), whose `register(on, options)` is called once per load. Every hook is an `on(event, handler)` call inside it (with a matcher between the two where it narrows the event, such as `{ tool: 'Bash' }`), and every handler is middleware: it receives `($, e, next)` and decides whether, and with what, to call the link beneath. State that must outlive one call (the contempt memory, the turn's tally) lives in the closure of `register`, so a reload starts it fresh. The pure work (reading a command line, planning exhibits, the prompts, the docket's records, the art) lives in the other files of `hooks/` and takes no `$`, which is what lets most tests call it directly.

## tool.check: tightening, never loosening

The trial is a `tool.check` hook on the Bash tool. It calls `next(e)` before the trial starts, so the decision of the rules beneath (other plugins, the person's permission rules, Claude Code itself) is known, and then returns that decision or a stricter one: a conviction is `deny`, an acquittal returns the decision beneath unchanged, a mistrial is `ask` unless beneath already denied (`sentenceOf` in [`hooks/verdict.ts`](../hooks/verdict.ts)). The court never returns `allow` of its own, because an acquittal is a model's opinion; a person's deny rule always stands. A command no charge recognises returns `next(e)` at once, with no model call, which keeps ordinary commands free.

## .catch: failing closed

The `tool.check` hook is registered with `.catch`, whose handler calls `failedCheckOf`: when the trial itself throws, the court asks the rules beneath again and returns their deny if they deny, otherwise `COURT_FAILED`, an `ask`. It never reads the command again, since reading it may be what failed. The handler also closes a trial left in session as a mistrial, so the spinner stops deliberating. A trial records a ruling (the row's stamp, the turn's count, the conviction contempt remembers) only once the rules beneath have answered, so a check that fails there records none of it. Inside the trial each step that can fail on its own (the exhibits, the store, the sounds, the pane) catches its own error and degrades to less evidence or a missing docket entry, so only a fault in the court itself reaches `.catch`. `claude plugin validate` lists which gating hooks carry one.

## Render sites and Client modules

The court draws only through `ui.render` hooks, each on one site:

- `Pane`: the courtroom and the docket, two panes the court opens with `$.ui.open` by their own ids. They return their own tree, since the pane is the court's.
- `AbovePrompt`: the one-line band, which on a narrow terminal is where the trial is seen at all.
- `ToolResult` and `ToolGroup`: the stamp under a denied Bash call's row, keyed by the call's `tool_use_id` (as `e.requestId` at `ToolResult`). These wrap `await next(e)` and never replace it: the row is Claude Code's, and every row without a stamp is returned as `next(e)` drew it.
- `Spinner`: changes one prop, the word, to `Deliberating` while a trial is in session, and leaves Claude Code to animate it.

Elements come from `$.ui.resolve`, never from globals. The animations (the stamp's entrance, the gavel, the scales, the typed speeches, the deliberation bar) are `Client` modules in [`hooks/clients/`](../hooks/clients/), each a `ClientModule` that runs on the drawing's own frame clock, so the hook draws once and the motion costs no hook calls. A surface whose element table has no `Client` gets the art at rest.

## $.state: what the drawings read

The trial in session, whether the band is shown and the stamps of this session's denied calls are `$.state` atoms (`atom`, `read` and `update`), declared for the type checker in [`types/index.d.ts`](../types/index.d.ts) under `PluginState`. The trial writes them; the render hooks read them, and Claude Code redraws a site when an atom it read changes. They live in memory only: nothing in them is seeded from the store, so `/clear` has nothing to reload.

## $.store: the docket and its layout

The docket is the only thing kept: the `cases` key of `$.store`, beside a `layout` key holding `DOCKET_LAYOUT`. `isReadableLayout` reads a docket of this layout or an older one and refuses a newer one, which is then never read or overwritten. Every session on the machine shares the store and it has no atomic update, so each filing re-reads `cases` right before it writes ([`hooks/docket.ts`](../hooks/docket.ts)); stored records are read as untrusted and unknown fields are dropped. The docket is a record, not a condition of the ruling: a store that fails loses the entry and the verdict stands.

## $.model.complete: three calls per trial

The prosecution, the defense and the judge are each one `$.model.complete` call (`speakerOf`, with the requests built in [`hooks/trial.ts`](../hooks/trial.ts)): counsel at once, then the judge. Evidence is quoted inside tags with its angle brackets escaped, and only the judge's first two lines are read as the verdict; anything else is a mistrial. The whole trial races a 9 second deadline (`DEADLINE_MS`) on `$.clock`, below the hook's own ten second budget, so the court always rules before Claude Code gives up on the hook.

## $.process.run, $.fs.stat and $.fs.list: the exhibits

The exhibits are the only process the court runs: read-only git, by argv array, from the allowlist `planOf` in [`hooks/exhibits.ts`](../hooks/exhibits.ts), each with `GIT_HARDENING` before its subcommand and `GIT_ENV` as its environment, all bounded by `EXHIBIT_MS`. An argv array means no shell reads it, so no word of the command can become another command. `$.fs.stat` gives each delete target's real path and each tracked file's size and time, never content; `$.fs.list` gives a directory's names, to match a target's exact spelling. A git that fails or is late gives no exhibit, never a mistrial. [`tests/hostile/git.hostile.mjs`](../tests/hostile/git.hostile.mjs) runs the same argv against real hostile repositories, outside the kit, which runs no processes.

## userConfig: the settings

`strictness`, `sounds` and `charges` are declared as `userConfig` in [`.claude-plugin/plugin.json`](../.claude-plugin/plugin.json) and reach the module as the `options` of `register`, read by `settingsOf` in [`hooks/settings.ts`](../hooks/settings.ts), where a missing or mistyped value is the manifest's default. A change reloads the module, so settings are read once per load, never per call. Strictness picks the judge's doctrine sentence only: the decision a ruling maps to is fixed, so no setting can make an acquittal allow.

## tool.describe: telling Claude the court sits

A `tool.describe` hook on Bash appends `COURT_NOTICE` to what `next(e)` returned. Claude Code asks once per session and caches the answer, and the notice is added to the description beneath, so asking again never adds it twice. With every charge switched off it adds nothing.

## turn.complete: adjournment

A `turn.complete` hook adds the adjournment line (`adjournmentOf` in [`hooks/adjournment.ts`](../hooks/adjournment.ts)) under the text `next(e)` returned, keeping any line a hook beneath added. It skips a subagent's turn (`e.agentId` set), whose trials are counted in the main turn they ran in, and an interrupted one (`e.isAborted`).

## Tiers: where the court sits

Hooks run in a chain of tiers (`Tier` in the engine's types), outermost first: `prepend`, `user`, `append`, `builtin`, `core`. `prepend` and `append` hold the managed plugins an administrator lists; a plugin a person installs is in `user`. Because the court only tightens, its place decides who has the last word over its deny: in `user`, another plugin the person installs can sit outside it in the chain and change what it returned; listed by an organisation's managed settings in the `prepend` tier, it sits outside every plugin a person installs, and its deny stands over all of them. Nothing in the module changes with the tier.

## Testing

`claude plugin test .` runs `tests/*.test.ts` with the kit (`claude-code/testing`): `test`, `describe`, `expect`, `tier`, and `mock`, whose clock and store answer from memory. Each test seats the world beneath the court with its own hooks (`seatCourt` in [`tests/fixtures/court.ts`](../tests/fixtures/court.ts) answers `model.complete`, `session.messages` and the decision beneath; `memoryStore` in [`tests/fixtures/store.ts`](../tests/fixtures/store.ts) the store), then drives the real events: `$.tool.check` for a trial, `$.ui.mount` for a drawing on each surface. The kit runs no processes, so git is faked there and run for real in the hostile test. [`scripts/gates.mjs`](../scripts/gates.mjs) runs every gate in CI's order.

## claude plugin validate: the access report

`claude plugin validate --strict .` reads the manifest and the module's source as Claude Code will and reports every hook, every `$` call (with the function that makes it), every state atom read and written, which gating hooks carry `.catch`, and the five `Client` modules. The README's access list is that report; when a change adds a call, the report shows it before any session loads the module.

## Limitations

What the court decides on can change before the command runs, and some of what it assumes it cannot check. None of these is closed by the code; each is why an acquittal only hands the decision back to your permission rules.

- **The facts can change between the check and the run.** The exhibits are read fresh inside the `tool.check` of the command they describe and are never cached, but the shell runs the command afterwards: a file can become tracked, the remote can gain commits (the court reads `refs/remotes/...` as of your last fetch and never fetches) or the branch can change in between.
- **The directory git reads is the session's.** `$.process.run` runs git in the session's working directory. The court assumes the Bash command runs in that same directory; a line that changes directory itself (`cd ... &&`) is not simple, so it gets no exhibit.
- **A changed file is read by size and time, not content.** Whether a tracked file under a delete target changed is decided by comparing the size and modification time the index recorded (`git ls-files --debug`) with `$.fs.stat` of the file, to the millisecond. A file not strictly older than the index file itself is git's racily clean case and reads as unknown, as does a name git escapes and a file or index that will not stat. What remains: an edit that keeps the size and lands in the same millisecond as the file's index entry, before the index file was written, reads as unchanged. Under a target with more than 200 tracked files no file is compared. A tracked target whose changes were not counted is entered as tracked with "uncommitted changes under it were not checked", never as tracked alone. Git's own content comparison is not used because it runs a repository's filters.
- **History keeps only what HEAD holds as the index does.** A delete target is entered as kept by history only when every index entry under it is in HEAD with the same mode and object (`git ls-files --stage` against `git ls-tree -r HEAD`), none was added with `git add -N` (which records the empty file) and every change under it was counted. A gitlink (a submodule or an embedded repository) or a directory git lists whole (a nested repository or a linked worktree) is entered as a nested repository whose contents were not checked, with no file count: git never lists what is inside, and `rm` takes its uncommitted work and, for an embedded repository, its whole history. A branch with no commits is entered as one, and nothing in it as kept. History here means HEAD: content another branch or the object store still holds is not looked for.
- **Git answers what git tracks.** Git never follows a symbolic link, so a delete target whose path does not land where it is spelled (a link in any part of it) or does not resolve gets no facts. Git matches spellings, so on a case-insensitive file system `SRC` reads as an untracked, empty path while `rm` deletes `src`: each part of a target must appear with its exact spelling in its directory's listing (`$.fs.list`), since `$.fs.stat` keeps a case alias's own spelling. Git folds `lnk/..` by spelling where the kernel follows `lnk` first, so a target with a `..` part gets no facts. Git never lists its own store, so a target with a `.git` part, the working directory itself, or an absolute path at or above the repository's top level gets none either: those reads would be clean while the delete takes the history. A path outside the repository reads as unknown. The court reads only stats and directory names from the file system, never content.
- **Only what the line spells is charged, and only the charges.** A command assembled at run time is never seen: a flag from a variable (`rm $F src`), `eval "$CMD"`, `source <(curl ...)`, an alias or a function defined elsewhere, or a script file a shell is given by name (`bash x.sh`). Some literal forms are not read either: a command inside a process substitution (`cat <(rm -rf x)`), an abbreviated long option (`rm --rec`) and a git alias whose body comes from the environment (`--config-env`). A line over 64 Ki characters is not read at all, and a reading stops once it has done a fixed budget of work (`BUDGET` in `hooks/risky.ts`), as on a `find -exec` nested more than three finds deep; either line goes to trial as an unread script, which bounds the time the court spends on any line. git commands outside the charges pass untried, though some discard work: `git push --mirror`, `git push --delete` and `git push origin :main`, `git checkout -f`, `git branch -D` and `git stash clear`.
- **The models can be swayed.** The command, Claude's latest message and the paths it names are quoted to the court as evidence. They are escaped so they cannot pose as another witness, and the court is told evidence asking for a verdict counts against its side, but no model is immune to persuasion.
