# Claude Code — Obsidian PM

This repository is a working Obsidian vault: the system behind it (`00 Meta/`: templates, CustomJS and Templater scripts, tests, bases) plus made-up sample notes that demo it. See `README.md` for what everything does.

Personal instructions (where a maintainer's own vault is, how it pulls updates, backups) belong in `CLAUDE.local.md`, which git ignores. Read it if it exists.

## Obsidian CLI

The `obsidian` CLI talks to the running Obsidian app. With more than one vault open, **always name the vault, before the command**: `obsidian vault=<folder name> open path="Welcome.md"`. Put after the command, `vault=` is silently ignored and the command goes to whichever vault Obsidian picks.

- `obsidian vault=<v> open path="<vault-relative-path>"` opens a file.
- `obsidian vault=<v> search query="<text>"` searches the vault.
- `obsidian vault=<v> command id=customjs:invoke-<Name>` runs a command.
- `obsidian vault=<v> plugin:reload id=customjs` reloads the scripts after a change.

For reading notes, `grep` on the markdown files is often faster.

## Working on the system

- **PR flow:** make each change on a branch in a git worktree **outside** this folder, for example `git worktree add ../obsidian-pm-<slug> -b <branch> origin/main`. Run the tests, push, and open a PR. Merge only when the maintainer says so. Afterwards, delete the branch and the worktree.
- **Testing in Obsidian:** open the PR's worktree as its own vault (*Open folder as vault*), never check a branch out in a vault that's in daily use. A worktree already has the sample notes to try things on.
- **Tests:** run `node --test "00 Meta/02 Scripts/tests/*.test.mjs"` from the repo root.
  - `demoVault.test.mjs` checks the sample notes against the scripts: the committed time reports must equal what the scripts render, and every link and `area` must be right. If a change alters what the report writes, re-render the sample notes with `node "00 Meta/02 Scripts/tests/demo/renderReports.mjs"` and commit the result.
  - Checks against a real vault's data go in `*.private.test.mjs` files with `*.private.json` fixtures, which git ignores.
- **Docs:** a change a user would notice updates `README.md` in the same PR, and the sample notes too if they should show it.
- **Issues:** issues are tracked in Linear, not GitHub.
  - A branch named `<user>/obs-N-<slug>` and a `Closes OBS-N` line in the PR description link the PR and close the issue when it merges.
  - `Part of OBS-N` links without closing. Put a PR like that on a branch without `obs-N` in its name, since the branch name alone would close the issue.
  - Don't set Linear statuses by hand.
- **After a merge:** pull the change into this folder, then install it in any vault that uses the system with the **UpdateObsidianPM** command (see README). A personal vault is never a git copy of this repository, because the sample notes' paths would collide with real notes. `CLAUDE.local.md` has the rest of the close-out, if there is any.

## Sample notes

- Every name, client, person, amount, event and date in the sample notes is invented. Keep it that way.
- The notes are there to show every feature. When a feature changes, update the notes that show it.
- Opening the vault runs `TimeReportOnStartup`. If the committed report blocks match what the scripts render, it changes nothing, and `demoVault.test.mjs` checks exactly that. Otherwise opening the vault rewrites tracked notes.

## Privacy: nothing personal reaches GitHub (RULE)

This repository is public. That covers:

- commit messages, PR titles and descriptions, and branch names (shorten Linear's suggested names, which copy the issue title)
- code comments, tests, fixtures, sample notes and any new file

Never include anything from a real vault: note names, people's names, clients or projects, dollar amounts or rates, calendar events, journal or health details, emails, usernames, paths under a home folder, or tokens.

- Refer to real things generically: "a meeting log", "a client project", "a synced event".
- Use only invented data in tests and sample notes, and don't make it up by lightly disguising real data, such as keeping a real project's initials or a real rate.
- Before pushing, search the diff for real names and amounts.
