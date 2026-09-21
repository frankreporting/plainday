# Obsidian PM

An [Obsidian](https://obsidian.md) vault set up for daily planning, projects and tasks, meeting logs, calendar events and time tracking with billing reports, built from Templater templates and CustomJS scripts.

This repository **is** a vault: the system in `00 Meta/`, plus made-up sample notes (a small freelance practice over a couple of weeks) so there's something to try the moment you open it. It's a working reference, not a plugin: it assumes the folder layout and conventions below, and the calendar fetcher is macOS-only.

## Try it

1. Clone or download this repository, and in Obsidian choose **Open folder as vault**.
2. **Settings → Community plugins:** turn on community plugins, then install and enable:
   - [Templater](https://github.com/SilentVoid13/Templater)
   - [CustomJS](https://github.com/saml-dev/obsidian-custom-js)
   - [Natural Language Dates](https://github.com/argenos/nldates-obsidian)
   Their settings for this vault are already in the repository.
3. **Settings → Templater:** turn on **Trigger Templater on new file creation**. Templater keeps that switch per device, so it isn't in the repository, and without it new notes don't get their templates.
4. **Settings → Core plugins:** make sure **Daily notes** and **Bases** are on.
5. **Settings → Files and links:** set **Default location for new notes** to **In the folder specified below**, and choose `10 Inbox`.
6. **Optional hotkeys** (Settings → Hotkeys, search "CustomJS"): *ToggleTimeEntry* `⌘T` (it replaces Obsidian's New tab shortcut), *Schedule* `⌘S`, *DueDate* `⇧⌘D`, *AddTaskNote* ``⌥⌘` ``, and *Daily notes: Open today's daily note*.
7. Open `Welcome.md`.

Optional: the **Kanban** view in `00 Meta/04 Bases/Projects.base` needs a Bases kanban view plugin, and the `writing` class and `[!metadata]` callouts are styled by `00 Meta/02 Scripts/Style Settings/callouts.css` once you copy it into `.obsidian/snippets/` and turn it on under Appearance → CSS snippets. [Task Status](https://github.com/ebullient/obsidian-task-status) shows the extra checkbox markers (`[<]`, `[>]`, `[-]`) as their own icons, and [Notebook Navigator](https://github.com/johansan/notebook-navigator) adds a calendar for the periodic notes (the scripts read its week, month and year patterns when it's installed).

The Obsidian command-line tool (`obsidian …`) can run the commands from a terminal; the scheduled calendar sync uses it.

Nothing here backs your vault up. Use Obsidian Sync's version history, Time Machine, or a backup tool of your choice.

## Folder structure

The sample notes use this layout. Area and project names are yours to choose; only the top-level folders and `36 Planner` are fixed.

```
00 Meta/                           the system
  01 Templates/                    Templater templates
  02 Scripts/                      CustomJS, Templater user scripts, Calendar, tests
  04 Bases/                        Bases views
10 Inbox/                          new notes that haven't been filed
Projects/
  Projects.md                      list of active projects (Bases)
  Freelance/                       an area: folder + folder note tagged #area
    Freelance.md
    Kestrel Outfitters 2026/       a project: folder + folder note tagged #project
      Kestrel Outfitters 2026.md
      Draft homepage wireframes.md a task note (#task)
      logs/                        meeting logs for the project
        2026-09-14 Homepage review with Imogen.md
      Kestrel Fall Catalog/        a sub-project: a project folder inside a project
    Pinecrest Library Brochure/
  Household/                       an area with only task notes
  Personal/
    Garden Club Newsletter/
30 Reference/
  31 Notes/                        general notes
  33 Subjects/                     maps of content (§)
  34 Entities/                     organizations (@)
  35 People/                       people (@)
  36 Planner/
    days/  weeks/  months/  years/ periodic notes (YYYY-MM-DD, 2026w38, 2026-09, 2026)
  37 Journal/
  Sources/                         source notes (¶)
90 Archive/                        finished projects, moved here whole; excluded from search and reports
Welcome.md                         start here
```

- Every note inside an area or project carries an `area` property linking to the nearest folder note above it. It's kept current automatically when notes or folders move.
- Aliases mark note types in the Quick Switcher: `⭕.Area.Project`, `🗃️.Area`, `@Person`, `§ Subject`, `¶ Source`.
- Most notes have `id` (a `YYYYMMDDHHmmssSS` timestamp) and `tags` in their frontmatter; daily and monthly notes only have an alias.

## Creating notes: the title picks the template

New notes run `Get Template.md`, which picks a template from the title you type:

| Title | Template | Result |
| --- | --- | --- |
| `2026-09-15` | Daily Note | Moved to `36 Planner/days`, alias `9/15/26 Tuesday` |
| `2026w38` | Weekly Note | Moved to `36 Planner/weeks`, alias `Week of 9/13/26` |
| `2026-09` | Monthly Note | Moved to `36 Planner/months`, alias `September 2026` |
| `2026` | Yearly Note | Moved to `36 Planner/years` |
| `2026-09-15 Kickoff call` or `!today Kickoff call` | Log | Meeting log: asks for the project or area and files it in that folder's `logs/` (Esc: Inbox); fills `area`, `date`, `time`, `endTime` (from the calendar event line that links to it), `who` |
| `!task Draft the proposal` | Task | Task note filed in the chosen project or area (dates are dropped from the title) |
| `!project Launch plan` | Project | New project folder and folder note under the chosen area or project; dates become `start`/`due` |
| `!area Finance` or `🗃️.Finance` | Area | New area folder and folder note |
| `!person Jane Doe` / `!entity Acme` | Person / Entity | Contact note in `35 People` / `34 Entities` |
| anything else | Empty Note | `id` and `tags` frontmatter |

Other templates, inserted with Templater:

| Template | Purpose |
| --- | --- |
| Subject | Prompts for a subject and creates its note in `33 Subjects` |
| Writing Mode | Toggles a `writing` CSS class on the note (hotkey) |
| Metadata Callout | Inserts a `[!metadata]` callout |
| Formula | Inserts a table formula comment |
| Custom PDF | Frontmatter for PDF export (Enhancing Export) |
| Autonote - Empty Note | Empty note for notes created by other tools; moved to the Inbox |

Templater user scripts (`00 Meta/02 Scripts/Templater/`): `pickParent` (area/project picker), `showNewNote` (redraws properties and places the cursor after a template moves a note), `eventTimes` (start and end time from a calendar event line).

## Daily notes

A daily note is one checklist, events first, then tasks; anything else goes under `## Notes`.

```markdown
- [<] 9:00am	Team standup
	- 9:30am
- [<] 1:30pm	[[2026-09-15 Kickoff call|Kickoff call]] [[Kestrel Outfitters 2026|⭕]]
	- 1:30pm - 2:15pm
- [<] 3:00pm	Delivery window ℹ️
	- 5:00pm
- [ ] Draft the proposal [[Draft the proposal|🔗]] [[2026-09-18|🚩 9/18]]
	- 9:40am - 11:05am: outline
	- 3:00pm - 3:30pm: 🆓 fixing my own mistake
- [>] Send the invoice [[Send the invoice|🔗]]
```

- **Markers:** `[<]` event (never checked off), `[ ]` open, `[/]` started, `[x]` done, `[>]` forwarded to another day, `[-]` canceled.
- **Events:** start time, a tab, the title; the line under it is the end time. A title that links to a meeting log is how logs get their times.
- **Free events:** ℹ️ after the title, before any ⭕ link, marks an event the calendar shows as *free* (Apple Calendar's *Show As*): it isn't your time, so the time report never counts it and never checks it for overlaps. Any other event that has ended, with its end time still under it, is checked: work logged during it is an overlap under Problems. Time entries typed under an event replace its span, and count as always.
- **Time entries:** `- 9:40am - 11:05am` under a task or event, optionally `: note`. Billable unless the note starts with 🆓. `- 3:00pm - ` is a running clock.
- **Links at the end of a line:** `🔗` the task's own note (it threads a task across days), `⭕` its project, `🚩 M/D` its due date.
- **Which project an entry counts toward:** a `⭕` project link on the line or a parent line, else the project folder or `area` of a linked note (🔗 or a meeting log), else Unassigned.

## Commands (CustomJS)

Run from the command palette ("CustomJS: …"), a hotkey, or `obsidian command id=customjs:invoke-<Name>`.

| Command | Suggested hotkey | What it does |
| --- | --- | --- |
| Schedule | `⌘S` | Moves the task (and its sub-bullets) to another day's checklist; a task already worked on stays behind as `[>]`, linked on both days to its task note, which is created first (asking for its project or area) if it doesn't exist |
| DueDate | `⇧⌘D` | Appends a `🚩 M/D` due-date link |
| AddTaskNote | ``⌥⌘` `` | Links the selected task name to its task note, creating the note through the Task template (asking for its project or area) if it doesn't exist, then puts the cursor after the checkbox. The name is the selection or, with nothing selected and text after the cursor, the task's text up to its first link (the 🔗 link then ends the line). A date in the name becomes the note's `due` and is removed from the line. The line's ⭕ project links decide where the note goes: one project files a new note, or moves an existing note that has no project, there without asking; several bring up the menu with the line's projects first. An existing note's `area` is set from its folder, and the Task template writes `area` on new notes. Once the note sits in one of the line's projects, or you picked from several, the ⭕ links are removed. An existing note in a different project keeps the ⭕ link, and TimeReport lists that conflict on both projects. With only whitespace after the cursor, inserts an empty link to type into. On an event line, links a meeting log for the selection or the title after the event's time |
| Plan | | Opens the next 2–5 daily notes side by side |
| ConvertToProject | | Turns the selection into a new project folder and note |
| CalendarSync | | Fetches this Mac's calendars and writes events into daily notes, keeping lines it wrote current (through ⭕ project links, log links and time entries added to them); marks canceled events `[-]` and free events ℹ️; maps recurring series to projects from the Calendar Sync note |
| CalendarSyncRange | | Picks how far ahead to sync, then syncs |
| TimeReport | | Writes time summaries into project notes and weekly, monthly and yearly notes; lists a task whose ⭕ project and 🔗 task note's project disagree on both project notes. Project links it writes read `[[Project\|⭕ Project]]` |
| ToggleTimeEntry | `⌘T` | In today's daily note, starts a time entry under the task or event you're on (above its sub-tasks; an open task becomes `[/]`), or fills in its running one's end time; anywhere else, picks a running timer from any daily note or an open item from today's |
| UpdateObsidianPM | | Installs this repository's system files into the vault it runs in, from a local clone: it pulls the clone, shows what would be added, updated and removed, and writes nothing until you say so. Never touches notes, and refuses unless the clone is on `main` with nothing uncommitted |
| RefoldDailyNotes / SnapshotDailyNotes | | Keep daily notes folded around outside edits (the calendar sync calls them) |

Startup scripts (run when Obsidian starts):

| Script | What it does |
| --- | --- |
| SyncArea | Updates `area` when notes or folders move |
| RefoldOnOpen | Folds a daily note's items as it opens (folded by default) |
| TimeReportOnStartup | Refreshes the time reports (desktop only) once the vault is indexed. While CustomJS is still reloading its scripts, it waits a few seconds for them, and otherwise skips with a console warning |

## Scripts outside Obsidian

| Script | What it does |
| --- | --- |
| `02 Scripts/Calendar/fetchCalendar.swift` | Reads macOS calendars (EventKit) into `calendar-events.json`, each event with its status and its free/busy availability; *CalendarSync* runs it |
| `02 Scripts/Calendar/sync-calendar.sh` | Sync from a terminal or a schedule: asks Obsidian (opening it in the background if needed), and falls back to fetching the events file. `on`/`off`/`status` manage the launchd schedule |
| `02 Scripts/dev-vault.sh` | For working on the system: tests one pull request at a time in the clone, opened in Obsidian as its own vault. `test <branch> [--plan <note>]` checks the branch out detached, reloads, and opens the test plan; `done` restores every tracked note, waits for the app to stop writing, and returns to a pulled `main`; `status`. It installs a pre-commit hook that refuses commits from the clone. Not installed by Update Obsidian PM |

## Tests

From the vault root, with Node 20 or later:

```
node --test "00 Meta/02 Scripts/tests/*.test.mjs"
```

Scripts are loaded the way CustomJS and Templater load them, and the parts that don't need a running Obsidian are tested with made-up data. `demoVault.test.mjs` also checks the sample notes: every link and `area` resolves, and the time reports in them are exactly what the scripts render (so opening the vault doesn't rewrite them). After a change to the reports, `node "00 Meta/02 Scripts/tests/demo/renderReports.mjs"` re-renders them. Checks against your own vault's data can go in `*.private.*` files, which git ignores.

## Working on it

Changes go through pull requests from a git worktree outside the vault, and are tested one at a time in the clone itself, opened in Obsidian as a vault of its own and driven by `dev-vault.sh`. See `CLAUDE.md` for the workflow and the privacy rule: nothing from a real vault (note names, people, clients, amounts) in code, tests, sample notes, commits or PRs.

GitHub Actions (`.github/workflows/ci.yml`) checks every pull request: the tests above, that every script still loads, that the tracked settings parse, that nothing personal is in the diff or the PR text, and that the PR links its Linear issue and says what the docs need. The checks are Node scripts in `.github/ci/`, each with its inputs described at the top.

### Using it for your own notes

Don't make your own vault a copy of this repository: it carries the sample notes, and their paths (daily notes, weekly notes, `Projects/`) would collide with yours.

Instead, clone this repository somewhere outside your vault, and install the system with the **Update Obsidian PM** command:

1. Copy `00 Meta/02 Scripts/CustomJS/updateObsidianPM.js` from the clone into your vault's `00 Meta/02 Scripts/CustomJS/` (once, by hand), and add `UpdateObsidianPM` to the CustomJS plugin's invocable scripts.
2. Run **CustomJS: UpdateObsidianPM** from the command palette. It asks where your clone is the first time.
3. It pulls the clone, then lists what would be added, updated and removed. Nothing is written until you confirm. The clone has to be on `main` with nothing uncommitted: it's also where a branch is tested, and only what a pull request merged installs. That's checked again when you click Update, so a dialog left open while the clone moved (a test started, a pull ran in a terminal, a worktree was deleted) installs nothing and says so.

What it installs: everything the repository has under `00 Meta/`, plus `README.md`, `CLAUDE.md` and the three settings files the scripts depend on (`daily-notes.json`, and Templater's and CustomJS's `data.json`). What it never touches: your notes, your own files inside `00 Meta/` (the repository doesn't know about them), your other Obsidian settings, the demo's own test files, and the script that tests a branch in the clone.

A file you've edited yourself is never overwritten silently: it's listed separately, and left alone unless you ask. A file the repository has dropped is offered for removal and goes to the vault's trash. Two files record what happened, and neither is in the repository: `00 Meta/02 Scripts/update-source` (where your clone is) and `update-manifest.json` (what was installed, which is how your edits are told apart from an old version). If an update stops partway (a file that can't be written, a removal the trash refuses, a file that changed under the dialog), the manifest still records what landed and names where it stopped, so the next run picks up from there instead of calling the copied files your own edits.

Run it again whenever you want the latest.
