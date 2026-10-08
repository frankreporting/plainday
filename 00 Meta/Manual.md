---
id: 2026092316300000
tags: 
---
# Obsidian PM manual

How the system works: the folders, the notes, the lines in a daily note, and what each command and script does to them. `README.md` covers installing it; this is the reference for using it, and the spec that anyone (or any agent) editing the vault should follow.

**If this manual and the scripts ever disagree, the scripts win**, and this manual should be fixed to match. The scripts are in `00 Meta/02 Scripts/`, with tests in `00 Meta/02 Scripts/tests/`.

Examples come from the demo vault, a made-up freelancer's notes from late August to mid-September 2026. Every person, client and amount in them is invented.

## About

The system borrows from PARA and from atomic note-taking. For projects and tasks it takes the keyboard-first speed of Things 3, the markdown scheduling of NotePlan, and two principles from Marcus Olsson's [Projects plugin](https://github.com/marcusolsson/obsidian-projects):

- **Leave no trace:** if you move to another system, everything you need is still in your notes, with nothing to clean up.
- **Keep it native:** use Obsidian's own features wherever possible.

Every task is a markdown checklist line you can reach from the keyboard, and each day gets its own daily note rather than an automatic Today view: tasks don't pile up in one place, and catching up is something you schedule rather than something every morning forces on you.

The folder layout follows the Johnny Decimal idea, with every configuration file in one `00 Meta` folder.

## Folder structure

```
00 Meta/                         the system: templates, scripts, bases, this manual
  01 Templates/
  02 Scripts/                    CustomJS, Templater, Calendar, tests
  04 Bases/                      Bases views (and the Invoices base, in a vault with no invoice folder)
  Invoice Settings.md            your details for invoices, and where they go (see Invoices)
10 Inbox/                        new notes that haven't been filed
Projects/
  Projects.base                  the active projects, opened as a file
  Freelance/                     an area: folder + folder note tagged #area
    Freelance.md
    Kestrel Outfitters 2026/     a project: folder + folder note tagged #project
      Kestrel Outfitters 2026.md
      Kestrel Outfitters 2026 timesheet.md   every entry, with its invoice (the time report writes it)
      Draft homepage wireframes.md   a task note (#task)
      logs/                      the project's meeting logs
      Kestrel Fall Catalog/      a sub-project: a project folder inside a project
  Household/                     an area with only task notes
30 Reference/
  31 Notes/
  33 Subjects/
  34 Entities/
  35 People/
  36 Planner/
    days/ weeks/ months/ years/  the periodic notes
  Invoices/                      every invoice, with Invoices.base as the folder's note (see Invoices)
  Sources/
90 Archive/                      finished projects, moved here whole
```

Area and project names are yours; the top-level folders and `36 Planner` are what the scripts expect.

## Naming conventions

| Type | Symbol | Alias | Where | Typed with (US Mac keyboard) |
| --- | --- | --- | --- | --- |
| Source note | ¶ | `¶ Source Note` (in the filename) | `30 Reference/Sources` | `⌥7` |
| Person or entity | @ | `@Imogen Fenwick`, `@Kestrel Outfitters` | `35 People`, `34 Entities` | `⇧2` |
| Subject | § | `§ Pricing` | `33 Subjects` | `⌥6` |
| Project | ⭕ | `⭕.Freelance.Kestrel Outfitters 2026` | a folder inside an area or project | dot notation |
| Area | 🗃️ | `🗃️.Freelance` | a folder inside `Projects` | dot notation |

- Special note types get an alias that starts with their symbol. The Quick Switcher then groups them, and typing the symbol filters to that type.
- Source notes are the exception: the symbol is in the filename itself.
- The symbols are all on the iOS emoji and symbol keyboards, so they're easy to type on a phone too.

## Note properties

- Every note has at least `id` and `tags`. The `id` is a 16-digit timestamp in [Moment.js format](https://momentjs.com/docs/#/displaying/format/) `YYYYMMDDHHmmssSS`.
- Daily and monthly notes are the exception: their frontmatter is only an alias (see *The periodic notes*).
- Notes are made by Templater, and `00 Meta/01 Templates/Get Template.md` picks the template from the title you type. A note made any other way (a script, the CLI) needs its frontmatter written the same way by hand.

## Subjects, people and entities

- A **subject** is any topic, broad or narrow, with enough notes around it to deserve a hub: what's often called a map of content. Subjects are the top of the reference hierarchy and live in `33 Subjects`, tagged `subject`. `§ Pricing` in the demo is one.
- **People** (`35 People`) and **entities** (`34 Entities`: companies, organizations) both take an `@` alias. A person's `affiliation` links their entity, and a project's `client` links the entity it bills.

## Areas, projects and task notes

- **🗃️ Areas** are folders inside `Projects`, each with a folder note of the same name tagged `#area` (`Projects/Freelance/Freelance.md`). They group projects, and can hold notes that belong to the area but to no one project, and time logged to the area itself (see *The time report*).
- **⭕ Projects** are folders inside an area, or inside another project (a sub-project), each with a folder note tagged `#project`. They hold every note and task note for that project.
- A project note's properties come from the Project template: `id`, `aliases`, `icon`, `color`, `tags`, `area`, `start`, `due`, `who`, `client`, `rate`, `rate_type`, `include_subprojects` and `billed_through`. `client`, `rate` and `rate_type` start empty, to be filled in rather than assumed. Two optional properties cap the work: `max_hours`, or `contract_max` (an amount, divided by the rate).
- **For invoices** (see *Invoices*): `include_subprojects` (a checkbox, off by default) puts the sub-projects' time on the project's timesheet and invoices; `billed_through` (a date) says the project's time up to it was billed outside Obsidian. Three optional ones print on its invoices when set: `client_project_id` (as *Project ID*), `requested_by` and `terms`.
- **Task notes** are notes tagged `#task` that give a task room for notes and sub-tasks. The task's line in a daily note always links its task note (see *Links at the end of a line*).
- **`area`:** every note inside a project or area has an `area` property linking the nearest folder note above it. Moving notes or folders keeps it current (see *SyncArea*), except on an invoice, whose `area` is the project it bills. *MoveToProject* moves a note, a log or a whole project into another project or area.
- **Meeting logs** keep their details as properties: `area`, `date`, `time`, `endTime`, `who`, `topic`, `series`, and sometimes `absent`, `guest`, `project` or `related`.
- **Finished projects** move whole into `90 Archive`. Exclude `90 Archive` from search in Obsidian's settings, and old projects drop out of the Quick Switcher and the project lists. The time reports leave archived projects out too.

## Daily notes

This section is the spec for how daily notes are written, for you and for any agent editing the vault.

### The periodic notes

| | Daily note | Weekly note | Monthly note | Yearly note |
| --- | --- | --- | --- | --- |
| Filename | `YYYY-MM-DD` | `gggg[w]ww`, e.g. `2026w38` | `YYYY-MM` | `YYYY` |
| Folder | `30 Reference/36 Planner/days` | `…/weeks` | `…/months` | `…/years` |
| Frontmatter | `aliases: M/D/YY dddd` (`9/16/26 Wednesday`) | `aliases: Week of M/D/YY` | `aliases:` with one entry, e.g. `September 2026` | none |
| Holds | That day's events, then its tasks | Tasks for the week with no day yet; its time report | Tasks for the month with no day yet; its time report | Tasks for the year with no day yet; its time report |

- The folder patterns match Notebook Navigator's calendar (`[days]/YYYY-MM-DD`, `[weeks]/gggg[w]ww`, `[months]/YYYY-MM`, `[years]/YYYY`). Attachments stay at the `36 Planner` root. A note named like a periodic note anywhere else isn't one.
- A daily note has no headings above its list. It opens with one checklist: events first, then tasks. Anything that isn't a task goes under `## Notes` below it.
- A blank line ends the first checklist. A second group can follow under a plain label (`After lunch:`), but Schedule only ever writes into the first checklist.
- A weekly, monthly or yearly note keeps its tasks in a checklist above `## Time tracking`, the way the demo's `2026w38` and `2026-09` do. *Schedule* puts a task there for `next week`, `next month` or `next year`; schedule it from there to a day when its time comes.

### Line types

| Marker | Meaning |
| --- | --- |
| `- [<]` | **Event or meeting**: something on the calendar |
| `- [ ]` | Open task |
| `- [/]` | Started, not finished (keeps the `/` when scheduled) |
| `- [x]` | Done |
| `- [>]` | **Forwarded**: worked on here and continued on another day, or sent out of a non-daily note; also an event the calendar moved after you'd made notes on it |
| `- [-]` | Canceled; also an event canceled or deleted in the calendar |

- `[<]` always means an event, never a task. Events stay `[<]` after they happen; they're never checked off. (The Task Status plugin labels `<` "scheduling"; ignore the label.)
- `[>]` is always a task, with one exception: an event that moved to another day after you'd added notes under it (see *Calendar sync*).
- Other Task Status markers (`[?]` question, `[!]` important, `[I]` idea, `[i]` information, `[b]` bookmark, `["]` quote, `[*]` star…) are annotations with no scheduling meaning.

### Events

Format: `- [<]`, the start time, **one tab character**, the title. Times are lowercase with no space and no leading zero: `9:00am`, `1:30pm`. An all-day event has `All day` in place of the time, then the same tab. Typed by hand, a space after the time works too: *Add task note* and the Log template read it, and the log gets that start time. The tab is what the calendar sync writes and keeps current.

```markdown
- [<] All day	Farmers market
- [<] 9:00am	Weekly planning
	- 9:30am
- [<] 10:00am	Homepage review with Imogen [[Kestrel Outfitters 2026|⭕]] [[2026-09-14 Homepage review with Imogen|🗒️]]
	- 10:00am - 10:45am
- [<] 1:00pm	Call with Rafe Oakes [[Pinecrest Library Brochure|⭕]]
	- 1:30pm: 🆓 quick check-in, not billing it
- [<] 2:00pm	Delivery window for the new monitor ℹ️
	- 4:00pm
- [<] Printer call [[Pinecrest Library Brochure|⭕]] [[2026-09-18 Printer call|🗒️]]
```

- **Order:** events sit at the top of the checklist. All-day events come first, then timed events in time order. The calendar sync inserts events in that order; Schedule never moves events.
- **A meeting with notes** gets a log, linked at the end of its line the way a task links its note: `[[2026-09-14 Homepage review with Imogen|🗒️]]`, a meeting log named with the date and the title, after the ⭕ for the project it's filed in. The title stays plain text. *AddTaskNote* on an event line adds the link, with the daily note's date, and makes the log.
- **Older lines** wrap the title in the log link instead (`[[2026-09-14 Homepage review with Imogen|Homepage review with Imogen]]`). Every script still reads them, and the calendar sync writes one the new way whenever it updates the line.
- **The Log template writes that link itself.** A new log links the event line whose title matches it (exactly, or else the one line its title is the start of), with a 🗒️ at the end, and the line's ⭕ set to the project the log is filed in. A meeting with no event line gets `- [<] Title [[Project|⭕]] [[log|🗒️]]` with no time, after the timed events and above the tasks (the printer call above); a missing daily note is created first. When the calendar later brings that event, the sync adopts the timeless line and gives it, and the log, their times.
- **The line under an event** is its end time (`- 9:30am`), and that's the event's time: once the event has ended, the report counts it from start to end, on the project the line resolves to (a ⭕ link, or the meeting log's project), else *Unassigned*.
- **Ranges under an event** are its time instead (`- 10:00am - 10:45am`), and the end line is then ignored. An interrupted meeting has two ranges. A range with a label (`- 10:30am - 12:00pm: prep`) is related work.
- **The end line can take a note** after a colon, like a time entry: `- 1:30pm: 🆓 quick check-in, not billing it`. The sync keeps the note when the end time changes. When the event moves to another day, the note stays on the forwarded line; a 🆓 on the event line itself travels with the event, like a ⭕.
- **Multi-day events** appear only on their first day.
- **ℹ️ after the title** (before any ⭕ link) marks an event the calendar shows as *free* (Show As in Apple Calendar, Free in Google): not your time. The sync writes and maintains it. The time report never counts a free event and never checks it for overlaps.
- **Didn't go?** Mark the event `[-]` by hand: the report ignores anything but `[<]`, and the sync keeps the line current whatever its marker.
- A busy `[<]` event with no end line under it is listed under Problems once it has started ("has no end time under it, so it isn't counted"). One that ends when it starts counts for nothing, quietly. A timed event that ends on another day gets no end line from the sync, unless it only runs past midnight.

### Tasks and time tracking

```markdown
- [x] Draft homepage wireframes [[2026-09-18|🚩 9/18]] [[Kestrel Outfitters 2026|⭕]] [[Draft homepage wireframes|🗒️]]
	- 9:15am - 11:15am: mobile layout
	- 11:15am - 11:45am: 🆓 redid the nav after misreading my own notes
- [x] Plan the catalog shoot [[Kestrel Fall Catalog|⭕]]
	- 1:00pm - 1:50pm: call sheet
	- [x] Shot list for catalog [[Kestrel Fall Catalog|⭕]] [[Shot list for catalog|🗒️]]
		- 2:00pm - 3:05pm
- [x] Redo the hero crop I got wrong 🆓 [[Kestrel Outfitters 2026|⭕]]
	- 10:00am - 10:40am
- [ ] Homepage build: category pages [[Kestrel Outfitters 2026|⭕]]
```

- Tasks come after the events, in the order they were added. Schedule adds new arrivals at the end of the first checklist.
- **Time entries** are sub-bullets under a task: a range like `- 9:15am - 11:15am`, optionally followed by `: what you did`. An open range (`- 1:50pm - `) is a running clock.
- **A time entry under a task marks it "worked on."** That changes what Schedule does with it (see *What Schedule does to a line*).
- A sub-task's entries are its own. Its project is the first ⭕ or 🗃️ on it or on a line it's nested under, and only then its 🗒️ note's, so a parent's ⭕ counts ahead of a sub-task's note: the shot list above counts toward its own ⭕, Kestrel Fall Catalog, which is also where its note is filed, and without that ⭕ it would count toward its parent's.
- Lines nested under a time entry (`- Invoiced under 9/30`) are notes about it, not entries. A single time (`- 9:30am`) is an event's end time, not an entry. An end earlier than a pm start runs past midnight: `- 10:30pm - 1:15am`.
- Ranges under events count the same as ranges under tasks.
- **An ended event counts, and is checked for overlaps.** With the sync's end line under it and no ranges of its own, its start-to-end span is an entry: its hours count (Unassigned when nothing on the line names a project, so busy personal events add to Total and never to Billable), and work logged during a busy meeting shows under Problems. Free (ℹ️), all-day, `[-]` and `[>]` events never count and never overlap anything, and an event that hasn't ended yet counts for nothing.
- *ToggleTimeEntry* (`⌘T`) types the times for you.

**Billable or 🆓.** Time counts as **billable** only when it's someone's to bill: the entry belongs to a project, that project isn't `non-billable`, and there's no 🆓 on it. Everything else goes in the **🆓** column. Billable is what you could invoice; Total is still every hour worked.

- 🆓 right after the colon, before any note, doesn't bill that entry: `- 11:15am - 11:45am: 🆓` or `- 5:30pm - 6:10pm: 🆓 fixing my own mistake`.
- 🆓 on the task or event line itself, as a word of its own anywhere on the line, makes every entry under it 🆓 (a task worked on all day that you won't bill). On an entry, or after an end line's colon, it applies to that one.
- 🆓 on both a line and an entry under it still counts as 🆓, and is listed under Problems, so a stray mark is never decided silently. A 🆓 that isn't a word of its own (`Task🆓`) counts for nothing and is listed too.
- On a billable project, 🆓 is the only thing that frees an hour, so the 🆓 column on a client's row is exactly what you comped them.
- Time with **no project** (errands, exercise, admin) is never billable. It shows as *Unassigned*, and Problems still counts it, so a forgotten project link is visible.
- A project with time on it and **no `rate_type` at all** counts as billable and says so under Problems: billing too much is a mistake you'll notice, invoicing nothing quietly isn't. The demo's Block Party Poster shows this.

### The time report

The **TimeReport** command writes summaries of the time logged in daily notes. On the desktop it runs by itself when Obsidian starts (*TimeReportOnStartup*); to see fresh numbers after logging time, reload Obsidian or run **CustomJS: TimeReport**. A phone doesn't run it at startup: it gets the updated notes through Sync, so two devices never rewrite the same blocks (the command still works there). It writes to these notes, the one you're on included: an open note is updated through its editor, which keeps its folds.

| Note | What it shows |
| --- | --- |
| Each project or area note with entries | Under `## Time tracking`: a first line linking its timesheet note (*View Timesheet*) beside when it was updated, then the summary (Entries, Billable, 🆓, Total, Exact, Max Hrs, Rate, Earned). With no sub-project time that's one row; otherwise a Project column with a row for the project's own time, one per sub-project, and a **Total** row that carries the project's Max Hrs. Then a week-by-week table of the time logged to the project directly (total first, then each week newest first, each week linking its weekly note), its **Invoices** (see *Invoices*), and Problems |
| Each project or area's timesheet note | Every entry, in two tables: **Billable time** and **🆓 time**, then Problems when an invoice's entries changed (see *Timesheets*). The note sits beside the project's note, named after it (`Kestrel Outfitters 2026 timesheet`); on the desktop, it's made when the project first has time |
| Each weekly and monthly note for a period with entries | Under `## Time tracking`, each table under its own H3: **Totals**, the period's summary by project with an **All** row. A monthly note adds **By Week**: hours by week, a column per Sunday–Saturday week that overlaps the month, each header linking its weekly note (a straddling week counts only that month's days). A weekly note adds **By Day**: a row per project, a column per day (`Sun 9/13` … `Sat 9/19`, each linking its daily note). Then the period's **Problems**. On the desktop, missing weekly and monthly notes are created first; a phone only refreshes notes that exist |
| Each yearly note | Under `## Time tracking`: an **Earned** table and an **Hours** table (billable + 🆓), each with a row per project (non-billable ones and Unassigned too), a column per month linking its monthly note, the year's total and an **All** row; then Problems |

Weeks run Sunday to Saturday, the same weeks Notebook Navigator names `2026w38`. The demo's `2026w38`, `2026-09` and `2026` notes show each kind.

- **The block:** each report sits between `%% time:start %%` and `%% time:end %%`. A run replaces only that block, and only when the numbers changed; the *Updated* line says when they last did. Text outside the block (an `## Invoices` section, say) and folds stay. `## Time tracking` stays at the end of the note, with a blank line above it, and is added back if it goes missing; so tasks can go at the top of weekly, monthly and yearly notes, but nothing goes below the report.
- **At startup** it waits until Obsidian has finished indexing the vault, and writes nothing if it can't find any project notes.
- **No prose:** the reports hold an *Updated* line, the tables and Problems. Entry-by-entry detail is in each project's timesheet note.
- **Links** in the reports name the project, `[[Kestrel Outfitters 2026]]`, and mark an area with 🗃️: `[[Household|🗃️ Household]]`.
- **Columns:** Entries, Billable, 🆓, Total, Exact, **Max Hrs** (the project's `max_hours`, or `contract_max` ÷ its hourly rate), **Rate** (from `rate` and `rate_type`: `$95/hr`, `$1,200 flat`, `non-billable`…) and **Earned** (billable hours × an hourly rate, priced a day at a time, as an invoice bills them; at a whole-dollar rate, Earned and the invoices agree to the cent). A sub-project with no `rate` or `rate_type` of its own uses its parent's: the demo's Kestrel Fall Catalog bills at Kestrel Outfitters 2026's rate. `rate_type: non-billable` keeps a project's hours out of Billable as well as Earned.
- **Only past work counts:** an entry that hasn't ended yet (times filled in ahead under a synced event, say) is left out until it has.
- **Rows add up:** in the tables that list projects (weekly, monthly, yearly), each row counts only that project's own entries, so the rows add up to **All**; a parent project gets a row only when time was logged to it directly. A project's own note totals it with its sub-projects.
- **Which project an entry belongs to:** only the links that end a line count (see *Links at the end of a line*). First match wins, checking the task line and then each line it's nested under: (1) a `⭕` or `🗃️` link to a project or area note, e.g. `[[Kestrel Outfitters 2026|⭕]]`; (2) the nearest project or area folder, or the `area`, of the line's 🗒️ note (a task note, or an event's meeting log; an older event whose title is wrapped in its log link has that log). A link in the text is part of the title, even a link to a project. Anything else is *Unassigned*.
- **Areas:** time linked to an area (the demo's *Water the tomato beds* on 9/14, under Household) counts toward the area, as a row of its own in the weekly, monthly and yearly reports. It never adds up the projects inside it: an area holds projects and its own time, not a total. An area note gets its own report under `## Time tracking`, as a project note does. An area's time is 🆓 unless the area note sets a `rate` or `rate_type`, which then work as on a project; an area is never a sub-project, even when filed inside a project's folder, so it never takes a client's rate. Only notes tagged exactly `#area` count, as the project and area menus read them.
- **Archived projects** (in `90 Archive`) are left out of every report, and their notes aren't written. The demo's Marlowe Bakery Rebrand has entries on 8/27 and 8/28 that no report counts.
- **Sub-projects** (a project folder inside another project's folder) keep their own hours; only the parent's own note adds them to its total.
- **Rounding:** Billable, 🆓 and Total round each entry **up** to the next 15 minutes (2:01 → 2:15), so any work counts and 15 minutes is the minimum. Exact is unrounded. The step is `ROUND_TO` in `timeReport.js`.
- **Daily notes are only read.**

**Problems** lists what the report couldn't count cleanly: a task whose ⭕ project differs from the project its 🗒️ task note is filed under, or an event whose ⭕ differs from its log's project (listed on both project notes; a note moved by hand leaves its lines like that), running clocks, ends before starts, overlapping entries (on any day, even across midnight), list lines that look like time ranges but aren't `- h:mmam - h:mmpm` bullets, entries not under a task or event, 🆓 after other text on an entry or on both a line and an entry under it, busy events with no end line, entries or events of 12 hours or more, unclosed code blocks or comments, and entries with no project. Problems about a project itself (such as a `rate` that isn't a positive number, an hourly project with no `rate`, no `rate_type`, two projects each inside the other, a ⭕ and 🗒️ that disagree) are listed on the project's note, and on every weekly, monthly and yearly note whose period has time on that project or on a sub-project of it, so a period's report says why its hours count the way they do. There a ⭕ and 🗒️ disagreement is listed once, under the project the time counts on, with that period's entries. Quoted lines stop at 80 characters. Malformed and running entries are listed but not counted. Code blocks and `%%` / `<!-- -->` comments are skipped. The demo has one of each kind on purpose: the 9/16 note has a mistyped entry (`2:30 - 3:45pm`), and Block Party Poster, a volunteer project whose `rate_type` was never filled in, is listed on its own note and on `2026w38`, `2026-09` and `2026`.

A project's own note also lists what's wrong with its invoices (see *Invoices*), and so does its timesheet, but no weekly, monthly or yearly note: a billed entry changed since its invoice was made (`- [[1001-KES]] (paid 9/15): [[2026-09-11|9/11/26]] 1:00pm - 2:30pm was billed, now 1:00pm - 2:45pm`; a draft's line ends `; rebuild it`, since *Rebuild* fixes it), an entry on two invoices, an invoice whose Billed entries can't be read, and a `billed_through` that isn't a date. The demo's Kestrel Outfitters 2026 shows the first.

#### Timesheets

- **Where:** each project or area with time gets a timesheet note beside its note, tagged `timesheet`, with the project as its `area`. The time report writes it; don't type in it. It's a note of its own because a long table costs every keystroke typed in the note it's in, even off screen.
- **Which entries:** every entry of the project that has ended; with the project's `include_subprojects` on, its sub-projects' too, in a Project column.
- **Two tables:** **Billable time** holds what can be invoiced, and **🆓 time** everything that isn't billed. Each heading gives its total (`### Billable time: 20.50 hrs`). The table has a bold row per day, newest first, adding up the day's hours, then the day's entries in time order.
- **Columns:** Date, Time, Hours (rounded as billed), Task and Notes (the text after the entry's colon). It's about time, so there are no amounts; Earned is on the project's note.
- **In both tables,** an unnamed first column and a last one, **Invoice**, say where each entry stands (hourly projects only):
	- the first holds the status of the invoice that billed it: ✏️ draft, 🕒 sent, ✅ paid (📄 for a status of your own), or ⚠️ when the entry changed after it was billed;
	- Invoice holds that invoice's link, or, in Billable time, `through 9/2` when `billed_through` covers it;
	- both blank: not invoiced yet. The invoice note has its dates.
	- In 🆓 time, an entry on an invoice was billed before it was made 🆓, so it's ⚠️. Invoices don't show 🆓 time yet.
- **🆓 as written:** in 🆓 time, a 🆓 on the task line stays in Task and one on the entry stays at the start of Notes, so each row says why it isn't billed.
- **⚠️** also marks a billed entry moved or retimed since: the Invoice command holds it back.
- **Problems** close the timesheet when there's anything to say about its invoices, so every ⚠️ says why. The lines are the project note's (`- [[1001-KES]] (paid 9/15): [[2026-09-11|9/11/26]] 1:00pm - 2:30pm was billed, now 1:00pm - 2:45pm`), and billed time that's gone from its daily note is listed too.
	- An entry added on top of billed time whose own entry is still there gets a line of its own: `… 1:00pm - 2:30pm was billed, and 2:00pm - 3:00pm overlaps it`.
	- With nothing to say, there's no Problems heading. The demo's Kestrel Outfitters 2026 timesheet has one line.

### Links at the end of a line

In daily notes, links to other notes go at the **end** of the line, each with a symbol alias:

| Suffix | Points to | Added by |
| --- | --- | --- |
| `[[Task name\|🗒️]]` | The line's own note: a task's note, an event's meeting log, or the note a task came from (a meeting log, a task note) | *AddTaskNote*, *Schedule*, the Log template |
| `[[Project\|⭕]]` | The project the line's time counts toward, where its note is filed | *AddProjectLink*; *AddTaskNote*, *Schedule* and the Log template, for the note's project; *Schedule*, when the source is tagged `#project` |
| `[[Area\|🗃️]]` | The area the line's time counts toward, where its note is filed | The same, for an area; *Schedule*, when the source is tagged `#area` |
| `[[YYYY-MM-DD\|🚩 M/D]]` | The due date (that day's daily note) | *DueDate* |

```markdown
- [<] 10:00am	Homepage review with Imogen [[Kestrel Outfitters 2026|⭕]] [[2026-09-14 Homepage review with Imogen|🗒️]]
- [ ] Send final copy to Rafe [[Pinecrest Library Brochure|⭕]] [[Write brochure copy|🗒️]]
- [ ] Renew car registration [[2026-09-30|🚩 9/30]] [[Household|🗃️]] [[Renew car registration|🗒️]]
- [x] Reply to Rafe about proof dates [[Pinecrest Library Brochure|⭕]]
- [x] Water the tomato beds [[Household|🗃️]]
```

- **Older lines use 🔗** for the same link. Every script reads 🔗 and 🗒️ alike, with or without the invisible character (U+FE0F) a phone may add or drop, and writes 🗒️.
- **Only the links that end a line count.** A link in the text is part of the title, even a link to a project, and even with a ⭕: `Ask [[Kestrel Outfitters 2026]] about dates` counts toward no project. A block ID after the links (`^a1b2c3`, which *Copy link to block* adds) doesn't count as text, and the scripts keep it last. The links at the end are what *TrailingLinks* draws on the right, and what the time report reads.
- **A line keeps its project next to its note.** A line that links a note also links the project or area the note is filed in, so the line and its note agree, and the project shown on the right is a link you can open. Every command that writes a note link keeps them together:
	- *AddTaskNote* keeps the line's ⭕ where it files the note, sets it to the note's project when you leave the note where it is, and adds it to a line that had none. The Log template does the same for a meeting log.
	- *AddProjectLink* changes the line's ⭕ and moves its note along.
	- *MoveToProject* moves a note, and the ⭕ on every line that links it follows.
	- A note moved by hand (a drag, *Move file to another folder*) leaves its lines' ⭕ behind for now. Where a line and its note disagree, the line's ⭕ decides where the time counts, and the report lists the line under Problems.
- **The 🗒️ link threads one task across days:** every forwarded copy keeps the same 🗒️, so that note's backlinks show the task's whole history. In the demo, *Draft homepage wireframes* is worked on 9/14 and 9/15 through one task note.
- **Order:** the 🚩 due date, then the ⭕ or 🗃️, then the 🗒️, which ends the line so End reaches the note. On an event line it's the title, ℹ️, 🆓, any ⭕, then the log's 🗒️, as the calendar sync writes it. Lines written before (the 🗒️, then the ⭕) are still read, and the scripts write them the new way when they change them.

**How they look.** In Live Preview, the *TrailingLinks* startup script draws these links small, at the right of the line's last row, the way Things shows a deadline. Only the display changes; the line stays as it's written.

- **Which links:** only 🚩, 🗒️ (or an older 🔗), ⭕ and 🗃️ links at the end of a task or event line. A person, a link in the middle of the text, or an old event whose title is its log link stays where it is.
- **On screen:** the project or area first, then the note, then the due date at the edge.
	- A ⭕ or 🗃️ shows as the project's shortest name, its file name or a plain alias (never a `⭕.Area.Project` one), in faint text.
	- The due date is faint, and turns red once its day has passed.
	- A line with a 🗒️ but no ⭕ (one written before lines kept their project) shows the project its time counts toward in faint italics. That's a name the time report works out, not a link.
- **Wrapping:** when the links don't fit after the text, the text's last word wraps with them. The other rows keep their full width.
- **Keys and clicks:**
	- A click opens the link, and ⌘-click or a middle click opens it in a new tab.
	- End and ⌘→ go to the end of the line, after the note link.
	- → from the end of the text opens the first link for editing, and the line reads as its markdown until the cursor leaves the links.
- **Elsewhere:** source mode and reading view show the links as written.

### Links at the start of a line: only outside daily notes

A link to a daily, weekly, monthly or yearly note as the **first** thing after the checkbox is a breadcrumb meaning "this was sent to that day" (or week, month, year). It appears only on `[>]` lines in **non-daily notes**: meeting logs, task notes, project notes, anything else.

```markdown
- [>] [[2026-09-18|9/18]] Sign-off call on Friday
- [>] [[2026w41|Wk of 10/4]] Book the photographer
- [>] [[2026-09|Sep. 2026]] Collect member photos for the October issue
- [>] [[2027]] Plan the spring sale
```

- **A day's alias** is `M/D`, with no year and no leading zeros.
- **A week's** is `Wk of M/D`, the day the week starts. **A month's** is its short name and the year (`Oct. 2026`, `May 2026`), and **a year** is linked by its name alone.
- A weekly, monthly or yearly note whose name another note shares is linked by its path, so the link can't open the other note.
- Daily notes don't get prefix links, except on an event the calendar sync forwarded (see *Calendar sync*).
- In the demo, *Garden Club Newsletter* sent a task to September's note, `2026-09`.

### What Schedule does to a line

| Scheduling from… | The original line | The new line on the target day, week, month or year |
| --- | --- | --- |
| A daily note, task **not** worked on | Removed along with its sub-bullets (it moves) | Same line and sub-bullets |
| A daily note, task worked on (time entries) | Stays and becomes `[>]`; gets a 🗒️ link, after its note's ⭕, if it had none | `[ ]` (or `[/]`), same text, ⭕ and 🗒️ link, no sub-bullets |
| A weekly, monthly or yearly note | Removed along with its sub-bullets, even if worked on | Same line and sub-bullets |
| Any other note (log, task, project…) | Becomes `[>] [[YYYY-MM-DD\|M/D]] text`, or `[>] [[2026w41\|Wk of 10/4]] text` for a week (see *Links at the start of a line*) | `[ ] text [[Project\|⭕]] [[Source\|🗒️]]`, the ⭕ for the source's project; or `[[Source\|⭕]]` / `[[Source\|🗃️]]` if the source is a project or area |

- **A week, a month or a year** (`next week`, `next month`, `next year`, `w41`, `oct`, or a note's own name; see *Typing a date*) sends the line to that weekly, monthly or yearly note instead of a day. From there it's scheduled to a day when its time comes.
- Scheduled lines go to the end of the target's first checklist. A weekly, monthly or yearly note with no checklist gets one, just above `## Time tracking` (or at the end before there's a report): a line never goes inside the report. A note that doesn't exist yet is created from its template, a period's the way *JumpToDate* creates it, before anything moves: if it can't be made, the line stays where it was.
- **Time entries stay where they were logged.** A worked-on task's entries stay on the original line in its daily note, and count toward the time report on that day; the copy in the weekly, monthly or yearly note carries none. *ToggleTimeEntry* only times tasks in today's daily note, so schedule the task to a day before timing it.
- A line's 🚩 due date, ⭕ and 🗒️ go with it, to a period as to a day.
- Scheduling a line into the note it's already in changes nothing, and says "Already in this note".
- **Events can't be scheduled:** on a `[<]` line, Schedule changes nothing and shows "Events must be moved in your calendar app."
- A worked-on task with no task note gets one first, the way *AddTaskNote* makes it, so the time already logged isn't left Unassigned.

### Meeting logs

- Named `YYYY-MM-DD Title`, or `!today Title` for today. Made from an event, the title is cleaned for a file name the way CalNav does it: `Sync: Q3` becomes `2026-09-14 Sync - Q3`, and characters a file can't be named with are dropped. The event's own title stays as it is. A note with that title gets the Log template, with properties `area`, `series`, `topic`, `date`, `time`, `endTime` and `who`.
- **Filed by project:** the log goes into its project or area's `logs/` subfolder (made if missing), and `area` is filled. When its event line's `[[Project|⭕]]` or `[[Area|🗃️]]` links name one project or area, that's where it goes, with no menu, and the link stays: the line and its log say the same. Otherwise the template asks (the same picker as new tasks and projects), and the line's ⭕ becomes the one you pick. Esc leaves the log in `10 Inbox`, with no `area`, and the line as it was; Raycast's Open Log Note can preset Inbox and skip the picker. A log moved later gets its `area` updated on the move, and *MoveToProject* files it straight into the new project's `logs/`.
- **Every log has a line in its daily note.** Made from a calendar event (*AddTaskNote* on its line, which adds the `[[YYYY-MM-DD Title|🗒️]]` link and makes the log), the log takes `time` and `endTime` from the event line: its start, and the end time on the line under it, or the last time of the entry that replaced it. (`endTime` is text, like `time`; `end` would be a date property.) Typed as `YYYY-MM-DD Title` or `!today Title`, the template links the event line whose title matches, and takes its times the same way. With no such line it adds a `[<]` line with no time and leaves both properties empty until the calendar sync brings the event; the demo's `2026-09-18 Printer call` is one.
- A name a log already has opens that log instead.
- The event's link keeps working wherever the log is filed, because links go by note name.
- **Action items** are checklist items inside the log. Schedule them from there: the log keeps `[>] [[date|M/D]] …` and the daily note gets the task, with the log's ⭕ and a 🗒️ link back to the log.

### Getting around

- **Today's daily note:** Daily notes' *Open today's daily note*, on a hotkey of your choice.
- **Previous and next daily note:** Daily notes' commands, or Notebook Navigator's calendar.
- ***Plan*** ("CustomJS: Plan"): opens the next 2–5 days side by side, starting from the day you're on, or from today.
- ***JumpToDate*** ("CustomJS: JumpToDate"): type a date in words and open its daily note, or its weekly or monthly note for `next week` or `last month`.

### Calendar sync

Two parts, no AI. `00 Meta/02 Scripts/Calendar/fetchCalendar.swift` reads the Mac's calendars (every account, including iCloud and subscribed ones) into `calendar-events.json` beside it, and the *CalendarSync* command writes them into daily notes.

- **On the Mac**, the command runs the fetcher itself, so **CustomJS: CalendarSync does the whole job.** On a phone there's no EventKit, so it applies whatever the Mac last fetched and Sync carried over.
- **On a schedule:** `sync-calendar.sh` syncs from a terminal, or from launchd at 7:15am, 12:15pm, 5:15pm and 9:15pm (`sync-calendar.sh on` / `off` / `status`). It asks Obsidian to run *CalendarSync*, because only Obsidian has permission to read the calendars; a job launchd starts has none of its own. When Obsidian isn't running, it opens it in the background (`--no-launch` skips that); if that fails too, it falls back to fetching the events file, which Obsidian applies at its next sync. It names its own vault in every CLI call, so it can't reach another vault that's open. `status` says whether the schedule is on, how the last run exited and the last log line; the log is `~/Library/Logs/calendar-sync.log`.
- **What syncs is yours to choose.** `00 Meta/Calendar Sync.md` lists every calendar as a checkbox, grouped by account; tick the ones you want. New calendars appear unticked, a calendar missing from a fetch keeps its tick, and the note also carries the last run's report. The note isn't in the repository: it's made on the first run, from your own calendars.
- **How far ahead is yours too.** The note's `Sync range:` line takes 1, 2 or 3 weeks, or 1, 2, 3 or 6 months. *CalendarSyncRange* picks it from a list and then syncs; the plain command uses whatever the line says, so a scheduled run never waits on a prompt. Days beyond the range are left alone: shortening it hides nothing and deletes nothing.
- **Its record:** every line it writes is recorded in `calendar-sync.json`, keyed by the event's ID (plus the date, for one occurrence of a repeating event). Both JSON files sit in the Calendar folder rather than hidden, because Obsidian Sync skips dotfiles and the phone needs the events file. Don't edit them by hand.

**Lines it keeps current.** An event line it wrote, and you haven't touched, is its to keep current: when the event changes or moves in the calendar, the line changes or moves.

- **Three additions don't count as touching it:** `[[Project|⭕]]` links after the title, a link to its log at the end (`Planning call [[Kestrel Outfitters 2026|⭕]] [[2026-09-20 Planning call|🗒️]]`, before the ⭕ or around the title on older lines), and time entries under it (with notes nested under them), beside or in place of the end time. The sync keeps updating such a line and puts your additions back.
- **New time or title:** the line is updated and keeps its ⭕ links, log link and time entries. A rename changes only the title; the log keeps its name. A line whose title is wrapped in its log link is written with the 🗒️ at the end instead. Time entries are never changed, so when the time moves on a line that has them, the report adds "check its time entries".
- **Moved to another day:** the ⭕ links and log link go to the new day's line. Time entries stay on the day they were worked: a line with time entries is forwarded, and keeps its links too. A line with only links is removed once the new day's line has them; if it doesn't (that day already had a line for the event, say), the old line is forwarded instead.
- **Free events get ℹ️:** a timed event whose Show As is Free is written with ℹ️ after its title, and the mark follows the calendar (busy → free adds it, free → busy takes it off, reported as *now free* / *now busy*), keeping the ⭕ links, log link and time entries. Tentative and unknown (birthdays, subscribed calendars) count as busy; all-day events get no mark. The mark is the sync's: take it off or add it by hand and the line is yours. Days already past aren't touched, so mark an old event by hand.

**Lines you've made yours.** Add anything else (notes that aren't time entries, a second note link, a title wrapped in a link to anything but its log, a different title, a checked box) and the line is yours.

- If the event then moves to another day, the sync forwards your line (`- [>] [[2026-09-20|9/20]] 1:00pm⇥Planning call`, notes and all) to just below that day's other events, and writes a fresh event line on the new day with the line's ⭕ links. Schedule won't touch a forwarded event.
- If an event you've edited changes its time or title, your line stays and the report says so.

**Canceled, renamed, adopted.**

- **Canceled or deleted in the calendar, the line stays, marked `[-]`**, as a record of what was planned, with its links, time entries and notes, whether or not you'd touched it. The sync can't tell a deletion from a cancellation: an event gone from a day it fetched counts as canceled. The report lists it under *Canceled*. If the event comes back (restored, a fetch that missed it, or deleted and made again), `[-]` turns back into `[<]` and the line is kept current again. A `[-]` you typed yourself is never turned back, and a line you'd marked some other way (`[x]`) is left as it is. Schedule won't touch a canceled event. The demo's 9/14 haircut is one.
- **An event whose ID changes** (moved to another calendar, say) keeps its line: the "new" event takes it over rather than the old one canceling it, and the line gets the new event's end time if you haven't added anything but links and time entries.
- **A log's line with no time** is adopted when its event arrives: written in the sync's shape with its log link, ⭕ links kept, anything under it kept below the end line. Whenever the sync writes a line that links a log (adopted, retimed, moved), the log's `time` and `endTime` are set from the line, so a log always says when its meeting is (*log times updated*). An all-day event sets no times. Only a log gets times (a note tagged `log`, or in a `logs/` folder): a 🗒️ on an event line that points at another note leaves that note alone.

**A project for a recurring series.** The Calendar Sync note's `## Recurring events` section lists every repeating event in your ticked calendars, by the title of its next occurrence.

- Put a `[[Project|⭕]]` after a title, and every upcoming line of that series gets the link, except lines with time entries, a log link or a ⭕ of their own (time already logged keeps its project). The demo's *Kestrel standup* is the kind of series this is for.
- Each line gets the link once: take it off one line and it stays off. Change the series' project, and lines where the sync put the old link get the new one; a link you typed yourself stays. Remove the link from the list and lines keep what they have.
- The sync follows each series by its calendar ID, so a series whose title changes (a birthday with an age in it, a rename) has its line renamed and keeps its project, and every occurrence gets the link whatever its own title. Series with the same title share a line; if one is renamed, it gets a copy of the line.
- A "this and future events" edit gives the rest of the series a new ID. When the new part keeps the same days and times, the sync renames those lines (links and time entries kept) and copies the project line to the new title; if the time changes too, the old lines are marked `[-]` and new ones added.
- The section is yours to write in: the sync only adds titles of new series and removes plain titles of series that have gone. A line in any other shape (`[[Project]]` without the ⭕, say) is left alone but isn't read as a project.

**Safety.**

- A line with a blank line inside it (a time entry below a gap under the event) is treated as yours, so nothing under the gap is left behind under another event.
- Delete an event line the sync wrote, and it won't come back.
- Notes are changed through Obsidian, each read and written in a single step, so a run can't write over what you're typing, and a note that's already right isn't rewritten.
- Its first run only adds events and adopts the event lines already in your notes. After that, a run that would remove, forward or cancel more than 10 lines does none of it, and lists what it held back.
- Deleting `calendar-sync.json` is safe, but the sync then forgets which events you deleted, and the next run starts over as a first run.

### Folding

Obsidian saves folds separately on each device, and forgets a note's folds when something outside Obsidian changes it: the calendar sync, or Obsidian Sync bringing edits from another device. Three CustomJS scripts keep daily notes folded the way Schedule leaves them: your folds stay, and only what was added gets folded.

- Each device keeps a **snapshot** of the daily notes it has seen: each item with sub-bullets, where it was, and whether it was folded. Snapshots live in Obsidian's local storage on that device, beside its own fold records, so nothing is added to the vault. Snapshots of notes more than a month old are dropped.
- ***RefoldOnOpen*** (startup script, every device including a phone): a daily note whose items are all where the snapshot saw them opens as you left it. One that changed is matched against its snapshot by text: items you'd folded stay folded, items you'd opened stay open, and new items fold. An item that only moved, or whose text changed, counts as new. With no snapshot to go on, a note keeps the folds the device saved for it if they still fit; otherwise it folds everything, which is Schedule's fallback too. Folded is the default. It snapshots notes as you open and leave them, and your open notes as Obsidian quits (desktop only).
- ***SnapshotDailyNotes*** and ***RefoldDailyNotes*** (commands, no hotkey) cover notes that are open while something outside Obsidian writes to them. The calendar sync and the Raycast timer extension run the first before writing and the second after, through the CLI: `obsidian command id=customjs:invoke-SnapshotDailyNotes`, then `obsidian command id=customjs:invoke-RefoldDailyNotes`. *RefoldDailyNotes* applies an open note's folds again even when they look unchanged, since text added to the last line inside a fold would otherwise show beside the folded item. Run on its own, it keeps the folds you see and folds the events.

### Rules for agents

- Read this section before editing any daily, weekly, monthly or yearly note, and write lines exactly as the scripts would: the tab after an event's time, the symbol aliases, `M/D` link aliases.
- A line that links a note ends `[[Project|⭕]] [[Note|🗒️]]` (or `[[Area|🗃️]]`), with the ⭕ for the project the note is filed in and any `🚩 M/D` before both: keep the note link last and its project next to it. Only the links at the end say where time counts; a link in the text doesn't.
- Keep events at the top: `All day` events first, then timed events in time order. Add tasks after the last item of the first checklist.
- Don't check off, forward, move or restyle a `[<]` event. Events are moved in the calendar app, not in Obsidian. The calendar sync is the one exception: it moves and removes the event lines it wrote, forwards events and marks canceled ones `[-]`, as *Calendar sync* describes.
- Don't edit `calendar-sync.json` or `calendar-events.json` in `00 Meta/02 Scripts/Calendar/`; only the calendar sync writes them.
- Don't add or remove time entries: they're the time log, and they change how Schedule treats a task. (The calendar sync writing and removing the end lines of its own event lines is the exception.)
- Don't edit an invoice's Billed entries, or the body of one that's sent or paid; don't write in a timesheet note (the time report rewrites it). Change billing through the *Invoice* command.
- To move a task to another day, week, month or year, follow *What Schedule does to a line*. Don't invent other forms.
- Don't add `id` or `tags` to daily, weekly, monthly or yearly notes.
- When editing daily notes from outside Obsidian while it's open, run `obsidian command id=customjs:invoke-SnapshotDailyNotes` before and `obsidian command id=customjs:invoke-RefoldDailyNotes` after, so open notes keep their folds.
- Older daily notes may use an earlier layout (`## Meetings` and `## To Do` headings). Leave them as they are; don't convert them.

## Invoices

The **Invoice** command bills a project's time as an invoice note, and moves the invoice along from draft to paid. The note is the invoice: Obsidian's *Export to PDF* prints it laid out like an invoice, and without the system it's still readable as one.

### Making one

Run *Invoice* on a project note (anywhere else, it asks which project has time to bill).

1. **Bill through:** a date in words, starting at `today` (see *Typing a date*). A month and day without a year is the closer one, this year's or next year's, since you bill work behind you as often as a few days ahead: in October, `9/16` is last month's. The dates *Mark sent* and *Mark paid* ask for work the same way.
2. **What it would bill:** the project's ended, billable time on no invoice yet, through that date, for a project billed by the hour (a `rate`, with `rate_type` `hourly` or empty, its own or its parent's). With `include_subprojects` on, its sub-projects' time too.
3. **The confirmation** shows:
	- **Fix first?** the Problems in that time (running clocks first), and billed entries that changed since their invoice;
	- **Held back:** entries it won't bill, and why (below);
	- **Not billed by the hour:** sub-projects left out;
	- **To bill:** the dates, entries, hours and total, and a warning when it takes the project past its `max_hours` or `contract_max`.
   *Create draft* (or *Create anyway* when there's something to fix) writes it; Cancel doesn't.
4. **The draft** goes into the invoice folder (below), named with its number and the client's code: `1001-KES`. Its number is one past the highest ever given in the vault, so a number is never used twice, even after its note is deleted.

It needs your details first: the first run makes `00 Meta/Invoice Settings.md` to fill in (`name`, `address` a line per item, `terms`, `payment_note`, `folder`, `last_number`). That note is yours: *UpdateObsidianPM* never installs or changes it. The demo has its own, with invented details. The client is the note the project's `client` links to (else its parent's `client`): its `code` (asked for once, and saved there), `billing_name` (else the note's name) and `address`.

- **`last_number`:** the highest invoice number given so far, up to 999999. A new invoice takes one more than it, or than the highest invoice note's number if that's higher, and raises it to its own number once the note is made. A new settings note starts at `1000`, so the first invoice is `1001`; set it once to continue the numbers you used before. An older settings note without it, in a vault with no invoices yet, is opened for you to set it.
- **`folder`:** where every new invoice goes, like `Business/Invoices`. Left blank, each goes into its project's `invoices/` folder, and only a project's own folder note can be invoiced. It can't be inside `00 Meta` or `90 Archive`.

### Where invoices live

One folder for every invoice is the better choice: invoices are business records, and a project's folder moves when it's archived. The demo keeps its invoices, and the base, in `30 Reference/Invoices/`.

- **A base leaves out excluded files.** With `90 Archive` excluded (Settings → Files and links → Excluded files), an archived project's `invoices/` drop out of the *Invoices* base, and the record of what you've invoiced goes incomplete. So pick a `folder` that's never excluded and never archived, outside `Projects/`.
- **Billing doesn't care where an invoice is.** Invoices are found by their `invoice` tag anywhere in the vault, `90 Archive` included, and each knows its project from its `area` link. So nothing is billed twice, numbering continues, and *Mark paid* works wherever the note sits.
- **Moving your invoices into the folder** by hand, once `folder` is set, breaks nothing.
- **Name the folder `Invoices`,** without a number in front, like `30 Reference/Invoices`. Then the base, `Invoices.base`, has the folder's name, which is what makes a file a folder's note in Notebook Navigator (a base counts). Clicking the folder opens the base. The `Projects` folder and `Projects.base` work the same way.
- **The Invoices base** goes in the same folder (`Invoices.base`, beside the invoices), so it opens as a file: from the Quick Switcher or the file list, with its views, sorting and filters on the keyboard. *UpdateObsidianPM* puts it there, and moves it when `folder` changes. Until you set `folder`, it stays in `00 Meta/04 Bases/`. See *UpdateObsidianPM* for how its updates arrive.

### The note

- **On the project's note:** the time report lists the project's invoices, and its sub-projects', under **Invoices**: its status in an unnamed first column (✏️ draft, 🕒 sent, ✅ paid, ❌ canceled), then its link, date, period, hours and total, newest first, then a **Total** of all but the canceled ones.
- **Properties:** `area`, `invoice_status` (draft, sent, paid or canceled), `number`, `client`, `invoice_date`, `period_start`, `period_end`, `hours`, `total`, `paid`; tagged `invoice`, with `cssclasses: pm-invoice`. The *Invoices* base (`Invoices.base`, beside the invoices) lists every invoice, newest first: Date, Invoice, Project (the project's name, linked), Status and Total, with the sum of Total, to the cent, under the rows it shows (filter it to a period to total that period).
	- **`invoice_date` is the day it's sent.** *Mark sent* sets it, and the date the invoice prints, so there's no separate sent date.
	- **`area` is the project the invoice bills,** set when it's made. *SyncArea* never changes it, so moving the note never changes what it bills.
	- **`invoice_status` is the invoice's own,** not the `status` projects use. Obsidian suggests a property's values from every note that has it, so one shared property would offer an invoice a project's status, which the Invoice command wouldn't read.
	- **Invoices made before these two** carry `status` and `project` instead. Billing still reads them: an older invoice's `project` decides its project, since its `area` may have changed with a move. The *Invoices* base shows their Status blank. *Mark sent*, *Mark paid* and *Cancel* rename `status` to `invoice_status`; on a paid or canceled one, rename it by hand.
- **What prints:** your name and address and the date; the client's; Project ID, Requested by and Terms when set; Total hours and Total due; then **Billable hours**, a line per date (and per rate, when sub-projects bill at different ones), like `9/14 — Homepage review with Imogen, Draft homepage wireframes`, and the payment note. Nothing printed is a link. In a draft, edit a line's description as you like.
- **Billed entries:** a folded callout at the end, which doesn't print: the invoice's own copy of every entry it bills (date, start, end, minutes, hours, rate, project, task, note). It's what stops an entry being billed twice and what shows when one changes. Don't edit it: an invoice whose Billed entries don't read, or don't add up to its `hours` and `total`, stops the project's invoicing until it's fixed.
	- Moving an invoice note with the *Advanced Rename and Delete Handler* plugin strips the `\` from the `\|` in its table's links. Billing still reads the table.
- Your details and the client's are copied in when the invoice is made, so a sent invoice never changes when they do.

### Moving it along

Run *Invoice* on the invoice note for what fits its status:

| Status | Choices |
|---|---|
| draft | **Rebuild from the daily notes** (through its `period_end`, keeping the descriptions you changed) · **Mark sent** |
| sent | **Check for changes** · **Mark paid** · **Cancel invoice** |
| paid | **Check for changes** |

- **Mark sent** asks for the invoice date, the day you send it, starting at today, and sets it on `invoice_date` and where the invoice prints it. On a draft that no longer matches the daily notes, it offers to rebuild it first.
- **Mark paid** asks for the date it was paid, and sets `paid`.
- **Cancel invoice** marks it canceled: its entries are unbilled again, for the next invoice.
- **Check for changes** writes what changed, and entries logged in its period since, into a callout at the top, which doesn't print. The time report lists every invoice's billing changes on the project's note and its timesheet, a draft's ending *rebuild it*.
- **A draft you don't want:** delete its note. Its number isn't given again, so the numbers skip it.
- The timesheets update right away on the desktop; a status typed by hand shows at the next report run.

### What's billed, and what changed

- **One place:** only invoices record billing. An entry is billed when it's in the Billed entries of an invoice that isn't canceled (drafts count), matched by its day, start and end. Nothing is written into daily notes.
- **Held back:** an entry the invoice won't bill, because it:
	- overlaps a billed entry without matching it (a billed entry you extended: split the new time into an entry of its own to bill it);
	- has a billed entry's times on another project;
	- is a billed entry moved to another day (the only entry with its task and times within three days), or retimed on the same day (its task's only entry that day);
	- repeats another entry at the same times.
- **Changed since invoiced:** a billed entry whose times changed, that moved or is gone, that's 🆓 now or on another project now. Wording changes are shown but aren't billing changes. Entries logged in an invoice's period after it was made are listed too; they go on the next invoice.
- **`billed_through`:** time billed before you used this (another tool's invoices): set the project's `billed_through` to the last day billed, and its time up to then is never invoiced. A parent's date covers its sub-projects unless they set their own.

### The PDF

Copy `00 Meta/02 Scripts/Style Settings/pm-invoice.css` into `.obsidian/snippets/` and turn it on (Appearance → CSS snippets). Then *Export to PDF* on the invoice prints it without the properties, the Billed entries or the check callout, with any link as plain text. To be paid through a banking app that can't import invoices, attach the PDF to an invoice made there.

## Commands

The system's commands are CustomJS scripts, run from the command palette ("CustomJS: …"), a hotkey, or `obsidian command id=customjs:invoke-<Name>`. The hotkeys below are suggestions; set them under Settings → Hotkeys. *Complete* is Obsidian's own checklist toggle (`⌘⏎`).

### Typing a date

*Schedule*, *DueDate*, *JumpToDate* and *Invoice* ask for a date in words, and Natural Language Dates reads them. The line under the box shows the date they mean as you type (`Fri 10/2 · in 5 days`), and Enter takes it.

- **Words it can't read:** the line says "Not a date I can read", and Enter does nothing but say so. Natural Language Dates (Revived) answers with today for words it doesn't know, so a typo like `fridya` would otherwise pick today.
- **Words it only partly read:** the line says which (`Thu 10/1 · in 4 days · read as "october"` for `end of october`), and Enter takes that date. A partial reading that comes out as today (`tomorow at 5pm` read as `at 5pm`) counts as unreadable.
- **Weeks start on the day your settings say:** Notebook Navigator's calendar **Locale** (Settings → Notebook Navigator → Calendar), where *System default* means Obsidian's language, or Obsidian's language when its **Periodic notes locale** is set to follow Obsidian. Without Notebook Navigator, Obsidian's language decides. English starts weeks on Sunday. This is the week `next week` means, and the one Notebook Navigator's weekly notes cover.
- **Revived or the original:** either plugin works, and only one can be on at a time. Use Revived: the original reads a bare weekday as last week's (`friday` on a Monday gives the Friday before).

What the words mean, typed on Sunday 9/27/26:

| You type | You get | Why |
|---|---|---|
| `friday` | Fri 10/2 | The coming Friday, or today on a Friday |
| `this friday` | Fri 10/2 | This week's, in weeks that start on Sunday: on a Saturday, yesterday |
| `next friday` | Fri 10/9 | Next week's, so on a Sunday it's 12 days away; `friday` is the one you usually want |
| `last friday` | Fri 9/25 | Last week's: on a Saturday, 8 days back |
| `tomorrow`, `in 3 days`, `in 2 weeks` | Mon 9/28, Wed 9/30, Sun 10/11 | Counted from today |
| `10/2`, `oct 2` | Fri 10/2 | The next 10/2: a date already past this year is next year's, so give the year (`9/1/26`) for one behind you. *JumpToDate* and *Invoice* take the closer one instead: `9/16` is 11 days back, not next year's |
| `next week`, `this week` | Week starting 10/4, Week starting 9/27 | The weekly note, for *Schedule* and *JumpToDate*. *DueDate* takes a day: the first of next week, by your week setting, or today for this week |
| `week of oct 5` | Week starting 10/4 | The weekly note holding that day. *DueDate* takes the first day of that week |
| `next month`, `this month`, `next year` | October 2026, September 2026, 2027 | The monthly or yearly note, for *Schedule* and *JumpToDate*. *DueDate* takes the first day of it |
| `w41`, `oct`, `2026-10`, `2027` | Week starting 10/4, October 2026, October 2026, 2027 | A week or a month in words, or a note's own name (see *JumpToDate*). Without a year, *Schedule* takes the next one (`jan` is January 2027, `w5` week 5 of 2027) and *JumpToDate* this year's |

### Schedule (`⌘S`)

- Asks for a date (see *Typing a date*) and moves the line (with its sub-bullets) to the end of that day's first checklist. *What Schedule does to a line* has the whole table.
- **A week, a month or a year** (`next week`, `next month`, `next year`, `w41`, `oct`, `2026-10`) sends the line to that weekly, monthly or yearly note instead, never inside its time report. The note is created from its template if it's missing. A week's preview names its note (`Week starting 10/4 · 2026w41`).
- **Worked on** (time entries under it): the original stays as `[>]`, and both lines link the task note. If the task has no note yet, one is made first, the way *AddTaskNote* makes it (asking for its project or area); dismissing that picker cancels the schedule. A date in front of the task name goes to the note's `due` and comes off both lines, and the line's ⭕ or 🗃️ picks the note's home and stays, set to where the note is filed: `- [>] Draft homepage wireframes [[Kestrel Outfitters 2026|⭕]] [[Draft homepage wireframes|🗒️]]`.
- **From any note that isn't a daily, weekly, monthly or yearly note** (a sub-task in a task note, a task in a project note or log): the original gets the forward mark and a link to the day, `- [>] [[2026-09-18|9/18]] Sign-off call on Friday` (or the week, month or year: `[[2026w41|Wk of 10/4]]`, `[[2026-10|Oct. 2026]]`, `[[2027]]`), and the new line links back to the source with 🗒️, after the ⭕ or 🗃️ for the project or area the source is filed in; or with ⭕ / 🗃️ when the source is tagged `#project` / `#area`. A line with a ⭕ or 🗃️ of its own keeps it and gets no other.
- `[/]` tasks keep their marker on the new day.
- Event lines can't be scheduled: it says "Events must be moved in your calendar app" and changes nothing.

### DueDate (`⇧⌘D`)

Asks for a date (see *Typing a date*) and adds ` [[2026-09-30|🚩 9/30]] ` before the note links that end the line (🗒️, ⭕ or 🗃️), or else at the end.

### AddTaskNote

Links a task to a note of its own, keeping the line's link to the note's project next to it: `- [ ] Write brochure copy [[Pinecrest Library Brochure|⭕]] [[Write brochure copy|🗒️]]`.

- **The name** is the selection. With nothing selected and text after the cursor, it's the task's text up to its first link. Either way the 🗒️ ends the line. A task that already has a 🗒️ (or an older 🔗) is left alone, wherever the cursor is. With only whitespace after the cursor, it inserts an empty link (`[[|🗒️]]`) with the cursor inside, to search for a note with another name.
- **A new note** is made on the spot with the Task template, which asks for its project or area, so time logged under the task counts toward that project right away. You stay in the daily note; dismissing the picker cancels, with no note and no link. The cursor ends up after the checkbox.
- **A date in the name** (`2026-09-30 Renew car registration`) becomes the new note's `due` and comes off the line; with two dates, the last one.
- **The ⭕ or 🗃️ that ends the line decides where the note goes** (one in the text is part of the title). One project or area: a new note is filed there, and an existing note with no home yet is moved there, without a menu. Several: the menu, with the line's first. An existing note already in a different project or area asks **Move task note?**, showing the task and its From and To (Move is the default; Leave it keeps it where it is), since its project is shared by every line that links it; the other lines that link a moved note follow it (see *MoveToProject*). A same-named note already in the picked project is linked instead.
- **The line's ⭕ says where the note is filed**, before the 🗒️: kept when the note is filed there, set to the note's project when you leave the note where it is, and added to a line that had none. A note in no project leaves the line's links as they are; one left in a finished project takes the line's ⭕ off, so its time still counts there. A note in `00 Meta`, `36 Planner` or `90 Archive` is linked where it is, never moved.
- An existing note's `area` is set from its folder; new notes get it from the Task template.
- **On an event line** it links a meeting log instead, at the end of the line after the title, its ℹ️ or 🆓 and any ⭕, putting the daily note's date in front of the name so the Log template picks it up: `- [<] 10:00am⇥Homepage review with Imogen [[Kestrel Outfitters 2026|⭕]] [[2026-09-14 Homepage review with Imogen|🗒️]]`. It makes the log right away, the way it makes a task note: through the Log template, which files it by the line's ⭕ or 🗃️, or asks and sets the line's ⭕ to the pick. You stay in the daily note, and the 🗒️ opens the log. A log of that name already is linked instead, and it and the line are made to agree as a task's note is: moved to the line's project, after asking if it's filed in another, or the line given the log's project. The name is the selection or, with nothing selected, the title after the time, without its marks, wherever the cursor is on the line. A line that already links a log is left alone, and so is one with no title (a time with nothing after it).

### AddProjectLink (`⌥⌘P`)

- On a task or event line, asks for a project or area (the same menu as *AddTaskNote*) and adds `[[Project|⭕]]`, or `[[Area|🗃️]]`, replacing one the line already has: before the 🗒️ that ends the line, or at the end when there's none. The cursor ends up after the checkbox; Esc cancels.
- **With a note on the line** (a task's 🗒️ note, or an event's meeting log: its 🗒️, or its title's link on an older line), the note moves into the picked project too (a log into its `logs/`), so the line and its note agree. It asks first with *Move task note?* (From and To) when that's in doubt: the note is filed in another project or area, or other lines link it and would follow it. Leave it changes nothing. The other lines that link the moved note follow it (see *MoveToProject*). A note already in the picked project, or in its folder (a project note that isn't its folder's own note), only gets the line's ⭕; so does a note in `00 Meta`, `36 Planner` or `90 Archive`, which is never moved; a same-named note already in the picked project is linked instead.
- On an event line the ⭕ goes after the title and its marks, before the log link, where the calendar sync keeps it through updates and moves.

### MoveToProject (`⌥⌘M`)

Moves the note you're on into a project or area picked from the same menu as *AddProjectLink*, so refiling never means hunting for a folder. It's also *Move to project…* in the file menus (see *MoveToProjectMenu*). To file the note a daily-note line links, use *AddProjectLink* on the line.

- **Where it goes:** a meeting log (tagged `#log`, or in a `logs/` folder) into the project's `logs/`, made if missing, so a log left in `10 Inbox` is filed the way the Log template files it. A project or area's own note takes its whole folder along, sub-projects and logs included. Anything else goes into the project's folder. Obsidian's move updates the links, and *SyncArea* sets `area`.
- **Several at once:** while Notebook Navigator has the focus, it moves the notes selected there. A note inside a project that's moving with it goes along with its project.
- **It asks first** when a single note leaves a project or area (*Move task note?*, *Move log?* or *Move note?*, with its From and To), since every line that links it follows it. Moving a project or area always asks (*Move project?*, *Move area?*): its own time stays with it, but a project moved inside another project counts toward that project's totals, and takes its rate if it has none of its own (see *The time report*). Moving several at once doesn't ask.
- **The ⭕ on its lines follows the note:** a line that links the note and has a ⭕ or 🗃️ for the project or area it just left gets the new one's, before its 🗒️, and a line with none gets one, so its time keeps following the note. A ⭕ or 🗃️ for anywhere else is that line's own choice and stays, and the notice says how many lines kept one. A ⭕ for a finished project stays too, since that time may already be invoiced. A moved project's notes keep their project, so their lines are left alone. *AddTaskNote* and *AddProjectLink* update the lines this way too when they move a note.
- **It refuses, with a notice:** a name already taken where it would go, a note already there, and a project into itself or one of its sub-projects (the menu leaves those out, along with project notes that have no folder to hold anything). It never moves anything in `00 Meta`, `36 Planner` or `90 Archive`: archived work is out of the reports and usually invoiced, so bring it back by hand. Esc cancels.
- Finished projects still go into `90 Archive` by hand: the menu only lists projects and areas under `Projects/`.

### ToggleTimeEntry (`⌘T`)

- **On or under a task or event in today's daily note:** with no running entry, adds `- 9:01am - ` just above the task's first sub-task, or after its sub-bullets if it has none, and an open `[ ]` task becomes `[/]` (it stays `[/]` after the timer stops; events and other markers never change). With a running entry, fills in the end time; a `: 🆓` typed on the running entry stays. A task's timers are its own entries, not its sub-tasks'.
- **On an entry's line**, that entry is the one. With several running under the task, a list asks which (`Stop 10:30am: Task name`).
- **Anywhere else** (not on a task, a task in another note, reading view, no note open): a list of running timers in any daily note, today's first, then newest day first (`⏱ Stop 11:00pm: Task name · 9/14`), then today's open tasks and events. Picking one starts or stops it in its daily note and says what it did; you stay where you are. `⌘↵` goes to the item's line instead. Timing only happens in today's note because the report dates entries by their daily note: move a task to today with Schedule to time it there. Stopping works anywhere.
- **A stop that would make an entry of 12 hours or more** (a timer from another day, or one forgotten since morning) isn't filled in: the entry's note opens with the cursor after `- 9:00am - `, to type the real end. A timer from yesterday evening stopped after midnight still stops.
- `⌘T` replaces Obsidian's New tab shortcut, and Notebook Navigator's first shortcut if you use it.

### Plan

Asks how many days (2–5) and opens that many consecutive daily notes side by side, from the daily note you're on, or from today. Missing notes are made from the template.

### JumpToDate (`⌘J`)

Asks for a date (see *Typing a date*) and opens its note in the pane you're in; `⌘↵` opens it in a split to the right.

- **A day** opens its daily note. **`this`, `next` or `last` with `week`, `month` or `year`** opens the weekly, monthly or yearly note, named and filed by Notebook Navigator's week, month and year patterns (else `weeks/gggg[w]ww`, `months/YYYY-MM` and `years/YYYY` beside the daily notes).
- **Weeks** start on the day your settings say (see *Typing a date*), so `next week` is always the week after this one's note. Revived's own weeks start on Monday, which on a Sunday would land in this week's note; JumpToDate counts the weeks from today instead. A week written with its year (`2026-W41`) is the one holding that ISO week's Monday.
- **A week or a month in words:** `week of oct 5` (or of any date: `week of friday`, or `week starting oct 4`) opens the weekly note holding that day, and the preview says when it starts and names it (`Week starting 10/4 · 2026w41`). `w38`, `wk 38` or `week 38` is week 38, counted the way the weekly notes count, and `sep`, `sept`, `september` or `9/2026` is that month. They mean this year unless a year comes before or after: `w1 2027`, `2027 w1`, `Sep 2027`. (*Schedule* takes the next one instead.)
- **A periodic note's own name** opens it too, spelled the way the patterns spell it: `2026w41`, `2026-10`, `2027`.
- **A quarter** (`Q4`, `next quarter`) opens the daily note of its first day: there are no quarterly notes.
- **A month and day without a year** (`9/16`, `sep 16`) is whichever is closer, this year's or next year's, since jumping goes back as often as forward. Schedule and DueDate take the next one.
- **With the original Natural Language Dates**, words always mean a day, so `next week` opens a daily note; a note's own name still works.
- **A note that doesn't exist yet** is created from its template after asking: the Daily Note template, or for a period the template Notebook Navigator's calendar uses (else *Weekly Note*, *Monthly Note* or *Yearly Note*). Tick **Don't ask again on this device** to skip the question from then on; while it's skipped, the prompt says so and offers **Ask again**. If a template files the note somewhere other than the pattern's folder (the Weekly Note template moves its note into `36 Planner/weeks`), JumpToDate says so: make the two agree, or the next jump won't find the note.
- It replaces the *Natural Language Date* command of the Jump-to-Date plugin, which only works with the original Natural Language Dates plugin. If `⌘J` runs that command, move the hotkey to *CustomJS: JumpToDate*.

### ConvertToProject

Turns the selected text into a project: a note of that name from the Project template, a prompt for the parent area or project, a new project folder there, and a link in place of the selection. It won't run if a note with that name exists. Esc in the picker leaves the new project note in `10 Inbox`.

### CalendarSync and CalendarSyncRange

*CalendarSync* fetches (on the Mac) and writes the ticked calendars' events into daily notes; *CalendarSyncRange* first asks how far ahead (1 week to 6 months, number keys or Enter), saves the choice to the note's `Sync range:` line, then syncs. See *Calendar sync*.

### TimeReport

Refreshes every time report where the numbers changed, in the note you're on too, and each project's timesheet note. See *The time report*.

### Invoice

On a project note, makes a draft invoice from its unbilled time through a date you pick; on an invoice note, rebuilds it, checks it for changes, or marks it sent, paid or canceled. See *Invoices*.

### SnapshotDailyNotes and RefoldDailyNotes

Record the folds of every open daily note before an outside edit, and restore them (folding what was added) afterwards, if the snapshot is less than two hours old; otherwise *RefoldDailyNotes* folds the events. See *Folding*.

### UpdateObsidianPM

Installs the system from a local clone of the repository into the vault it runs in. See the README. It also puts the two bases where they open as files:

- **`Projects/Projects.base`**, the active projects, beside them: the `Projects` folder's note in Notebook Navigator.
- **`Invoices.base`** beside the invoices, in the `folder` Invoice Settings names (see *Where invoices live*), else in `00 Meta/04 Bases/`. When `folder` changes, the next update moves it there as it is, with any sorting or filters you added. While Invoice Settings can't be read (its properties don't parse, or `folder` isn't a folder), the base stays where it is and the update says why.

**A base saves your view changes into its file:** sorting, filters, column widths. So once you've used a base, an update sees it as changed by you and leaves it alone: it's listed under *Changed in this vault*. To take a new version from the repository, turn on *Take the repository's version* in the update's dialog; your copy of a file outside `00 Meta` goes to the vault's trash first, so you can copy a view back from it.

**Upgrading from before the bases moved:** the version of this command already in your vault doesn't know the new places, and would list the demo's `Invoice Settings.md` as a change to yours. So first copy the new `00 Meta/02 Scripts/CustomJS/updateObsidianPM.js` from your clone into the vault, as when you installed it, and reload CustomJS (or the vault). Then one update puts both bases in place. If the old version runs first anyway, leave *Take the repository's version* off: it would replace your Invoice Settings with the demo's. Run the update again once CustomJS has reloaded. If you had changed the Projects base and the old version kept your copy in `00 Meta/04 Bases/`, copy any view you want from it into the new one, then delete it.

### Startup scripts

These run on their own when Obsidian starts, and again whenever a script file changes (CustomJS's *rerun startup scripts on file change*):

- ***SyncArea*** keeps `area` current when notes move to another folder, one at a time or as a whole folder: it points at the nearest project or area above them, the first folder note (`Folder/Folder.md`) tagged `#project` or `#area`. A moved project's own note points at its new parent. It says "Updated area on N notes". It leaves `area` alone when notes land outside any project or area (`10 Inbox`, `30 Reference`), anywhere in `90 Archive` or `00 Meta`, on an invoice (its `area` is the project it bills), or when a folder is only renamed in place (Obsidian updates those links itself), and keeps a template's own pick for a brand-new note. It doesn't change the ⭕ on the lines that link a note moved this way, by a drag or *Move file to another folder*: until those follow too, move notes with *MoveToProject* to keep their lines current, and the report lists a line whose ⭕ and note disagree under Problems. It runs on every device, and each device handles only its own moves: Obsidian Sync delivers a move made elsewhere as a delete and a new file, so nothing is processed twice.
- ***RefoldOnOpen*** refolds each daily note as it opens, on every device. See *Folding*.
- ***MoveToProjectMenu*** puts *Move to project…* (*MoveToProject*) in the file menus: Notebook Navigator's menu for a note, for several selected, and for a project or area's folder; a tab's **⋯** menu; a link's right-click menu (for notes, not the project a ⭕ points at); and the core file explorer's. The item appears only for what *MoveToProject* moves.
- ***TrailingLinks*** draws the links that end a task or event line small, at the right of the line, on every device (see *Links at the end of a line*). It only looks at the lines on screen, and while you type only at the line you're on and the lines nested under it. It uses Obsidian's own editor code, which CustomJS scripts can reach; if they ever can't, it logs a warning and lines stay as they are.
- ***TimeReportOnStartup*** refreshes the time reports on the desktop once the vault is indexed. If CustomJS is still reloading its scripts, it waits a few seconds for them and otherwise skips with a console warning. A report already running finishes with the scripts it started with, so saving a script part-way through doesn't break it.

## Templates

New notes run `Get Template.md`, which picks a template from the title; the README's *Creating notes* table lists them. Two Templater user scripts in `00 Meta/02 Scripts/Templater/` shape what happens next:

- **`pickParent.js`** is the "Select parent…" picker the Area, Project, Task and Log templates show. It lists notes tagged exactly `#area` or `#project` (not nested tags like `#project/sample`) that don't have `completed` set, labelled by alias. Picking one moves the note there; Esc leaves it where it is. A command that already knows the parent hands it over and the menu is skipped: *AddTaskNote* passes the project on the task line, and Raycast's Open Log Note can preset Inbox. The Log template doesn't ask when the log's event line names one project or area with a ⭕ or 🗃️, and otherwise sets the line's ⭕ to the pick. Either way the `!…` trigger (and any dates) come off the name.
- **`showNewNote.js`** runs once those templates finish: it redraws the properties panel (after the picker and the move, Obsidian's panel otherwise stays empty in Live Preview until the note is reopened) and moves the cursor from the title into the body.

`eventTimes.js` reads a start and end time from a calendar event line, and `recordEvent.js` writes a new log's line into its daily note.

## Plugins

**Required:** Templater (script folder `00 Meta/02 Scripts/Templater`, trigger on new file creation), CustomJS (script folder `00 Meta/02 Scripts/CustomJS/`), [Natural Language Dates (Revived)](https://github.com/Amato21/nldates-revived), and the core Daily notes and Bases plugins. The original Natural Language Dates works in Revived's place, but reads a bare weekday as last week's; only one of the two can be on at a time.

**Recommended:**

- [Notebook Navigator](https://github.com/johansan/notebook-navigator): a calendar for the periodic notes, and folder notes. The scripts read its week, month and year patterns when it's installed.
- [Task Status](https://github.com/ebullient/obsidian-task-status): shows `[<]`, `[>]`, `[-]` and the other markers as their own icons, and `⇧⌘⏎` picks one.
- Outliner, for moving and selecting list items.

## Working on the system

Changes go through pull requests from a git worktree, and are tested one at a time in a clone of the repository opened as its own vault, with `00 Meta/02 Scripts/dev-vault.sh`. The tests run with `node --test "00 Meta/02 Scripts/tests/*.test.mjs"` from the vault root. `CLAUDE.md` has the workflow and the privacy rule; the README has the tests and CI.

- **Saving a script with Obsidian open:** CustomJS reruns its startup scripts when a script file changes, so every save reloads the classes and refreshes the time report.
- **Testing the calendar sync:** the repository holds nothing about calendars. Give a test vault its own calendar, tick only that one in its Calendar Sync note, and seed test events there.
