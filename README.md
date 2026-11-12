# Obsidian PM

An [Obsidian](https://obsidian.md) vault set up for daily planning, projects and tasks, log notes, calendar events, and time tracking with reports, timesheets and invoices, built from Templater templates and the scripts in Plainday, the plugin this repository builds.

This repository **is** a vault: the system in `Config/`, plus made-up sample notes (a small freelance practice over a couple of weeks) so there's something to try the moment you open it. It's a working reference: it assumes the folder layout and conventions below, and the calendar fetcher is macOS-only.

This README covers trying it and installing it. **[The manual](<Config/Manual.md>)** (`Config/Manual.md`) is the full description: how daily notes are written, what every command and script does to them, and how the time report and calendar sync decide what they do.

## Try it

1. Clone or download this repository into a folder named `Plainday Demo`, for example `git clone https://github.com/frankreporting/plainday.git "Plainday Demo"`, and in Obsidian choose **Open folder as vault**. Obsidian names a vault after its folder.
2. **Settings → Community plugins:** turn on community plugins, then install and enable:
	- [Templater](https://github.com/SilentVoid13/Templater), whose settings for this vault are already in the repository
	- [Natural Language Dates (Revived)](https://github.com/Amato21/nldates-revived)
	- [BRAT](https://github.com/TfTHacker/obsidian42-brat), which installs Plainday until the community directory lists it
3. **Install Plainday:** run **BRAT: Plugins: Add a beta plugin for testing (with or without version)** from the command palette, enter `frankreporting/plainday`, choose *Latest version*, leave *Enable after installing the plugin* on, and click *Add plugin*. BRAT installs the latest release into `.obsidian/plugins/plainday/` and keeps it up to date.
4. **Settings → Templater:** turn on **Trigger Templater on new file creation**. Templater keeps that switch per device, so it isn't in the repository, and without it new notes don't get their templates.
5. **Settings → Core plugins:** make sure **Daily notes** and **Bases** are on.
6. **Settings → Files and links:** set **Default location for new notes** to **In the folder specified below**, and choose `Inbox`.
7. **Optional hotkeys** (Settings → Hotkeys, search "Plainday"): *Toggle time entry* `⌘T` (it replaces Obsidian's New tab shortcut), *Schedule* `⌘S`, *Due date* `⇧⌘D`, *Jump to date* `⌘J`, *Add project link* `⌥⌘P`, *Move to project* `⌥⌘M`, and *Daily notes: Open today's daily note*.
8. Open `Welcome.md`.

Optional: the `writing` class and `[!metadata]` callouts are styled by `Config/Scripts/Style Settings/callouts.css` once you copy it into `.obsidian/snippets/` and turn it on under Appearance → CSS snippets. Invoices print laid out by `Config/Scripts/Style Settings/pm-invoice.css`, and `pm-timesheet.css` beside it shades each day of a timesheet as a band; copy and turn them on the same way. [Task Status](https://github.com/ebullient/obsidian-task-status) shows the extra checkbox markers (`[<]`, `[>]`, `[-]`) as their own icons, and [Notebook Navigator](https://github.com/johansan/notebook-navigator) adds a calendar for the periodic notes (the scripts read its week, month and year patterns when it's installed) and shows new project and area folders with a red circle or a green archive. With [Selectable Tables](https://github.com/frankreporting/selectable-tables), the reports', timesheets' and invoices' tables can keep their header and first column in view as they scroll: set it in `Config/Table Settings.md` (see the manual's *Freezing tables*).

The Obsidian command-line tool (`obsidian …`) can run the commands from a terminal; the scheduled calendar sync uses it.

Nothing here backs your vault up. Use Obsidian Sync's version history, Time Machine, or a backup tool of your choice.

## Folder structure

The sample notes use this layout. Area and project names are yours to choose; only the top-level folders and `Planner` are fixed.

```
Archive/                           finished projects, moved here whole; excluded from search, kept in reports
Config/                            the system
  Bases/                           Bases views (and the Invoices base, in a vault with no invoice folder)
  Scripts/                         CustomJS, Templater user scripts, Calendar, tests
  Templates/                       Templater templates
Inbox/                             new notes that haven't been filed
Projects/
  Projects.base                    the projects, active and inactive, opened as a file (Bases)
  Freelance/                       an area: folder + folder note tagged #area
    Freelance.md
    Kestrel Outfitters 2026/       a project: folder + folder note tagged #project
      Kestrel Outfitters 2026.md
      Kestrel Outfitters 2026 timesheet.md   every entry, with its invoice (the time report writes it)
      Draft homepage wireframes.md a task note (#task)
      ›logs/                       log notes for the project
        2026-09-14 Homepage review with Imogen.md
      Kestrel Fall Catalog/        a sub-project: a project folder inside a project
    Pinecrest Library Brochure/
  Household/                       an area with only task notes, and time of its own
  Personal/
    Garden Club Newsletter/
    Block Party Poster/
Reference/
  Entities/                        organizations
  Invoices/                        every invoice, with Invoices.base as the folder's note (Invoice Settings' `folder`)
    1001-KES.md
  Notes/                           general notes
  People/                          people
  Planner/
    days/  weeks/  months/  years/ periodic notes (YYYY-MM-DD, 2026w38, 2026-09, 2026)
Welcome.md                         start here
plugin/                            Plainday, the plugin built from Config/Scripts/CustomJS (build, host, command list, tests)
manifest.json, package.json        Plainday's manifest, and its build (npm run build)
versions.json                      each release's oldest Obsidian (npm version)
eslint.config.mjs                  Obsidian's lint, and its baseline in eslint-suppressions.json (npm run lint)
```

Every note inside an area or project has a `parent` property linking the folder note above it, kept current when notes move; aliases mark note types in the Quick Switcher (`⭕.Area.Project`, `🗃️.Area`). The manual's *Folder structure*, *Naming conventions* and *Areas, projects and task notes* have the rest.

## Creating notes: the title picks the template

New notes run `Get Template.md`, which picks a template from the title you type:

| Title | Template | Result |
| --- | --- | --- |
| `2026-09-15` | Daily Note | Moved to `Planner/days`, alias `9/15/26 Tuesday` |
| `2026w38` | Weekly Note | Moved to `Planner/weeks`, alias `Week of 9/13/26` |
| `2026-09` | Monthly Note | Moved to `Planner/months`, alias `September 2026` |
| `2026` | Yearly Note | Moved to `Planner/years` |
| `2026-09-15 Kickoff call` or `!today Kickoff call` | Log | Log note: files it in the `›logs/` of the project or area its event line's one ⭕ or 🗃️ names, or else in `Inbox`, with no menu, to be filed later with *Add project link* or *Move to project*. Records the log in its daily note (the event line with that title links to it at the end, after its ⭕, `[[Project|⭕]] [[log|⋯]]`, else a `[<]` line with no time goes after the day's events; a missing daily note is created); fills `parent`, `date`, `time`, `endTime` (from that event line), `who` |
| `!task Draft the proposal` | Task | Task note in `Inbox`, to be filed later with *Move to project*; dates are dropped from the title |
| `!project Launch plan` | Project | New project folder and folder note at the top of `Projects/`, to be moved under an area with *Move to project*; dates become `start`/`due` |
| `!area Finance` or `🗃️.Finance` | Area | New area folder and folder note at the top of `Projects/` |
| `!person Jane Doe` / `!entity Acme` | Person / Entity | Contact note in `People` / `Entities` |
| anything else | Empty Note | `id` and `tags` frontmatter |

Other templates, inserted with Templater:

| Template | Purpose |
| --- | --- |
| Writing Mode | Toggles a `writing` CSS class on the note (hotkey) |
| Metadata Callout | Inserts a `[!metadata]` callout |
| Formula | Inserts a table formula comment |
| Custom PDF | Frontmatter for PDF export (Enhancing Export) |
| Autonote - Empty Note | Empty note for notes created by other tools; moved to the Inbox |

Templater user scripts (`Config/Scripts/Templater/`): `showNewNote` (redraws properties and places the cursor after a template moves a note), `eventTimes` (start and end time from a calendar event line), `recordEvent` (a new log's line in its daily note), `arrivedNote` (tells a note that arrived with its properties from a new, empty one).

## Daily notes

A daily note is one checklist, events first, then tasks; anything else goes under `## Notes`.

```markdown
- [<] 9:00am	Team standup
	- 9:30am
- [<] 1:30pm	Kickoff call [[Kestrel Outfitters 2026|⭕]] [[2026-09-15 Kickoff call|⋯]]
	- 1:30pm - 2:15pm
- [<] 3:00pm	Delivery window ℹ️
	- 5:00pm
- [<] 4:00pm	Vendor demo [[Kestrel Outfitters 2026|⭕]]
	- 4:30pm: 🆓 not billing this one
- [<] Printer call [[Pinecrest Library Brochure|⭕]] [[2026-09-15 Printer call|⋯]]
- [ ] Draft the proposal [[2026-09-18|🚩 9/18]] [[Kestrel Outfitters 2026|⭕]] [[Draft the proposal|⋯]]
	- 9:40am - 11:05am: outline
	- 3:00pm - 3:30pm: 🆓 fixing my own mistake
- [x] Redo the nav I broke 🆓 [[Kestrel Outfitters 2026|⭕]]
	- 5:00pm - 5:20pm
- [>] Send the invoice [[Pinecrest Library Brochure|⭕]] [[Send the invoice|⋯]]
- [ ] Pick the paper stock [[Pinecrest Library Brochure|⭕]] [[Write brochure copy#^p7d2qe|↗]] ^p7d2qe
```

`[<]` is an event (never checked off), `[ ]` open, `[/]` started, `[x]` done, `[>]` forwarded to another day, `[-]` canceled. An event is its start time, a tab and its title, with its end time on the line under it. Time entries (`- 9:40am - 11:05am`) go under a task or event, and 🆓 marks time you won't bill. Links at the end of a line say where the time counts: `⭕` a project or `🗃️` an area (an area's own time is a row of its own in the reports, never a total of its projects), then `⋯` the line's own note (a task's note, or an event's log note), filed in that project, and `↗` the note *Schedule* sent the line from, if any. The note link comes last but for the task's ID (`^k3x9m2`, which Schedule adds and links the task's lines by), and a `🚩 M/D` due date and the forward date (just the date, linked to the task's line on the day it went to) come first. A link in the text is part of the title, even a link to a project.

The manual's *Daily notes* section is the full spec, and the one agents follow: line types, events, time entries and billing, the time report, Schedule, log notes, the calendar sync and folding.

## Commands

Run from the command palette ("Plainday: Add note"), a hotkey, or the command line with the command's id, the name in lower case with hyphens: `obsidian command id=plainday:add-note` (*Sync calendars* is `plainday:sync-calendars`). Plainday is the plugin this repository builds from its scripts.

| Command | Suggested hotkey | What it does |
| --- | --- | --- |
| Schedule | `⌘S` | Moves a task to another day, or into a weekly, monthly or yearly note; on a nested task it moves the task above it. One already worked on stays behind as `[>]`, sharing the task's ID with the new line; a task sent out of a project or other note keeps the date it went to at the end of its line; a finished task reopens |
| Due date | `⇧⌘D` | Sets the `🚩 M/D` due date on every line of the task, replacing one already there, and its task note's `due` |
| Add note | | Links the task to its own note, creating it in the project or area the line names (or in `Inbox`), and puts its ⋯ on every line of the task; on an event line, links a log note |
| Add project link | `⌥⌘P` | On a line in a daily, weekly, monthly or yearly note, says which project (`⭕`) or area (`🗃️`) its task belongs to: every line of the task changes, its note moves with the task note or log it's a subtask of, and its line in a project note goes to the new `## To Do`. It asks before a note leaves a project or time moves, and refuses to move billed time |
| Move to project | `⌥⌘M` | Moves the note you're on (or Notebook Navigator's selection) into a project or area, and its tasks and subtasks follow: a log into its `›logs/`, a project with its whole folder. Picking the project a note is already in puts its lines right. Also *Move to project…* in the file menus |
| Toggle time entry | `⌘T` | Starts or stops a time entry under the task or event you're on; anywhere else, picks a running timer or one of today's items |
| Plan | | Opens the next 2–5 daily notes side by side |
| Convert to project | | Turns the selection into a new project folder and note |
| Sync calendars | | Fetches this Mac's calendars and writes events into daily notes, keeping the lines it wrote current |
| Time report | | Writes time summaries into project and area notes and weekly, monthly and yearly notes, and each project's timesheet note, and lists every Problem in the error log |
| View error logs | | Opens the error log: every Problem the time report and the calendar sync found, one line per kind per note |
| Invoice | | On a project note, makes a draft invoice from its unbilled time, through a date you pick (on a flat-fee project, records the day its fee was earned); on an invoice, rebuilds, checks, or marks it sent, paid or canceled |
| Update Obsidian PM | | Installs this repository's system files into your vault from a local clone (see below) |

The manual's *Commands* section says exactly what each one does.

Startup scripts (run when Obsidian starts):

| Script | What it does |
| --- | --- |
| SyncArea | Updates `parent` when notes or folders move |
| RefoldOnOpen | Folds a daily note's items as it opens (folded by default) |
| MoveToProjectMenu | Puts *Move to project…* in Notebook Navigator's and Obsidian's file menus |
| TrailingLinks | Draws the 🚩, forward date, ⭕, 🗃️, ⋯ and ↗ links that end a task or event line small, at the right of the line, and hides a task's ID until the cursor reaches it (Live Preview) |
| CheckOff | A tick on either line of a sent task (its `[>]` source line or its open line on a day) checks off both, where they are, and a click on a `[>]` box asks first: Mark done, Cancel it or Do nothing |
| TimeReportOnStartup | Refreshes the time reports (desktop only) once the vault is indexed. While the scripts are still loading, it waits a few seconds for them, and otherwise skips with a console warning |

## Scripts outside Obsidian

| Script | What it does |
| --- | --- |
| `Scripts/Calendar/fetchCalendar.swift` | Reads macOS calendars (EventKit) into `calendar-events.json`, each event with its status and its free/busy availability; *Sync calendars* runs it |
| `Scripts/Calendar/sync-calendar.sh` | Sync from a terminal or a schedule: asks Obsidian (opening it in the background if needed), and falls back to fetching the events file. `on`/`off`/`status` manage the launchd schedule |
| `Scripts/dev-vault.sh` | For working on the system: tests one pull request at a time in the clone, opened in Obsidian as its own vault. `test <branch> [--plan <note>]` checks the branch out detached, reloads, and opens the test plan; `done` restores every tracked note, waits for the app to stop writing, and returns to a pulled `main`; `status`. It installs a pre-commit hook that refuses commits from the clone. Not installed by Update Obsidian PM |

## Raycast

*Obsidian PM for Raycast*, a separate extension that isn't published yet, runs the same timers from Raycast without opening Obsidian. **Timer** shows the running timer in Raycast's root search (`⏱ 0:42 · Draft the proposal`) and stops it when selected; **Start Timer** lists today's open tasks and events. Starting a timer stops the running one, so only one runs. It edits today's daily note with its own copy of `timeReport.js`, the logic behind ⌘T, kept in step with this repository's `main`.

## Tests

From the vault root, with Node 20 or later:

```
node --test "Config/Scripts/tests/*.test.mjs"
```

For Plainday, `npm ci` once in a worktree (never in a folder Obsidian opens as a vault), then `npm run build` builds `main.js` and `npm test` tests the bundle: every class made by name, every command added with its id, the startup scripts in order, and no line that reaches for the CustomJS plugin, which ran the scripts before Plainday. `npm run lint` runs Obsidian's lint, the rules the community directory's scan runs: Plainday's own code passes clean, and the scripts' errors from before the lint are a baseline that only shrinks (`CLAUDE.md`, *Lint*).

The scripts are loaded in Node, each class file and Templater script on its own, and the parts that don't need a running Obsidian are tested with made-up data. `demoVault.test.mjs` also checks the sample notes: every link and `parent` resolves, and the time reports in them are exactly what the scripts render (so opening the vault doesn't rewrite them). After a change to the reports, `node "Config/Scripts/tests/demo/renderReports.mjs"` re-renders them. Checks against your own vault's data can go in `*.private.*` files, which git ignores.

## Working on it

Changes go through pull requests from a git worktree outside the vault, and are tested one at a time in the clone itself, opened in Obsidian as a vault of its own and driven by `dev-vault.sh`. See `CLAUDE.md` for the workflow and the privacy rule: nothing from a real vault (note names, people, clients, amounts) in code, tests, sample notes, commits or PRs.

GitHub Actions (`.github/workflows/ci.yml`) checks every pull request: the tests above, that Plainday builds, its bundle tests and Obsidian's lint pass, what merging would release, that every script still loads, that the tracked settings parse, that nothing personal is in the diff or the PR text, and that the PR links its Linear issue and says what the docs need. The checks are Node scripts in `.github/ci/`, each with its inputs described at the top. Merging a pull request that raises Plainday's version publishes a release (`.github/workflows/release.yml`); `CLAUDE.md` (*Releases*) says how to cut one.

### Using it for your own notes

Don't make your own vault a copy of this repository: it carries the sample notes, and their paths (daily notes, weekly notes, `Projects/`) would collide with yours.

Instead, install Plainday in your vault, clone this repository somewhere outside it, and install the rest of the system (the templates, bases and manual) with the **Update Obsidian PM** command:

1. Install Templater, Natural Language Dates (Revived) and BRAT, then Plainday through BRAT, as in *Try it* (steps 2 and 3).
2. Run **Plainday: Update Obsidian PM** from the command palette. It asks where your clone is the first time.
3. It pulls the clone, then lists what would be added, updated and removed. Nothing is written until you confirm. The clone has to be on `main` with nothing uncommitted: it's also where a branch is tested, and only what a pull request merged installs. That's checked again when you click Update, so a dialog left open while the clone moved (a test started, a pull ran in a terminal, a worktree was deleted) installs nothing and says so.

What it installs: everything the repository has under `Config/` (the manual included), plus `README.md`, `CLAUDE.md`, `Projects/Projects.base` and the two settings files the scripts depend on (`daily-notes.json` and Templater's `data.json`). The Invoices base goes beside your invoices, in the `folder` your Invoice Settings name, once you've set one (see the manual's *Where invoices live*). The demo's own `Invoice Settings.md` and invoices are never installed. What it never touches: your notes, your own files inside `Config/` (the repository doesn't know about them), your other Obsidian settings, the demo's own test files, and the script that tests a branch in the clone.

A file you've edited yourself is never overwritten silently: it's listed separately, and left alone unless you ask. A file the repository has dropped is offered for removal and goes to the vault's trash. Two files record what happened, and neither is in the repository: `Config/Scripts/update-source` (where your clone is) and `update-manifest.json` (what was installed, which is how your edits are told apart from an old version). If an update stops partway (a file that can't be written, a removal the trash refuses, a file that changed under the dialog), the manifest still records what landed and names where it stopped, so the next run picks up from there instead of calling the copied files your own edits.

Run it again whenever you want the latest. Some versions change how your notes are written and come with a one-time conversion to run after installing; the manual says when and how (for the line marks: *Links at the end of a line*, *The marks before*). Until it has run, the time report, invoices and the calendar sync write nothing and say why.

## License

[MIT](LICENSE). The sample notes are invented and covered by the same license.
