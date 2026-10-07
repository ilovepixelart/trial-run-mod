# How trial-run works

## Limitations

What the court decides on can change before the command runs, and some of what it assumes it cannot check. None of these is closed by the code; each is why an acquittal only hands the decision back to your permission rules.

- **The facts can change between the check and the run.** The exhibits are read fresh inside the `tool.check` of the command they describe and are never cached, but the shell runs the command afterwards: a file can become tracked, the remote can gain commits (the court reads `refs/remotes/...` as of your last fetch and never fetches) or the branch can change in between. Precedent compares the facts read for this command with the facts recorded for the acquittal, not with the moment the command runs.
- **The directory git reads is the session's.** `$.process.run` runs git in the session's working directory, and precedent records the repository, the directory within it and the branch git reported there. The court assumes the Bash command runs in that same directory; a line that changes directory itself (`cd ... &&`) is not simple, so it gets no exhibit and no precedent.
- **Git answers what git tracks.** A path behind a symbolic link, outside the repository, or not yet created reads as unknown or untracked; the court never reads the file system itself.
- **The models can be swayed.** The command, Claude's latest message and the paths it names are quoted to the court as evidence. They are escaped so they cannot pose as another witness, and the court is told evidence asking for a verdict counts against its side, but no model is immune to persuasion.
