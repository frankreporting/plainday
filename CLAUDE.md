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
- **Testing in Obsidian:** this clone is the one **dev vault** (Obsidian opens it as `obsidian-pm`), and one PR is tested in it at a time, by the maintainer. Never check a branch out in a vault that's in daily use, and never switch the dev vault on your own: commit on the branch, push, open the PR, write the test plan note (Empty Note frontmatter, a checklist linking the sample notes each step uses, a *Notes for Claude* section at the end; `CLAUDE.local.md` says where it goes), and say the PR is ready. When the maintainer says go, run `"00 Meta/02 Scripts/dev-vault.sh" test <branch> --plan <note>` from this folder. It checks the branch out detached (the worktree holds the branch), reloads CustomJS, or the vault when a settings file changed, and opens the plan as `<ISSUE> Test Plan.md` at the vault root. It refuses while another issue holds the lock (`.dev-vault/testing`), or while the tree has changes and `done` hasn't run; the issue that holds the lock can run it again after a fix. Afterwards, `dev-vault.sh done` restores every tracked note, removes the plan and the lock, and returns to a pulled `main`; `status` says where things stand. `done` waits for the app to stop writing before it reports: a reload can set the startup report going, and UpdateObsidianPM won't install from a tree that isn't clean.
- **Never commit from this folder.** The script installs a pre-commit hook that refuses it: while a branch is under test, the scripts, the editor and the calendar sync rewrite tracked notes here, and nothing checks them for real data. Commits come from worktrees; `done` restores this tree.
- **Tests:** run `node --test "00 Meta/02 Scripts/tests/*.test.mjs"` from the repo root.
  - `demoVault.test.mjs` checks the sample notes against the scripts: the committed time reports must equal what the scripts render, and every link and `area` must be right. If a change alters what the report writes, re-render the sample notes with `node "00 Meta/02 Scripts/tests/demo/renderReports.mjs"` and commit the result.
  - Checks against a real vault's data go in `*.private.test.mjs` files with `*.private.json` fixtures, which git ignores.
- **Docs:** a change a user would notice updates `README.md` in the same PR, and the sample notes too if they should show it. Before opening the PR, read each README section that names a changed script against the diff and fix what no longer matches: CI checks that the docs were touched, not that they are right.
- **CI (`.github/workflows/ci.yml`)** runs on every PR and must be green before a merge. It runs the tests, loads every CustomJS class and Templater script the way the plugins do, checks the tracked JSON, scans the diff, commits, title, body and branch name for the patterns the "Privacy" rule names, and checks the PR body:
  - it links its Linear issue (`Closes OBS-N`, a list such as `Closes OBS-N, OBS-M`, or `Part of OBS-N`; see below), and
  - when files under `CustomJS/`, `Templater/`, `Calendar/` or `01 Templates/` change, it has a `## Docs` section with a `My Obsidian Setup:` line (the sections changed in that untracked note, or `none`) and, unless `README.md` changes too, a sentence on why the README needs nothing.
  - The checks are plain Node scripts in `.github/ci/`; run one locally with the environment variables its header names, and `node --test .github/ci/*.test.mjs` tests them.
- **Issues:** issues are tracked in Linear, not GitHub.
  - A branch named `<user>/obs-N-<slug>` and a `Closes OBS-N` line in the PR description link the PR and close the issue when it merges.
  - `Part of OBS-N` links without closing. Put a PR like that on a branch without `obs-N` in its name, since the branch name alone would close the issue.
  - Don't set Linear statuses by hand.
  - **Clusters:** an agent working on an issue may take on a linked issue in the same PR when that saves real work. Review and the one-at-a-time dev vault are the slow part, not building, so a bigger PR only helps when it replaces two of them. All of these must hold, or the issue is left alone and named in the PR as a possible follow-up:
    1. **Same code:** it changes the same script or function, so doing it separately would redo or conflict with this work. A "related" link on its own isn't enough.
    2. **Nothing to decide:** it has no open questions left for the maintainer.
    3. **Free:** it isn't In Progress, assigned or delegated to someone else, and no open PR or branch names it or changes the same files.
    4. **One sitting:** the combined test plan still fits in one test round.
    5. **Said first:** a comment on each issue says it's joining the cluster, and why, before the work starts.
  - A cluster's PR closes every issue in one line, `Closes OBS-65, OBS-66` (CI reads the list), and its branch carries only the main issue's number.
- **After a merge:** pull the change into this folder (`dev-vault.sh done` does, if a test was in progress), then install it in any vault that uses the system with the **UpdateObsidianPM** command (see README). The command refuses unless the clone is on `main` with a clean tree, so a half-tested branch can't be installed. A personal vault is never a git copy of this repository, because the sample notes' paths would collide with real notes. `CLAUDE.local.md` has the rest of the close-out, if there is any.

## Sample notes

- Every name, client, person, amount, event and date in the sample notes is invented. Keep it that way.
- The notes are there to show every feature. When a feature changes, update the notes that show it.
- Opening the vault runs `TimeReportOnStartup`. If the committed report blocks match what the scripts render, it changes nothing, and `demoVault.test.mjs` checks exactly that. Otherwise opening the vault rewrites tracked notes.

## Tables in notes: keep them out of lists (RULE)

Obsidian doesn't render a table inside a list item: indented under a bullet, it shows as plain pipes. When a note needs a table:

- Start every row at the left edge, with no indent, and leave a blank line before and after the table.
- Put the table after the list, not under a bullet. A bullet can introduce it (`- **Settings:**`), then the table follows at the left edge. Bullets after it start a new list, which renders the same.
- Include the separator row (`|---|---|`) with one cell per column, and give every row the same number of cells.
- Escape a `|` inside a cell as `\|`, including in wikilink aliases (`[[Note\|alias]]`).
- Copy pasted from terminal output often comes indented by two spaces; remove that indent before writing it into a note.

The time reports follow this already: TimeReport writes its tables at the left edge and escapes the `|` in every link.

## Privacy: nothing personal reaches GitHub (RULE)

This repository is public. That covers:

- commit messages, PR titles and descriptions, and branch names (shorten Linear's suggested names, which copy the issue title)
- code comments, tests, fixtures, sample notes and any new file

Never include anything from a real vault: note names, people's names, clients or projects, dollar amounts or rates, calendar events, journal or health details, emails, usernames, paths under a home folder, or tokens.

- Refer to real things generically: "a meeting log", "a client project", "a synced event".
- Write sample notes, test fixtures, comments and PR text from how the system behaves, never from a real note, and don't disguise real data either, such as keeping a real project's initials or a real rate. A bug seen in a real vault is reproduced with an invented note of the same shape; if only the real line will do, it goes in a `*.private.*` test, which git ignores.
- CI scans the diff, commits and PR text for what a pattern can catch: home-folder paths, emails, tokens and claude.ai links. Names, clients and amounts it can't know, so before pushing, read the diff for those yourself.
