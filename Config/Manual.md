---
id: 2026092316300000
tags: 
---
# Obsidian PM manual

How the system works: the folders, the notes, the lines in a daily note, and what each command and script does to them. `README.md` covers installing it; this is the reference for using it, and the spec that anyone (or any agent) editing the vault should follow.

**If this manual and the scripts ever disagree, the scripts win**, and this manual should be fixed to match. The scripts are in `Config/Scripts/`, with tests in `Config/Scripts/tests/`.

Examples come from the demo vault, a made-up freelancer's notes from late August to mid-September 2026. Every person, client and amount in them is invented.

## About

The system borrows from PARA and from atomic note-taking. For projects and tasks it takes the keyboard-first speed of Things 3, the markdown scheduling of NotePlan, and two principles from Marcus Olsson's [Projects plugin](https://github.com/marcusolsson/obsidian-projects):

- **Leave no trace:** if you move to another system, everything you need is still in your notes, with nothing to clean up.
- **Keep it native:** use Obsidian's own features wherever possible.

Every task is a markdown checklist line you can reach from the keyboard, and each day gets its own daily note rather than an automatic Today view: tasks don't pile up in one place, and catching up is something you schedule rather than something every morning forces on you.

Every configuration file lives in one `Config` folder; the other top-level folders hold notes.

## Folder structure

```
Archive/                         finished projects, moved here whole
Config/                          the system: templates, scripts, bases, this manual
  Bases/                         Bases views (and the Invoices base, in a vault with no invoice folder)
  Error Log.md                   every Problem in one place (see The error log)
  Invoice Settings.md            your details for invoices, and where they go (see Invoices)
  Scripts/                       CustomJS, Templater, Calendar, tests
  Templates/
Inbox/                           new notes that haven't been filed
Projects/
  Projects.base                  the projects, active and inactive, opened as a file
  Freelance/                     an area: folder + folder note tagged #area
    Freelance.md
    Kestrel Outfitters 2026/     a project: folder + folder note tagged #project
      Kestrel Outfitters 2026.md
      Kestrel Outfitters 2026 timesheet.md   every entry, with its invoice (the time report writes it)
      Draft homepage wireframes.md   a task note (#task)
      ›logs/                     the project's log notes
      Kestrel Fall Catalog/      a sub-project: a project folder inside a project
  Household/                     an area with only task notes
Reference/
  Entities/
  Invoices/                      every invoice, with Invoices.base as the folder's note (see Invoices)
  Notes/
  People/
  Planner/
    days/ weeks/ months/ years/  the periodic notes
```

Area and project names are yours; the top-level folders and `Planner` are what the scripts expect.

## Naming conventions

| Type | Symbol | Alias | Where | Typed with (US Mac keyboard) |
| --- | --- | --- | --- | --- |
| Project | ⭕ | `⭕.Freelance.Kestrel Outfitters 2026` | a folder inside an area or project | dot notation |
| Area | 🗃️ | `🗃️.Freelance` | a folder inside `Projects` | dot notation |

- Special note types get an alias that starts with their symbol. The Quick Switcher then groups them, and typing the symbol filters to that type.
- The symbols are all on the iOS emoji keyboard, so they're easy to type on a phone too.
- The marks on a line are explained where they're used: ⋯, ↗, ⭕, 🗃️ and 🚩 under *Links at the end of a line*, and 🆓 under *Tasks and time tracking*.

## Note properties

- Every note has at least `id` and `tags`. The `id` is a 16-digit timestamp in [Moment.js format](https://momentjs.com/docs/#/displaying/format/) `YYYYMMDDHHmmssSS`.
- Daily and monthly notes are the exception: their frontmatter is only an alias (see *The periodic notes*).
- Notes are made by Templater, and `Config/Templates/Get Template.md` picks the template from the title you type. A note made any other way (a script, the CLI) needs its frontmatter written the same way by hand.

## People and entities

- **People** go in `People` and **entities** (companies, organizations) in `Entities`; `!person` and `!entity` make their notes. A person's `affiliation` links their entity. A project's `client` links the entity the work is for, and its `bill_to` the one that pays, when that's someone else.

## Areas, projects and task notes

- **🗃️ Areas** are folders inside `Projects`, each with a folder note of the same name tagged `#area` (`Projects/Freelance/Freelance.md`). They group projects, and can hold notes that belong to the area but to no one project, and time logged to the area itself (see *The time report*).
- **⭕ Projects** are folders inside an area, or inside another project (a sub-project), each with a folder note tagged `#project`. They hold every note and task note for that project. A new project starts at the top of `Projects/`, and *Move to project* puts it in its area. Until then it has no parent to inherit a rate from, so its time shows under Problems as billable with no rate.
- A project note's properties come from the Project template: `id`, `aliases`, `tags`, `status`, `parent`, `start`, `due`, `who`, `client`, `bill_to`, `rate`, `rate_type`, `max_hours` and `include_subprojects`. `status` starts at `To Do`; the others it takes are `Active`, `On Hold`, `Done` and `Canceled`. `client`, `rate` and `rate_type` start empty, to be filled in rather than assumed. `bill_to` starts empty too: it's for a project billed to someone other than its client, such as an agency that subcontracts the work, and *Invoice* bills it instead of `client` (see *Invoices → Making one*). The demo's Pinecrest Library Brochure has both: the library is the client, and its Friends group pays. It's a flat fee, and flat fees aren't invoiced yet, so no demo invoice shows its bill-to. Two properties cap the work: `max_hours`, which the template adds empty, or `contract_max` (an amount, divided by the rate).
- **Its look in Notebook Navigator:** with Navigator installed, a new project's folder gets a red circle and a new area's a green archive, or the icon and color you've given the `project` or `area` tag in Navigator, if you have. Its note is pinned in the folder when Navigator's *Pin created folder notes* is on, as Navigator does for the folder notes it makes. A folder that already has a look keeps it. Navigator keeps the look in its own settings, or, with its *Use frontmatter metadata* on, in the folder note's `icon` and `color`. Without Navigator neither happens, and the note gets no `icon` or `color`. This happens for every new project or area (`!project`, `!area`, *Convert to project*); give older ones a look in Navigator's folder menu.
- **For invoices** (see *Invoices*): `include_subprojects` (a checkbox, off by default) puts the sub-projects' time on the project's timesheet and invoices; `earned` (a date) says when a flat fee was earned, and *Invoice* sets it. Three optional ones print on its invoices when set: `client_project_id` (as *Project ID*), `requested_by` and `terms`.
- **A project note's tasks** are every checklist line at its left edge, whatever heading they're under. A task moved into a project goes at the end of the note's `## To Do`, which is made just above `## Time Report` when the note has none, or at the end of a note with no report. A line that's already there stays where it is.
- **Task notes** are notes tagged `#task` that give a task room for notes and subtasks. A subtask at the left edge of the note can have its own day, deadline and note; a nested one can't (see *A nested task is part of the task above it*). A task note and its subtasks share one project, and so do a log note and its follow-ups: a task that belongs to another project is written there, with the log linked in its text if you like, which ties nothing. The commands keep them together (see *Add project link*). The task's line in a daily note always links its task note (see *Links at the end of a line*).
- **`parent`:** every note inside a project or area has a `parent` property linking the nearest folder note above it: a task note's parent is its project, and a project's is its area or the project it sits in. Moving notes or folders keeps it current (see *SyncArea*), except on an invoice, whose `parent` is the project it bills. *Move to project* moves a note, a log or a whole project into another project or area.
	- **It's a copy of what the folder says, and decides nothing.** A note's project is its folder's, and so is a project's outer project and the rate it takes from it. Bases views read `parent`, so it's kept. There are two exceptions: an invoice's `parent` says which project it bills, and a project in `Archive` reads its `parent` when no folder says what it sat inside (see *Archived projects*). A `parent` that names another project than the note's folder is listed under Problems.
	- **It used to be called `area`.** A note that still has `area` is read the same way, and moving it into a project or area renames the property to `parent`. To rename them all at once, right-click `area` in Obsidian's *All properties* view and choose *Rename*.
- **Log notes** keep their details as properties: `parent`, `date`, `time`, `endTime`, `who`, `topic`, `series`, and sometimes `absent`, `guest`, `project` or `related`.
- **A finished project or area** has a `status` of `Done` or `Canceled`, in any case. It drops out of the menus that file notes and link projects: *Add project link*'s and *Move to project*'s. `On Hold` isn't finished, so it stays. *Invoice* still offers a finished project, since its time may still need billing. Its time still counts. A task can leave it like any other project, and its lines' ⭕ changes with it, unless that time is on a sent or paid invoice (see *Add project link*).
- **Finished projects** move whole into `Archive`. Exclude `Archive` from search in Obsidian's settings, and old projects drop out of the Quick Switcher and the project lists. Their time stays in every time report, past weeks, months and years included, so your history stays whole (see *Archived projects* under the time report).

## Daily notes

This section is the spec for how daily notes are written, for you and for any agent editing the vault.

### The periodic notes

| | Daily note | Weekly note | Monthly note | Yearly note |
| --- | --- | --- | --- | --- |
| Filename | `YYYY-MM-DD` | `gggg[w]ww`, e.g. `2026w38` | `YYYY-MM` | `YYYY` |
| Folder | `Reference/Planner/days` | `…/weeks` | `…/months` | `…/years` |
| Frontmatter | `aliases: M/D/YY dddd` (`9/16/26 Wednesday`) | `aliases: Week of M/D/YY` | `aliases:` with one entry, e.g. `September 2026` | none |
| Holds | That day's events, then its tasks | Tasks for the week with no day yet; its time report | Tasks for the month with no day yet; its time report | Tasks for the year with no day yet; its time report |

- The folder patterns match Notebook Navigator's calendar (`[days]/YYYY-MM-DD`, `[weeks]/gggg[w]ww`, `[months]/YYYY-MM`, `[years]/YYYY`). Attachments stay at the `Planner` root. A note named like a periodic note anywhere else isn't one.
- A daily note has no headings above its list. It opens with one checklist: events first, then tasks. Anything that isn't a task goes under `## Notes` below it.
- A blank line ends the first checklist. A second group can follow under a plain label (`After lunch:`), but Schedule only ever writes into the first checklist.
- A weekly, monthly or yearly note keeps its tasks in a checklist above `## Time Report`, the way the demo's `2026w38` and `2026-09` do. *Schedule* puts a task there for `next week`, `next month` or `next year`; schedule it from there to a day when its time comes.

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
- A tick on either line of a sent task checks off both, and a click on a `[>]` box asks before it changes anything: see *Checking off a task*.
- Other Task Status markers (`[?]` question, `[!]` important, `[I]` idea, `[i]` information, `[b]` bookmark, `["]` quote, `[*]` star…) are annotations with no scheduling meaning.

### Events

Format: `- [<]`, the start time, **one tab character**, the title. Times are lowercase with no space and no leading zero: `9:00am`, `1:30pm`. An all-day event has `All day` in place of the time, then the same tab. Typed by hand, a space after the time works too: *Add note* and the Log template read it, and the log gets that start time. The tab is what the calendar sync writes and keeps current.

```markdown
- [<] All day	Farmers market
- [<] 9:00am	Weekly planning
	- 9:30am
- [<] 10:00am	Homepage review with Imogen [[Kestrel Outfitters 2026|⭕]] [[2026-09-14 Homepage review with Imogen|⋯]]
	- 10:00am - 10:45am
- [<] 1:00pm	Call with Rafe Oakes [[Pinecrest Library Brochure|⭕]]
	- 1:30pm: 🆓 quick check-in, not billing it
- [<] 2:00pm	Delivery window for the new monitor ℹ️
	- 4:00pm
- [<] Printer call [[Pinecrest Library Brochure|⭕]] [[2026-09-18 Printer call|⋯]]
```

- **Order:** events sit at the top of the checklist. All-day events come first, then timed events in time order. The calendar sync inserts events in that order; Schedule never moves events.
- **A meeting with notes** gets a log, linked at the end of its line the way a task links its note: `[[2026-09-14 Homepage review with Imogen|⋯]]`, a log note named with the date and the title, after the ⭕ for the project it's filed in. The title stays plain text. *Add note* on an event line adds the link, with the daily note's date, and makes the log.
- **Older lines** wrap the title in the log link instead (`[[2026-09-14 Homepage review with Imogen|Homepage review with Imogen]]`). Every script still reads them, and the calendar sync writes one the new way whenever it updates the line.
- **The Log template writes that link itself.** A new log links the event line whose title matches it (exactly, or else the one line its title is the start of), with a ⋯ at the end, and the line's ⭕ set to the project the log is filed in. A meeting with no event line gets `- [<] Title [[Project|⭕]] [[log|⋯]]` with no time, after the timed events and above the tasks (the printer call above); a missing daily note is created first. When the calendar later brings that event, the sync adopts the timeless line and gives it, and the log, their times.
- **The line under an event** is its end time (`- 9:30am`), and that's the event's time: once the event has ended, the report counts it from start to end, on the project its ⭕ or 🗃️ link names, else *Unassigned*.
- **Ranges under an event** are its time instead (`- 10:00am - 10:45am`), and the end line is then ignored. An interrupted meeting has two ranges. A range with a label (`- 10:30am - 12:00pm: prep`) is related work.
- **The end line can take a note** after a colon, like a time entry: `- 1:30pm: 🆓 quick check-in, not billing it`. The sync keeps the note when the end time changes. When the event moves to another day, the note stays on the forwarded line; a 🆓 on the event line itself travels with the event, like a ⭕.
- **Multi-day events** appear only on their first day.
- **ℹ️ after the title** (before any ⭕ link) marks an event the calendar shows as *free* (Show As in Apple Calendar, Free in Google): not your time. The sync writes and maintains it. The time report never counts a free event and never checks it for overlaps.
- **Didn't go?** Mark the event `[-]` by hand: the report ignores anything but `[<]`, and the sync keeps the line current whatever its marker.
- A busy `[<]` event with no end line under it is listed under Problems once it has started ("has no end time under it, so it isn't counted"). One that ends when it starts counts for nothing, quietly. A timed event that ends on another day gets no end line from the sync, unless it only runs past midnight.

### Tasks and time tracking

```markdown
- [x] Draft homepage wireframes [[2026-09-18|🚩 9/18]] [[Kestrel Outfitters 2026|⭕]] [[Draft homepage wireframes|⋯]]
	- 9:15am - 11:15am: mobile layout
	- 11:15am - 11:45am: 🆓 redid the nav after misreading my own notes
- [x] Plan the catalog shoot [[Kestrel Fall Catalog|⭕]]
	- 1:00pm - 1:50pm: call sheet
	- 2:00pm - 3:05pm: shot list
	- [x] [[Shot list for catalog]]
- [x] Redo the hero crop I got wrong 🆓 [[Kestrel Outfitters 2026|⭕]]
	- 10:00am - 10:40am
- [ ] Homepage build: category pages [[Kestrel Outfitters 2026|⭕]]
```

- Tasks come after the events, in the order they were added. Schedule adds new arrivals at the end of the first checklist.
- **Time entries** are sub-bullets under a task: a range like `- 9:15am - 11:15am`, optionally followed by `: what you did`. An open range (`- 1:50pm - `) is a running clock.
- **A time entry under a task marks it "worked on."** That keeps the task's line on its day when Schedule moves the task (see *What Schedule does to a line*).
- **Only time directly under a top-level task or event counts,** in a daily note: a checklist or event line at the left edge. A time entry anywhere else counts nowhere and isn't listed: under a plain bullet, under a task or event that's under a plain bullet, or with nothing above it. So a time typed in a list of notes is just text. The commands still work on a task under a plain bullet, so the timer can write an entry there that counts nowhere. What does get listed is something that looks like time with its format off, such as a missing `pm`.
- **A nested task is part of the task above it.** A checklist line nested under a task (or under an event, with plain bullets between or not) belongs to it, in every note, and owns nothing. Nesting is what decides, not what you call the line: a subtask at the left edge of a task note can have its own day, deadline and note, and a nested one can't. Every task command run on it, or on any line under the task, acts on the line at the top of the nest: *Schedule*, *Due date*, *Add project link*, *Add note* and *Toggle time entry*. To give a nested task its own day, deadline, note or project, outdent it first, out from under its task.
- **Time goes under the task, never under a nested task:** a nested task has no time, project, note or deadline of its own (see *A nested task is part of the task above it*, above). Note what the time was for after the entry's colon, as the catalog shoot above does. A nested task can link a note in its text, like the shot list. An entry under a nested task doesn't count, and the report lists it as a Problem: move it up under its task, or outdent the nested task into a task of its own. Counting it too would give you a right total and no reason to fix the line.
- Lines nested under a time entry (`- Invoiced under 9/30`) are notes about it, not entries. A single time (`- 9:30am`) is an event's end time, not an entry. An end earlier than a pm start runs past midnight: `- 10:30pm - 1:15am`.
- Ranges under events count the same as ranges under tasks.
- **An ended event counts, and is checked for overlaps.** With the sync's end line under it and no ranges of its own, its start-to-end span is an entry: its hours count (Unassigned when nothing on the line names a project, so busy personal events add to Total and never to Billable), and work logged during a busy meeting shows under Problems. Free (ℹ️), all-day, `[-]` and `[>]` events never count and never overlap anything, and an event that hasn't ended yet counts for nothing.
- *Toggle time entry* (`⌘T`) types the times for you.

**Where the system works: three folders.** The daily, weekly, monthly and yearly notes in the Planner, and every note in `Projects` and the `Inbox`, are the system's. On a line anywhere else (a person note in `Reference`, a note at the top of the vault), *Schedule*, *Due date*, *Add note* and *Add project link* change nothing and say so: "Rafe Oakes isn't in the Planner, Projects or the Inbox, where the system works, so nothing changed". A checklist there is a plain checklist, and a task ID on its lines joins no task. The time report also reads `Archive`, for finished projects' time (see *Archived projects*). To bring a note in, drag it into `Projects` or the `Inbox`.

**Billable or 🆓.** Time counts as **billable** only when it's someone's to bill: the entry belongs to a project, that project isn't `non-billable`, and there's no 🆓 on it. Everything else goes in the **🆓** column. Billable is what you could invoice; Total is still every hour worked.

- 🆓 right after the colon, before any note, doesn't bill that entry: `- 11:15am - 11:45am: 🆓` or `- 5:30pm - 6:10pm: 🆓 fixing my own mistake`.
- 🆓 on the task or event line itself, as a word of its own anywhere on the line, makes every entry under it 🆓 (a task worked on all day that you won't bill). On an entry, or after an end line's colon, it applies to that one.
- 🆓 on both a line and an entry under it still counts as 🆓, and is listed under Problems, so a stray mark is never decided silently. A 🆓 that isn't a word of its own (`Task🆓`) counts for nothing and is listed too.
- On a billable project, 🆓 is the only thing that frees an hour, so the 🆓 column on a client's row is exactly what you comped them.
- Time with **no project** (errands, exercise, admin) is never billable. It shows as *Unassigned*, and Problems still counts it, so a forgotten project link is visible.
- A project with time on it and **no `rate_type` at all** counts as billable and says so under Problems: billing too much is a mistake you'll notice, invoicing nothing quietly isn't. The demo's Block Party Poster shows this.

### The time report

The **Time report** command writes summaries of the time logged in daily notes. On the desktop it runs by itself when Obsidian starts (*TimeReportOnStartup*); to see fresh numbers after logging time, reload Obsidian or run **Plainday: Time report**. A phone doesn't run it at startup: it gets the updated notes through Sync, so two devices never rewrite the same blocks (the command still works there). It writes to these notes, the one you're on included: an open note is updated through its editor, which keeps its folds.

| Note | What it shows |
| --- | --- |
| Each project or area note with entries | Under `## Time Report`: a first line linking a project's timesheet note (*Timesheet*) beside when it was updated, then **Problems** when there's anything to say, then the note's summary: its hours, Earned and effective rate (see *Summary* below). Then **By Project**, only when time was logged to a sub-project: the note's own row first (blank when it has none), a row per sub-project, and a **Total**. Then **By Week** or **By Month** (see *Weeks or months* below): the note's time with its sub-projects', newest first, and a **Total** that matches By Project's. Then its **Invoices** (see *Invoices*) |
| Each project's timesheet note | **Problems** when there's anything to say, then every entry, billable and 🆓, in one table under each kind's total (see *Timesheets*). The note sits beside the project's note, named after it (`Kestrel Outfitters 2026 timesheet`); on the desktop, it's made when the project first has time. An area gets none unless it's billed by the hour |
| Each weekly and monthly note for a period with entries, or a flat fee earned in it | Under `## Time Report`, each part under its own H3: the period's **Problems** when there's anything to say, then **Earnings**, when anything bills: a row per project that bills, with its Billable hours, Rate and Earned, and an **All** row (see *Earnings in weekly and monthly notes* below). Then **Hours**, a row per project and an **All** row, with a column per day in a weekly note (`Sun 9/13` … `Sat 9/19`, each linking its daily note) or per Sunday–Saturday week that overlaps the month in a monthly note (each linking its weekly note; a straddling week counts only that month's days), then the period's total. On the desktop, missing weekly and monthly notes are created first; a phone only refreshes notes that exist |
| Each yearly note | Under `## Time Report`: **Problems** when there's anything to say, then an **Earnings** table with a row per project that earned something by the hour that year, and each flat fee earned that year, in its month; then an **Hours** table (billable + 🆓) with a row per project, non-billable ones and Unassigned too. Each has a column per month linking its monthly note, the year's total and an **All** row |

Weeks run Sunday to Saturday, the same weeks Notebook Navigator names `2026w38`. The demo's `2026w38`, `2026-09` and `2026` notes show each kind.

- **The block:** each report sits between `%% time:start %%` and `%% time:end %%`. A run replaces only that block, and only when the numbers changed; the *Updated* line says when they last did. Text outside the block (an `## Invoices` section, say) and folds stay. `## Time Report` stays at the end of the note, with a blank line above it, and is added back if it goes missing; so tasks can go at the top of weekly, monthly and yearly notes, but nothing goes below the report.
- **Tables come padded,** the way Obsidian's table editor pads them: spaces line up every `|` in a column, and the row under the header is dashes across each column. Obsidian pads a table the first time the cursor enters it and saves the note, so a table written any other way changed on every visit, and the next report run wrote it back. Now entering one changes nothing, and in the Selectable Tables plugin, Enter opens its cells. Every table the system writes is padded this way: the reports', the timesheets' and the invoices'. In Source mode some columns don't line up by eye: Obsidian counts ✅ as one character and ⚠️ or 🆓 as two, and a link by its whole source, so a column under a linked heading is as wide as the link's text. In Live Preview and Reading view the tables look the same as before. The first report run after the update rewrites each block and timesheet once, into this form.
- **The old heading:** reports used to sit under `## Time tracking`. A run renames it `## Time Report` where it sits right above the block (only blank lines between), as it does `## Time report` in any other case, and puts a new block under an old heading rather than add a second one; a note that already has a `## Time Report` of its own elsewhere keeps both as they are. So the first run after updating rewrites every report note once, and Sync carries them to your other devices.
- **At startup** it waits until Obsidian has finished indexing the vault, and writes nothing if it can't find any project notes.
- **No prose:** the reports hold an *Updated* line, a project's summary, the tables and Problems. Entry-by-entry detail is in each project's timesheet note.
- **Links** in the reports name the project or area, `[[Kestrel Outfitters 2026]]`, `[[Household]]`. A table that lists projects lists them first, then a bold **Area** row that heads the areas below it, as *Project* heads the table, then the areas, so an area needs no mark of its own. That row has no numbers, so the rows still add up to **All**.
- **Earnings in weekly and monthly notes:** a row per project that bills, with **Billable** (its billable hours), **Rate** (from `rate` and `rate_type`: `$95/hr`, `$1,200 flat`) and **Earned** (billable hours × an hourly rate, priced a day at a time, as an invoice bills them; at a whole-dollar rate, Earned and the invoices agree to the cent), then **All**. Non-billable projects and Unassigned are in Hours only. A flat fee's row has `–` for its hours, which aren't billed one by one. A flat fee can't be invoiced yet, so its Earned is the fee in the period its note's `earned` date falls in, and N/A otherwise; *Invoice* sets `earned` when you run it on the project. A period with no time but an earned fee still gets its note and its row. With only flat fees not earned in the period there's no All row. A project with billable hours and no rate (one with no `rate_type`, say) has a row with no Rate or Earned. The yearly Earnings table lists the projects that earned something by the hour and the flat fees earned that year, so it leaves out projects with no rate. A sub-project with no `rate` or `rate_type` of its own uses its parent's: the demo's Kestrel Fall Catalog bills at Kestrel Outfitters 2026's rate. `rate_type: non-billable` keeps a project's hours out of Billable as well as Earned.
- **Columns of a project or area note's tables** follow how the note bills:
	- **Billed by the hour, or with no `rate_type`:** Exact, Total, 🆓, Billable, Rate and Earned. Rate is only in By Project, where sub-projects can differ; the rows of By Week or By Month all share the note's rate.
	- **A flat fee:** Exact and Total. Its hours aren't billed one by one, so it has no 🆓, Billable or Earned; the fee is in the summary.
	- **Non-billable** (an area with no `rate` included): Exact and Total.
	- **A By Project table that mixes them** has the full set; a non-billable or flat row leaves its Earned blank, and its Rate says `non-billable` or `$1,200 flat`.
	- **Rounding:** each row's Earned and Invested is priced on its own. At a rate that isn't a whole dollar, rows of the same day can add up to a cent more or less than Total, which is priced as an invoice bills it.
	- **Invested:** a non-billable note with a `rate` adds Rate and **Invested**, its Total hours × that rate, priced the way Earned is: what billing that time would have brought in. It's for time that's an investment, such as an R&D area, and it never counts as Earned, in any table or on an invoice. The rate is the note's own, or its parent's when the parent is non-billable too; a non-billable sub-project of a client project doesn't take the client's rate, and a sub-project that bills never bills at a non-billable parent's rate (it's hourly with no `rate` until it sets one). The demo's Garden Club Newsletter shows it.
- **Summary:** a few lines at the top of a project or area note's report, its sub-projects included, the values lined up with two tabs in Live Preview (Reading view shows a tab as a space):
	- **Hours:** the hours used, and with a cap (`max_hours`, or `contract_max` ÷ the hourly rate) what's left: `20.50 used | 39.50 left`, or `… | 0.50 over` past it. For a project billed by the hour, *used* is its billable hours, as *Invoice*'s cap warning counts them; for a flat fee or a non-billable note, every hour.
	- **Earned:** for a project billed by the hour, its Earned, then what's unpaid when anything is: the Earned of every billable entry not billed on a paid invoice (`$1,947.50 | $1,258.75 unpaid`). Time not invoiced yet, and invoices sent but not paid, are unpaid. A paid invoice counts for what it billed: an entry changed since is unpaid only for the time it gained, and one on two paid invoices is paid once.
	- **Flat fee:** a flat-fee project's fee, `$1,200`, plus the fee of any sub-project that sets one of its own, and the day it was earned once it's set: `$1,200 | earned 9/30/26`.
	- **Eff. rate:** the effective hourly rate, what the work has paid an hour. For a project billed by the hour, Earned over its hours, 🆓 and non-billable sub-projects' included, so it's never above its rate (unless a sub-project bills at a higher one) and falls as 🆓 time goes in; a flat sub-project's time and fee are its own. For a flat fee, the fees (and anything earned by the hour below it) over every hour, so it falls as the hours grow.
	- A non-billable note gets a summary only when it has a cap, and then only Hours. The rate itself isn't shown; with sub-projects, By Project's Rate column has it.
- **Weeks or months:** an area's report goes by month, since its time never ends. A project's goes by week while its entries span 13 weeks or fewer, then by month, by itself, so a year-long project never reaches 52 rows. By month, the months of the year of the latest entry each get a row linking the monthly note (`September 2026`); each earlier year is one row, linking the yearly note. A week's row links the weekly note (`9/13-9/19`).
- **Only past work counts:** an entry that hasn't ended yet (times filled in ahead under a synced event, say) is left out until it has.
- **Rows add up:** in the tables that list projects (weekly, monthly, yearly), each row counts only that project's own entries, so the rows add up to **All**; a parent project gets a row only when time was logged to it directly. A project's own note totals it with its sub-projects: By Project lists them, and By Week or By Month includes their time.
- **Which project an entry belongs to:** the line says where the time goes, or the time is *Unassigned*. The report reads the top-level task or event line the entry sits directly under: its `⭕` or `🗃️` link to a project or area note, e.g. `[[Kestrel Outfitters 2026|⭕]]`, says where the time counts (an archived project's counts like any other). With neither, it's *Unassigned*. Only the links that end a line count (see *Links at the end of a line*): a link in the text is part of the title, even a link to a project.
	- **Nothing else is read to work out a project:** not a ⋯, a ↗ or a log, not `parent`, and not any other line. The system doesn't guess. A line gets its project when it's written or when you assign it: *Schedule* gives a line sent from a note that note's project, *Add note* gives a line with none its note's project, *Move to project* gives a line with none that links the moved note the new project, the calendar sync gives a recurring event's lines the project you put on the series, and *Add project link*, or you by hand, sets it.
	- **When a line disagrees with itself, nothing decides.** That's two project links on the line that name different projects, or a ⭕ that names one project while the line's own note (its ⋯, or the log an older event's title is wrapped in) is filed in another. The time counts toward neither, isn't billed, and is listed under Problems (below).
	- **Outside a daily note** no time counts. Where a command needs a project for a line in a project note or task note, it takes the note's.
- **Areas:** time linked to an area (the demo's *Water the tomato beds* on 9/14, under Household) counts toward the area, as a row of its own under **Area** in the weekly, monthly and yearly reports. It never adds up the projects inside it: an area holds projects and its own time, not a total. An area note gets its own report under `## Time Report`, as a project note does, by month, but no timesheet unless it's billed by the hour (see *Timesheets*). An area's time is 🆓 unless the area note sets a `rate` or `rate_type`, which then work as on a project, except that a `rate` with no `rate_type` is listed under Problems: it makes the area billable by the hour, and a rate meant to value its time wants `rate_type: non-billable` (see *Invested*); an area is never a sub-project, even when filed inside a project's folder, so it never takes a client's rate. Only notes tagged exactly `#area` count, as the project and area menus read them.
- **Archived projects** (in `Archive`) count like any other: their hours, Earned and flat fees stay in the weekly, monthly and yearly reports of the periods they were logged in, their own notes and timesheets stay up to date, and their Problems are listed, so you can leave an explanation in the note. Only the commands treat them differently: the menus and the Invoice command don't offer them, and no invoice bills their time. Archiving never moves time: a line counts as it would if the project were live. A sub-project's folder can be moved into `Archive` alone, and then no folder says what it was inside, so a project in `Archive` reads its `parent`: it keeps the outer project's rate, and a finished phase still counts toward its live parent's total and hours cap, so archiving it doesn't free contract hours; it stays out of the parent's timesheet and invoices. A live project never reads `parent`, so a live project is never under an archived one. The demo's Marlowe Bakery Rebrand, archived on 8/28, still counts in August's reports, and its note shows its Earned as unpaid, since the demo has no invoice for it.
- **Sub-projects** (a project folder inside another project's folder: only the folder makes one) keep their own hours; only the parent's own note adds them to its total.
- **Rounding:** Billable, 🆓 and Total round each entry **up** to the next 15 minutes (2:01 → 2:15), so any work counts and 15 minutes is the minimum. Exact is unrounded. The step is `ROUND_TO` in `timeReport.js`.
- **Daily notes are only read.**

**Problems** lists what the report couldn't count cleanly: a line that disagrees with itself or its own note, a line whose note waits in the `Inbox`, time and marks on a nested task, a ⭕ outside the periodic notes, a subtask's day in another project than its note, a task whose deadlines differ (each below), running clocks, ends before starts, overlapping entries (on any day, even across midnight), list lines that look like time ranges but aren't `- h:mmam - h:mmpm` bullets, 🆓 after other text on an entry or on both a line and an entry under it, busy events with no end line, entries or events of 12 hours or more, unclosed code blocks or comments, entries with no project, and a task whose lines disagree (see below). Problems about a project itself (such as a `rate` that isn't a positive number, an hourly project with no `rate`, no `rate_type`, an area with a `rate` and no `rate_type`, two archived projects each inside the other) are listed on the project's note and its timesheet, and on every weekly, monthly and yearly note whose period has time on that project or on a sub-project of it, so a period's report says why its hours count the way they do.

- **A line that disagrees with itself:** two project links that name different projects (take the wrong one off), or a ⭕ that names another project than the one its own note is filed in, archived or not (a note moved by hand leaves its lines like that): run *Add project link* on the line, which moves the note too, or *Move to project* on the note. Each top-level line of a daily, weekly, monthly or yearly note is checked, with or without time under it. Nothing decides, so the line's time counts toward neither project, and isn't billed, until you fix the line. It's listed on both projects' notes, on the timesheet of each that has one, in *Fix first?* when you invoice either, on an invoice that billed the time before, and once on the line's weekly, monthly and yearly notes, where they have a report. A week with no time in it gets none just for this; its project's notes still list the line.
- **A ⭕ on a line whose own note waits in the `Inbox`:** the time counts toward the ⭕ and bills as usual, so it's not in *Fix first?*. The line is listed until the note is filed, and its timesheet rows are ⚠️: run *Add project link* on the line, or *Move to project* on the note.
- **Time under a nested task** doesn't count, and is listed on its day's reports, on its task's project and in *Fix first?*: move it up under the task, or outdent the nested task. A billed entry that's now under a nested task says so on its invoice. An event nested under a task counts the same way.
- **A ⭕, 🗃️, 🚩, ⋯, ↗ or task ID on a nested task** counts for nothing, in any note in the system, and is listed: outdent the line into a task of its own, or take the mark off. A block ID of your own on a nested line is fine.
- **A `parent` that names another project than its note's folder,** in `Projects` or the `Inbox`, is listed on both projects' notes: set `parent` to the note's project, or clear it for a note in the `Inbox`. A note with no `parent` isn't compared, nor is an invoice, a timesheet or anything in `Archive`.
- **A ⭕ or 🗃️ at the end of a task line outside a daily, weekly, monthly or yearly note** says nothing, since the note's folder says its project, and may name the wrong one: take it off, or, when it names another project, move the task there. It's listed on the note's project only, or for a note in no project (one in the `Inbox`, say), in the weekly, monthly and yearly notes under the day its forward date names, or else today, with a word to file the note. Only a task line is read, a checklist line at the left edge: a ⭕ on a plain bullet is text, such as a pointer in a log to another project's note, and so is one inside a line's text. Its line counts no time, so it's not in *Fix first?*.
- **A subtask's day in another project than its task note or log:** a task and everything under it share one project, so a subtask's day line (the line with its ID in a daily, weekly, monthly or yearly note) names the project its task note or log is filed in. A day line that names another, or none while the note is filed in a project, or one while the note waits in the `Inbox`, is listed as a *Project disagreement*, with the line's title, the project it counts toward and its note's. The fix: choose one project, with *Add project link* on one of the task's lines or *Move to project* on the task note, either of which changes the whole task. Where neither can, the Problem says to set the line's ⭕ to the note's project by hand: a note filed in a finished project, which isn't in their menus, or a task note or log in `Archive`, where no command works. Its time counts toward the project the line names until you fix it, so it's listed on both projects' notes and timesheets, its entries are ⚠️ on the timesheet of the project the line names, it's in *Fix first?*, and it's on the reports of its line's week, month and year. A task note or log in `Archive` is compared too; a ↗ alone, and the subtask's own line in the note, decide nothing.
- **A task whose deadlines differ:** two 🚩 on its lines that name different days, or its task note's `due` and a 🚩 on one of its lines. A task's lines are the ones *Due date* writes: those with its ID and those whose ⋯ links its note, done, forwarded and canceled lines included. A subtask keeps its own deadline, so its lines aren't compared with its task note's `due`. A `due` that isn't a date isn't compared, nor is a log's, a plain note's or a project's own. The Problem names the task's dates but not where each one is, since a new deadline is the fix: run *Due date* on any line of the task to give it one. Each report says it once: the reports of the weeks, months and years its lines with a 🚩 are in, and the task's project. A line in a monthly note is the month's and the year's, not a week's. *Due date* doesn't change a note in `Archive`, so the Problem says to change that one by hand, after *Due date*, or in its place when every line is there. Nor does it change a `due` written another way than the Task template writes it (with a comment, say): the Problem says so when the report has read that note, and *Due date*'s notice says so either way. Lines in `Archive` make a task of their own, apart from the lines in the system, since *Due date* never reads them. A deadline doesn't change what's billed, so it's not in *Fix first?*.

Only the notes in the system and in `Archive` are checked: a checklist anywhere else is a plain checklist, and is never listed.

**A task whose lines disagree** is found through its ID, across all the notes, top-level lines only: a nested line's ID isn't one of its lines. The report lists the line it's on, and the lines it disagrees with, when a task:

- has lines that count toward **two projects** (or one that counts toward none while another does, unless it has a ⋯), with no line let off: a project change writes every line of the task and refuses to move billed time, so a line with time on a sent or paid invoice, or one in a finished or archived project, is listed like any other. The Problem gives one fix: *Add project link* on one of its lines, picking the task's one project (the project that billed the time, when there is any, since time can always go back to it). When every project its lines name is finished, none is in the menu, so it says to give the lines one project by hand. A line in `Archive` keeps the project of its folder there, and no command changes it: the Problem names its note and says to take the ID off it by hand, since the task went on without it;
- is **open on two lines**: a line copied by hand with its ID (take it off the copy), or a sent line a click turned from `[>]` back into `[ ]` (set it back to `[>]`, or *Schedule* it; the Problem says which);
- is **done and open**, or **done on two days**;
- has a sent `[>]` line in a note that isn't a periodic note with **no forward date**, or a **forward date that points where the task isn't** (the day has no line with that ID, or isn't open there; with the task open on two lines, a forward date naming either is right, since the open twice is listed already);
- has **lines in two notes** outside the periodic notes (take the ID off the copy);
- has lines that link **two different notes with ⋯** (take one ⋯ off);
- has its **ID twice in one note**; or
- has **text after its ID**, which Obsidian no longer reads as an ID.

Only a task's ID is checked: a block ID on a line that was never sent is just a link target. A disagreement on a project shows on every project the task names, and only that kind, with a subtask's day in another project (above), marks timesheet entries ⚠️ or appears in Invoice's *Fix first?*. The others show on the day they're on and the task's project. A line that is on no day and counts toward no project (a task kept in an Inbox note, say) shows in the weekly, monthly and yearly notes, with a link to its note, under its week's, month's or year's first day, the day its forward date names, or else today. A Problem on a line in a project's or area's own note says *This project note has a task line (line 27)* (or *This area note*) in that note's report, and names the note in any other. Quoted lines stop at 80 characters. Malformed and running entries are listed but not counted. Code blocks and `%%` / `<!-- -->` comments are skipped. Problems come first in every report, right under the *Updated* line, in a `[!warning]` callout (orange in the default theme), so they aren't missed below a long table. With nothing to say, a report has no Problems callout. The demo has one of each kind on purpose: the 9/16 note has a mistyped entry (`2:30 - 3:45pm`), and Block Party Poster, a volunteer project whose `rate_type` was never filled in, is listed on its own note and on `2026w38`, `2026-09` and `2026`.

A project's own note also lists what's wrong with its invoices (see *Invoices*), and so does its timesheet, but no weekly, monthly or yearly note: a billed entry changed since its invoice was made (`- [[1001-KES]] (paid 9/15): [[2026-09-11|9/11/26]] 1:00pm - 2:30pm was billed, now 1:00pm - 2:45pm`; a draft's line ends `; rebuild it`, since *Rebuild* fixes it), an entry on two invoices, and an invoice whose Billed entries can't be read. The demo's Kestrel Outfitters 2026 shows the first. An invoice with no project is listed too, on each project its rows bill: its `parent` is gone, or links a note that isn't a project, so nothing says whose bill it is. Set its `parent` to the project it bills. Its rows still count as billed, and its project's note lists what changed in them only once it can be read. A billed entry is missing when nothing is at its day and times and no entry of its project or task overlaps them; its line links the daily note: `` - [[1001-KES]] (paid 9/15): 8/27/26 1:00pm - 3:10pm `Kestrel Outfitters proposal: scope and estimate` was billed, but now it's missing from [[2026-08-27|the daily note]]; put it back there to settle it ``. It quotes the task and note the invoice recorded, so you can tell what to put back.

#### The error log

Every Problem the time report finds, and the calendar sync's own (changes it held back, lines it couldn't write), is also listed in one note, `Config/Error Log.md`: one line per kind of Problem per note, with a count when a note has more than one, linking the note to start from: a billing Problem links the invoice's project, whose Problems callout names the invoice and links the daily note. The detail is in the reports' Problems callouts (the project's note, its timesheet, the weekly, monthly and yearly notes), or for the calendar sync in the Calendar Sync note's *Last run*. An invoice's own problem shows when you run *Invoice* on it, and every missing billed row in *Invoice*'s *Fix first?*. Open it with *View Error Logs*, and open the notes it names beside it. The demo's log:

```
## Time report

Updated 9/16 9:00pm · 3 open

- Billed times changed · [[Kestrel Outfitters 2026]]
- Bad formatting · [[2026-09-16]]
- No rate_type · [[Block Party Poster]]
```

- **Each run rewrites its own section, whole:** the time report its section, the calendar sync its own. A Problem you fix leaves the log the next time that command runs. A section is only written when its list changed, so *Updated* says when it last changed.
- **The order:** billing first, then time entries, then projects' settings, then tasks; within a kind, by note name, so daily notes go by date.
- **A toast** after a run that finds a line the log didn't have, or more of one, names the new lines (the first three) and links the log. Startup's run shows it too. A Problem already in the log doesn't toast again. A line with several new ones says how many: `Bad formatting ×3 (2026-09-16)`.
- **Not listed:** time with no project, which the reports count but errands have on purpose. A Problem about a line, or a note's `parent`, is listed once, under the note it's in.
- **Its own to each vault:** only the desktop creates the note, and a phone updates it when it's there. Git ignores it, and *Update Obsidian PM* never installs it.

#### Timesheets

- **Where:** each project with time gets a timesheet note beside its note, tagged `timesheet`, with the project as its `parent`. The time report writes it, the whole note, with no heading of its own; don't type in it. It's a note of its own because a long table costs every keystroke typed in the note it's in, even off screen.
- **Not for areas:** an area's time never ends, so its timesheet would only grow; the area note's own report shows its hours. A timesheet made for an area before is left as it was, no longer updated or linked: delete it. An area billed by the hour (a `rate`) keeps its timesheet, since *Invoice* bills it.
- **Which entries:** every entry of the project that has ended; with the project's `include_subprojects` on, its sub-projects' too, in a Project column.
- **One table,** billable and 🆓 time together, under a line with each kind's total: `### Billable time: 20.50 hrs · 🆓 time: 1.75 hrs`. A kind the timesheet has no time of is left out of the line: Kestrel Fall Catalog's reads `### Billable time: 3.50 hrs`, and Garden Club Newsletter's, a non-billable project, `### 🆓 time: 2.50 hrs`. The table has a bold row per day, newest first, then the day's entries in time order. Timesheets used to have two tables, Billable time and 🆓 time; the first report run after the update rewrites each one into this layout.
- **Columns:**
	- an unnamed first column, the status (below);
	- **Date / Time:** on a day's row its date, in bold and linked to its daily note, and on an entry's row its times;
	- **Project,** when it shows a sub-project's entries (`include_subprojects`, above);
	- **Bill** (billable time, named short so the table fits a phone) and **🆓:** an entry's hours, rounded as billed, in its own kind's column, and on a day's row each kind's total, blank when the day has none of it. A kind the timesheet has no time of has no column: Kestrel Fall Catalog's has no 🆓 column, and Garden Club Newsletter's no Bill one;
	- **Task** and **Notes** (the text after the entry's colon), with no 🆓 in them: the status column shows it;
	- **Invoice,** in a project billed by the hour: the invoice that billed the entry.
	- It's about time, so there are no amounts; Earned is on the project's note.
- **An entry's status,** the first that fits:
	- ⚠️ when it changed after it was billed, when a Problem is about it (below), or when it's 🆓 and on an invoice, since it was billed before it was made 🆓. Invoices don't show 🆓 time yet;
	- 🆓 for a 🆓 entry;
	- the status of the invoice that billed it: ✏️ draft, 🕒 sent, ✅ paid, 📄 a status of your own;
	- blank: not invoiced yet. The invoice note has its dates.
- **A day's status,** from its entries', the first that fits:
	- ⚠️ when any entry is ⚠️, 🆓 or not, so a problem always shows on its day;
	- blank while any of its hourly entries isn't on an invoice yet. Hourly entries are the billable time in a project billed by the hour, the only kind an invoice bills, so 🆓 entries and flat-fee time never hold a day back. Flat-fee time is a flat-fee project's, or a flat-fee sub-project's on its parent's timesheet;
	- otherwise the earliest status among its hourly entries: ✏️ draft, 🕒 sent, 📄 a status of your own, then ✅ paid. So a day is ✅ only when every hourly entry is paid;
	- 🆓 for a day with only 🆓 entries, and blank for a day with no hourly entries but some flat-fee time.
	- In the demo's Kestrel Outfitters 2026 timesheet, 9/11 is ⚠️, 8/27 and 8/28 are ✅, and the days not invoiced yet are blank. Every day of Garden Club Newsletter's is 🆓.
- **When the status column shows:** always, in a project billed by the hour at a `rate`. In any other project, only when a row is 🆓 or ⚠️: Pinecrest Library Brochure's timesheet has it for its 🆓 call on 9/17, and Block Party Poster's has none.
- **⚠️** also marks any entry a Problem is about: both entries of an overlap, an entry with 🆓 twice or of 12 hours or more, the entries under a task or event line with a Problem (a 🆓 stuck to its text, say), and the entries of a line whose note waits in the `Inbox`.
- **Day bands:** with the `pm-timesheet.css` snippet on, each day's entries share one shade under a plain day row, so each day reads as a block. The shade is your theme's text color mixed into the note's background, 4% in light mode and 12% in dark, so it takes the theme's tint and shows in both. The rows keep their colors under the mouse. Copy `Config/Scripts/Style Settings/pm-timesheet.css` into `.obsidian/snippets/` and turn it on (Appearance → CSS snippets). It applies only to notes with `cssclasses: pm-timesheet`, which the time report writes into every timesheet: a new one when it's made, and one made before at its next refresh, keeping any class the note has. Columns that Selectable Tables freezes keep the bands too. To pick the entries' color, set `--pm-timesheet-entry-background` in a snippet of your own, such as `body { --pm-timesheet-entry-background: var(--background-secondary); }`. Without `pm-timesheet.css`, the table looks as any table does in your theme.
- **Problems** come first in the timesheet, above the table, when there's anything to say, so every ⚠️ says why. The lines are the project note's:
	- **First, its entries' and projects':** the Problems above, for the projects whose time the timesheet shows. Running clocks and malformed lines aren't counted, so they have no row; only their line says so. With `include_subprojects` off, a sub-project's are on its own timesheet, though the parent's note lists them too.
	- **Then its invoices':** `- [[1001-KES]] (paid 9/15): [[2026-09-11|9/11/26]] 1:00pm - 2:30pm was billed, now 1:00pm - 2:45pm`, and billed time that's missing from its daily note.
	- An entry added on top of billed time whose own entry is still there gets a line of its own, after the overlap's: `… 1:00pm - 2:30pm was billed, and 2:00pm - 3:00pm overlaps it`.
	- With nothing to say, there's no Problems callout. In the demo, Kestrel Outfitters 2026's timesheet has an invoice's line, Pinecrest Library Brochure's the mistyped 9/16 entry, and Block Party Poster's its missing `rate_type`.

#### Freezing tables

With the [Selectable Tables](https://github.com/frankreporting/selectable-tables) plugin, a long table can keep its first rows and columns in view as you scroll it in Live Preview, like a spreadsheet. The plugin keeps a freeze as a comment in the table's header row: `%%freeze 2 1%%` keeps 2 rows and 1 column in view. A comment draws as nothing, so you see only the cell's text.

- **A default for every table the system writes:** set `freeze_rows` and `freeze_columns` in `Config/Table Settings.md`, as whole numbers. Blank or 0 is off, as it comes. With both at 1, every table keeps its header row and first column in view: the time report's tables in weekly, monthly, yearly, project and area notes, every timesheet, and an invoice's *Billable hours* and *Billed entries*. A short table gets it too, which changes nothing you'd see. The next run, or *Rebuild* on a draft, writes it.
- **`freeze_columns` counts from the first named column:** a timesheet's unnamed status column, and the one in a project's *Invoices*, comes along without counting. So with 1, a timesheet keeps its status column and its Date / Time in view, and its header starts `%%freeze 1 2%%`. Selectable Tables freezes at most 9 columns, a status column included.
- **The label beside it:** the report writes a second comment saying whose freeze it is, `%%default 1 2%%` for its own default, `%%custom%%` for yours. It's hidden like the mark, and you never type it. Both start the header row's first cell, so in Source mode that column is wider.
- **Your freezes are kept:** freeze or unfreeze a table with Selectable Tables' commands, or type a mark yourself, and that table keeps it through every rewrite. The next run labels it `%%custom%%`. An unfrozen table gets `%%freeze 0 0%% %%custom%%`, so it stays unfrozen.
- **A table with a cell selected:** Selectable Tables' freeze commands, and its arrow keys, leave a cell selected, and while one is, the plugin turns away any change to that table, the report's and *Invoice*'s included. So a run right after *Unfreeze table* can't update that note. It says so ("the open note didn't take the change") rather than counting the note as written: click outside its tables and run the command again.
- **Changing the default** moves every table still labeled `%%default …%%` to the new numbers and leaves yours alone. **Clearing it** takes the default's comments out, and leaves yours.
- **To give a table back to the default,** delete both comments from its header row in Source mode. The next run treats it as a new table.
- **How a table is known from run to run:** by the heading above it in the block, its numbers aside (a timesheet's carries its totals). A timesheet's table is the same table whichever kinds of time its line names, so it keeps your freeze when its first 🆓 entry comes in. A table whose heading changes is a new table and gets the default: a project's *By Week* becomes *By Month* once its time spans more than 13 weeks. So does a table that was gone for a run, such as a project's *By Project* while no time was logged to a sub-project. A timesheet that had two tables, from before they became one, keeps a freeze you set on either of them, the Billable table's when both had one.
- **Only the freeze is kept.** Anything else you change in a report's table, its header included, is rewritten as always. A table of yours outside the report's block is never read or touched.
- **Invoices:** a new draft's tables get the default. *Rebuild* keeps a freeze you set on a draft's table, as it keeps a description you changed. A sent or paid invoice is never rewritten, so it keeps what it has. Billing reads *Billed entries* with the comments in it, and *Export to PDF* prints neither comment.
- **Without the plugin** the comments stay hidden, so the tables look as before. Nothing checks whether it's installed.
- **The note is yours:** *Update Obsidian PM* installs `Table Settings.md` when the vault has none, and never changes it after that. A run reads it from the note's text, so a change counts at once.

### Links at the end of a line

In daily notes, links to other notes go at the **end** of the line, each with a symbol alias:

| Symbol | Points to | Added by | Example |
| --- | --- | --- | --- |
| ⋯ | The line's own note: a task's note, or an event's log note | *Add note*, *Schedule*, the calendar sync, the Log template | `[[Task name\|⋯]]` |
| ↗ | The task's line in the note *Schedule* sent the line from: a task note, a log or a plain note (never a project or area note, which the line's ⭕ names). Clicking it opens that note at the line. | *Schedule* | `[[Note#^id\|↗]]` |
| ⭕ | The project the line's time counts toward, where its note is filed | *Add project link*; *Add note*, *Schedule* and the Log template, for the note's project; *Schedule*, when the source is tagged `#project` | `[[Project\|⭕]]` |
| 🗃️ | The area the line's time counts toward, where its note is filed | The same, for an area; *Schedule*, when the source is tagged `#area` | `[[Area\|🗃️]]` |
| 🚩 | The due date (that day's daily note) | *Due date* | `[[YYYY-MM-DD\|🚩 M/D]]` |
| M/D | The forward date: where a sent task is now, with its line | *Schedule* | `[[YYYY-MM-DD#^id\|M/D]]` |

```markdown
- [<] 10:00am	Homepage review with Imogen [[Kestrel Outfitters 2026|⭕]] [[2026-09-14 Homepage review with Imogen|⋯]]
- [ ] Send final copy to Rafe [[Pinecrest Library Brochure|⭕]] [[Write brochure copy#^p7d2qe|↗]] ^p7d2qe
- [ ] Renew car registration [[2026-09-30|🚩 9/30]] [[Household|🗃️]] [[Renew car registration|⋯]]
- [x] Reply to Rafe about proof dates [[Pinecrest Library Brochure|⭕]]
- [x] Water the tomato beds [[Household|🗃️]]
- [>] Sign-off call on Friday [[2026-09-18#^k3x9m2|9/18]] ^k3x9m2
```

- **The forward date says where a sent task went.** It's the date at the end of the line, the link `[[2026-09-18#^k3x9m2|9/18]]`, with no symbol: the `[>]` box already says the task went somewhere, and a link to the task's line can't be taken for a 🚩 due date. It names the day, week (`Wk of 10/4`), month (`Oct. 2026`) or year (`2027`) the task was sent to, and the block ID of its line there, so a click lands on the line. A link at the end of a line to a periodic note's line is read as one when its label is a date as *Schedule* writes it (`9/18`, `Wk of 10/4`, `Oct. 2026`, `2027`); a block link of your own to a day's line, with words for its label (`[[2026-09-15#^abc123|the call]]`), is part of the text and stays put; one written with a ➡️ before its date (during OBS-185's first tests) is read too, and written without it next time. *Schedule* writes it on a `[>]` line, and keeps it current when the task moves again. A `[>]` line in a note that isn't a periodic note has one, and such a line keeps its forward date once it's done (`[x]`) or canceled (`[-]`), when it names the day the task was done (see *Checking off a task*); the task's open line never has one. A daily note's `[>]` lines (a task worked on there and forwarded) carry the task's ID but no forward date, and so do weekly, monthly and yearly notes. A weekly, monthly or yearly note whose name another note shares is linked by its path.
- **Two marks, two notes.** ⋯ links the line's own note; ↗ links the note *Schedule* sent the line from, so a subtask sent from a task note says where it came from without that note becoming its own. A line has at most one of each, the ⋯ first. A ↗ says nothing about the line: the report and its checks never read it, and it's there for you. Only *Schedule* writes ↗. Example: 9/17's *Send final copy to Rafe* was sent from *Write brochure copy*, so it ends `[[Write brochure copy#^p7d2qe|↗]]`: the line there that carries the same ID, `^p7d2qe`.
- **The marks before:** lines used 🗒️ for both (and 🔗 before that). Nothing reads them now, and a typed … (an ellipsis) isn't ⋯. A line left with a ⋯ and no ⭕ is *Unassigned*, so give it its project. A one-time conversion, run once after installing this version, replaces every one at the end of a list line (or an older meeting line) in the system and in `Archive`: a link back to the note a line was sent from (that note has a line with the line's ID, or, from before IDs, a checklist line with its text) becomes ↗, linking that line by its ID when it was found by ID, and every other one ⋯. A checklist line at the left edge of a periodic note that read its project only through its link back gets that project's ⭕, so its time still counts there. **Until it has run,** the time report, invoices and the calendar sync write nothing and say so, and a new log note isn't recorded in a daily note that still has one, since a 🗒️ would hide the ⭕ before it and isn't read as a log's link. Run it right after installing, with Obsidian closed on your other devices until it's done. **To run it:** take a backup, open the developer console (View → Toggle Developer Tools → Console), and run `await plainday.TaskIds.linkBackPass()` for the dry run. Its `changes` list every line it would change, the ones to check first at the top: a line whose time would count toward another project afterwards (`moves`, with its minutes), a text match, and a link back to a line that was never sent. Then `await plainday.TaskIds.linkBackPass({ write: true })` writes them; its `left` must come back empty and its `old` 0.
- **Typing them by hand,** with the plugin off: ⋯ is U+22EF and ↗ is U+2197, and neither is on a keyboard. On a Mac, Edit → Emoji & Symbols (⌃⌘Space) finds them by "midline horizontal ellipsis" and "north east arrow". A text replacement types them anywhere: in System Settings → Keyboard → Text Replacements, add one each (say `;nn` for ⋯ and `;ff` for ↗); with iCloud they reach an iPhone too, or add them there under Settings → General → Keyboard → Text Replacement. The commands write both for you.
- **Only the links that end a line count.** A link in the text is part of the title, even a link to a project, and even with a ⭕: `Ask [[Kestrel Outfitters 2026]] about dates` counts toward no project. A block ID after the links (see *A task's ID* below) doesn't count as text, and the scripts keep it last. The links at the end are what *TrailingLinks* draws on the right, and what the time report reads.
- **A line keeps its project next to its note.** A line in a periodic note that links a note also links the project or area the note is filed in: a copy of what the note's folder says, so the line says its project in text, and the project shown on the right is a link you can open. The ⭕ is what counts: a line with a ⋯ and no ⭕ is Unassigned, and isn't listed. A line outside a periodic note gets no ⭕: its note's folder says the project. Every command that writes a note link keeps them together, on every line of the task it can find:
	- *Add note* puts the ⋯ on every line of the task, and files the note where the line says, or gives the task the note's project. The Log template does the same for a log note.
	- *Add project link* changes the task's ⭕ on every day, and moves its note along, with the task note or log it's a subtask of.
	- *Move to project* moves a note, and the ⭕ on every line of its tasks and subtasks follows.
	- A note moved by hand (a drag, *Move file to another folder*) leaves its lines' ⭕ behind for now. Where a line and its note disagree, nothing decides: the line's time counts toward neither project until you fix it, and the report lists the line under Problems.
- **A nested task carries no marks:** no ⭕, 🗃️, 🚩, ⋯, ↗ or task ID. It's part of its task, so they'd count for nothing, and the report lists them.
- **A task's ID threads one task across days:** every line of the task, on every day it was sent to or worked on, ends with the same ID, so a search for it finds the whole history and the time report can check the lines agree. The ⋯ is the task's note, when it has one; a forwarded line keeps it, so that note's backlinks show the history too. In the demo, *Draft homepage wireframes* is worked on 9/14 and 9/15, and both lines carry `^w2h5nf`, with a task note as well.
- **A task's ID** is a block ID at the very end of the line, such as `^k3x9m2`: six lowercase letters and digits. It marks the line as one of a task's lines.
	- *Schedule* adds it the first time a task is sent out of a note that isn't a periodic note, or forwarded after being worked on, and gives the new line the same one. A task that only moves, from a daily note, a weekly one and so on, gets none. Moving a task again keeps it.
	- A block ID you added yourself (*Copy link to block* makes one, even with capitals and dashes) is the task's ID, and is kept, unless another task's line has it too. Sent from a note for the first time, a line whose ID any line in another note has gets a new one, and *Schedule* says so; a day's line forwarded after being worked on gets a new one when no sent line has its ID and another open line in a periodic note does, or when every other line with it is outside the periodic notes and was never sent. With a sent line carrying the ID, a second open line is a copy of the task (or a sent line a click turned back into `[ ]`): the ID stays, and the checks list the task as open twice.
	- Copying a line copies its ID. If the copy is the same task, leave it; if it's a new task, take the ID off the copy.
	- In Live Preview, *TrailingLinks* hides the ID until the cursor reaches the end of the line; a second End or the arrow keys show it.
- **Order:** the text, the 🚩 due date, the forward date, then the ⭕ or 🗃️, then the ⋯, then the ↗, then the task's ID, which ends the line. On an event line it's the title, ℹ️, 🆓, any ⭕, then the log's ⋯, as the calendar sync writes it. Lines written before (the note link, then the ⭕) are still read, and the scripts write them the new way when they change them.

**How they look.** In Live Preview, the *TrailingLinks* startup script draws these links small, at the right of the line's last row, the way Things shows a deadline. Only the display changes; the line stays as it's written.

- **Which links:** only 🚩, forward date, ⋯, ↗, ⭕ and 🗃️ links at the end of a task or event line, ahead of the task's ID if it has one. A person, a link in the middle of the text, or an old event whose title is its log link stays where it is.
- **On screen:** the project or area first, then the due date, the forward date, and the notes at the edge, its ⋯ and then the ↗, so the last mark names where the task came from.
	- A ⭕ or 🗃️ shows as the project's shortest name, its file name or a plain alias (never a `⭕.Area.Project` one), in faint text.
	- The due date is faint, and turns red once its day has passed. The forward date is faint too, and shows just its date.
	- A task's ID isn't drawn: it's hidden until the cursor reaches the end of the line. Shown on a line with links, it's drawn last, faint, after them at the right edge.
- **Wrapping:** when the links don't fit after the text, the text's last word wraps with them. The other rows keep their full width.
- **Keys and clicks:**
	- A click opens the link, and ⌘-click or a middle click opens it in a new tab.
	- End and ⌘→ stop at the end of the text, ahead of the links and the ID, and a second press goes to the end of the line, after the note links. On a line with an ID, that press goes past it, and the ID shows while the cursor is there: after the links, at the right edge, so ← from there moves back into the links. On a long task that wraps, only the row where the text ends has the extra stop. Shift-End and Shift-⌘→ select the same way. In Source mode, one press goes to the end of the line.
	- Enter at the end of the text acts as at the end of the line, so End, then Enter, starts a new task below, and the links and the ID stay on their line. Anywhere else in the text it splits the line as usual, and the links and the ID go with the new line; in Source mode it does that at the end of the text too. Text typed just after the ID (a click right of the line puts the cursor there) goes in at the end of the line's text, ahead of its links, so they're still read; on a line with no links, just before the ID. Pasted text goes there too, its first line there and the rest after the ID; pasted before the ID, it's left as it is. On a task with no text yet, what's typed gets a space of its own after the checkbox, so the box stays a box. This holds in Source mode too.
	- **Limits:** Shift-Enter at the end of the text, Forward Delete there (it deletes the hidden space) and joining the next line onto an ID line can leave an ID Obsidian no longer reads. A joined line is listed under Problems, as text after its ID. After Shift-Enter or Forward Delete, Problems only shows it for a task sent from a note, whose forward date then points where the task isn't; a task that has only moved between days isn't listed.
	- → from the end of the text opens the first link for editing, and the line reads as its markdown until the cursor leaves the links.
- **Elsewhere:** source mode and reading view show the links as written.

### Links at the start of a line: older sent lines

Before task IDs, a sent line had a link to the day (or week, month, year) it was sent to as the **first** thing after the checkbox, a breadcrumb on `[>]` lines in notes that aren't daily notes. The scripts now write that link at the end of the line, as the forward date (see *Links at the end of a line*), and still read the old form.

```markdown
- [>] [[2026-09-18|9/18]] Sign-off call on Friday
- [>] [[2026w41|Wk of 10/4]] Book the photographer
- [>] [[2026-09|Sep. 2026]] Collect member photos for the October issue
- [>] [[2027]] Plan the spring sale
```

- **Schedule rewrites an older line when you schedule it again.** It matches the line to the task's open line on that day, the one line with the same title that links back to this note, and writes both the new way: the text, the forward date, the ID. If that day's line was worked on and forwarded since (it's `[>]` and has an ID), the older line takes that ID instead, with its forward date pointing where the task is now (its open line, or its done line), and the task's open line moves from there. With no single match it's treated as a first send. Moving or forwarding the task from its day leaves the older line as it is.
- **The time report doesn't flag an older line** as a forward-date Problem. It has no ID to check.
- **The calendar sync's forwarded events** keep the date in front until they move to the new form (OBS-183). Schedule won't touch a forwarded event.
- A day's alias is `M/D`, with no year and no leading zeros; a week's is `Wk of M/D`, a month's its short name and year (`Oct. 2026`), and a year is linked by its name alone.

### What Schedule does to a line

| Scheduling from… | The original line | The new line on the target day, week, month or year |
| --- | --- | --- |
| A daily note, task **not** worked on | Removed along with its sub-bullets (it moves) | Same line and sub-bullets, with its ID if it has one |
| A daily note, task worked on (time entries under it) | Stays as `[>]` with its time entries, finished nested tasks and notes, and gets the task's ID last (a new one, or the line's own); no forward date | `[/]`, same text, ⭕, any ⋯ and ↗, the same ID, with its open nested tasks; no task note is made |
| A weekly, monthly or yearly note | Removed along with its sub-bullets, even if worked on | Same line and sub-bullets, with its ID if it has one |
| Any other note (log, task, project…) | Becomes `[>] text`, the forward date of where it went (`[[2026-09-18#^k3x9m2\|9/18]]`) and the task's ID; its finished nested tasks and notes stay under it | `[ ] text [[Project\|⭕]] [[Source#^k3x9m2\|↗]] ^k3x9m2`: the ⭕ for its own note's project when it has a ⋯ (which comes before the ↗), else the source's project, finished or not, and from a note in no project (the `Inbox`) no ⭕; a ⭕ it had in the source gives way. Or `[[Source\|⭕]]` / `[[Source\|🗃️]]`, and no ↗, if the source is a project or area. The same ID, with its open nested tasks |

- **On a nested task, Schedule schedules its task**: the line at the top of the nest, whatever line under it the cursor is on, in any note. The notice names the task (`Forwarded "Garden club" to 9/19`).
- **Everything nested under a task is part of it:** a note or a nested task. A task that moves takes all of it along. A worked-on task forwarded from its day goes as `[/]`, since work was done, and takes its open nested tasks (`[ ]` or `[/]`) with everything under each; its time entries, finished nested tasks and notes stay with the `[>]` line on that day, and so does an open nested task with time typed under it. Time is read as the report reads it: an entry, a running clock, or a range the report lists under Problems, not a time in a line's text. Blank lines inside the task don't travel: a move leaves them behind, and a forward from a day, or a send from another note, drops them.
- **A week, a month or a year** (`next week`, `next month`, `next year`, `w41`, `oct`, or a note's own name; see *Typing a date*) sends the line to that weekly, monthly or yearly note instead of a day. From there it's scheduled to a day when its time comes, and it moves whole, nested tasks and all.
- Scheduled lines go to the end of the target's first checklist. A weekly, monthly or yearly note with no checklist gets one, just above `## Time Report` (or at the end before there's a report): a line never goes inside the report. A note that doesn't exist yet is created from its template, a period's the way *Jump to date* creates it, before anything moves: if it can't be made, the line stays where it was.
- **Time entries stay where they were logged.** A worked-on task's entries stay on the original line in its daily note, and count toward the time report on that day; the new line carries none. *Toggle time entry* only times tasks in today's daily note, so schedule the task to a day before timing it.
- A line's 🚩 due date, ⭕, ⋯, ↗ and ID go with it, to a period as to a day.
- **Both lines carry the task's ID; no task note is made.** The ID ties the sent line and the new one together, so a worked-on task needs no task note to be followed. A task note you added yourself stays on both lines.
- **Schedule on a task that was already sent moves the task's open line.** On a `[>]` line (a sent line in any note, or a day's forwarded line), the prompt says "Scheduled for Thu 10/8. Move it to": the task's open line goes to the new day and every forward date of the task follows it. If the open line is gone, a fresh copy goes. A source clicked back to `[ ]` (it still has its forward date; with *CheckOff* running, a click on its `[>]` box asks first), or ticked done or canceled, and scheduled again goes back to `[>]` and moves the task's open line the same way; it goes back to `[>]` too when the move is refused or the task is already on that day.
- **Scheduling a finished task reopens it,** from any of its lines or a line under one, onto its own day too. A done or canceled line is sent like an open one: `[/]` on the new day when the task has time logged on any of its lines, `[ ]` when it has none, so a task canceled before any work isn't shown as started. Schedule on a sent line whose task is done on a day asks "Done on Thu 9/17. Reopen it on", and that day's line moves the same way. The task's other done or canceled lines become `[>]`, with the forward date where they had one. Picking the day the task is already on says "Already on" (a done or canceled line there reopens instead), and points the task's forward date there if it pointed elsewhere (its open line moved there by hand, say).
- **Onto a day that has one of the task's `[>]`, done or canceled lines,** that line reopens rather than a second line with the same ID being added: `[/]` when the task has time logged on any of its lines, `[ ]` when it has none. It takes everything the line being moved says, since that's the newer word: its wording, its ⭕ or 🗃️, its 🆓, its 🚩 deadline (one taken off stays off), its ⋯ and its ↗. It keeps that day's time entries, and its own ⋯ when the moving line has none. The moving line's sub-bullets go under it. So if you changed the moving line's project or 🆓 before scheduling it back, that day's time now counts and bills that way, and the notice says where it counts (`Reopened on 9/18; that day's time now counts toward Block Party Poster`). If that time was already on an invoice, the report lists it as a billed entry that changed. Onto a day where the task is open already, nothing moves.
- **A nested task with an ID of its own** (scheduled on its own before nested tasks were part of their task) goes or stays like any other nested task. Its ID travels as text: its own forward dates aren't updated, and if the day it moves to already has a line with that ID, it moves anyway. The report lists the ID as a mark on a nested task, for you to tidy.
- **A task line nested by hand** under another task is part of that task, whatever ID it ends in. Schedule reads only the lines at the top of their nest as a task's lines, on every day: with the task's open line nested away, Schedule on its `[>]` line writes a fresh copy, and the report lists the nested line's ID as a mark on a nested task.
- **Write order:** Schedule writes the destination first and takes the line out of its note last, so a failed write can't lose the task. If the note it goes to can't be made or written, the line stays where it was.
- **A block ID of your own** that another task's line has too isn't this task's: the task gets a fresh ID and a notice says so (see *A task's ID*).
- While Obsidian is still indexing the vault at startup, Schedule says so and does nothing.
- Scheduling a line into the note it's already in changes nothing, and says "Already in this note", unless it's done or canceled: then it reopens there.
- **A `[>]` line with no ID** (a hand edit: Schedule always writes one) is never taken off its day. Schedule gives it an ID and the forward date to where the task went, as a line sent from a note gets, and the new day gets an open copy with the same ID. An open line of the task elsewhere, which nothing links, is left as it is.
- **Events can't be scheduled:** on an event line, or a line under one, Schedule changes nothing and shows "Events must be moved in your calendar app" ("This event was canceled in your calendar" for a canceled one). That holds for every form of event: a `[<]` line, a `[>]` or `[-]` line the calendar sync wrote, and a meeting line in the form days used before August 2025 (`11:00am [[Team Meeting]]`, at the left edge with no checkbox).

### Checking off a task

A task sent out of a note has two lines: its source line, `[>]` in the note it was sent from, and its open line on a day, or in a weekly, monthly or yearly note. *CheckOff* keeps the two in step, so a tick on either one checks off the task. Nothing moves: a tick says the task is done, not when, so each line is finished where it is. To finish a task on another day, *Schedule* it there first, then tick it.

- **Ticking the open line** checks off the source line too. Ticking *Send final copy to Rafe* on 9/17 makes *Write brochure copy*'s line `- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe`: its forward date names the day that shows the task done.
	- An earlier day's `[>]` line (the task was worked on there, then forwarded) stays `[>]`, so only one day ever shows the task done.
	- A task with no source line, one that only moved between days, has nothing else to change: the tick is just a tick.
- **Ticking the source line** ticks the task's open line where it is, with its time and everything nested under it, on a past or future day as on today. The source's forward date names that day. In the demo, *Revisions from Rafe* in *Write brochure copy* was finished this way: its line on 9/16 is done, and the source's forward date names 9/16.
- **Canceling** (`[-]`) either line works the same way.
- **Unticking puts both back.** Unticking the open line sets the source back to `[>]`. Unticking the source line sets it back to `[>]` and opens the done line again where it is: `[/]` when the task has time logged on any of its lines, `[ ]` when it has none.
- **No notice:** changing the task's other line says nothing, since it's what you asked for. A notice appears only when a line moves (*Reopen today*, below) or when a write can't be made.
- **A click on a `[>]` box asks first.** A click turns any mark but a space into `[ ]`, which would leave the task open in two places. So a click on the `[>]` box of a task that's still open on another line asks whether you meant done or canceled, with the box held at `[>]` while it does. ⌘⏎, and Task Status setting *to-do* or *incomplete*, ask the same way. The question says where the task is scheduled, in *Schedule*'s words ("This task is scheduled for Thu 9/17. What would you like to do?", "… for Sep. 2026. …"), and shows the task's name under it. Its buttons, left to right:
	- **Do nothing** (or Esc): nothing changes.
	- **Cancel it:** cancels the task, as canceling the source line does.
	- **Mark done** (highlighted, so Enter): checks off the task, as ticking the source line does. Clicked on an earlier day's `[>]` line, that line stays `[>]` with its time, and the open line is ticked where it is.
	- Moving a task stays *Schedule*'s: the question has no button for another day.
- **A finished task:** a click on a `[>]` line of a task that's done or canceled elsewhere asks a smaller question, "This task was completed on Tue 9/15. What would you like to do?" ("… canceled …" for a canceled one), with **Do nothing** (highlighted, since a click there is usually a slip) and **Reopen today**. Reopen today brings the task to today's note, open, as *Schedule* moves a finished task to today: the day it was done keeps a `[>]` line with any time logged there, and the forward date follows. A notice says where it went ("Reopened on 11/8"). It never reopens on a past day, which later days may have moved on from. In the demo, reopening *Draft homepage wireframes* from 9/14 leaves 9/14 and 9/15 with `[>]` lines and their time, and puts the task on today, `[/]`.
- **No question when the meaning is clear:** a `[>]` box set to `[x]` or `[-]` (by Task Status, by typing `x` over the `>`, or by ⌘⏎ over several lines that ticks them all) is Mark done, or a cancel, at once.
- **Several lines at once:** when ⌘⏎ or Task Status changes several selected lines and would open a `[>]` box among them, the other lines change as usual, the `[>]` boxes stay `[>]`, and each of them is asked about in turn. A held line keeps whatever else the edit did to it, such as a pasted line's new wording; only its box stays `[>]`. An edit that both opens a `[>]` box and adds or takes out lines around it can't be held apart, so it goes ahead as Obsidian makes it, with no question.
- **Where it changes only the line:** a line with no task ID (a `[>]` line from before task IDs, a calendar event), a nested line, a box in a callout, a line outside the Planner, `Projects` and the `Inbox`, a task with no open or done line left (its open line deleted by hand), a `[>]` line of a task already finished elsewhere (an earlier day's, or its source line) set to `[x]` or `[-]`, and Obsidian's *Cycle bullet/checkbox* command. A box in a note embedded in another (`![[…]]`) changes only its line, in either view. In a hover preview or a canvas card, a click changes only its line until you click into it to edit; once you do, a click on a `[>]` box asks as in a tab, but other ticks there may still change only their line, since *CheckOff* reads the note as its tabs show it. The report lists a task left done on one line and open on another.
- **Reading view works the same.** In reading view (⌘E, or the book icon at the top right of a pane), a click on a box, or a tap on the phone, checks off, cancels or unticks both lines, and a click on a `[>]` box asks, with the box held at `[>]`. *CheckOff* stops the click before Obsidian sees it and writes the box itself, so the box changes a moment after the click. A second click before the box has changed does nothing more. A line that changed just before the click (a change from Sync, say) gets nothing written, and a notice says so. The lines above that change only the line do so here too, and so does a box a plugin draws in a code block, such as a query's results.
- **A long press** opens Task Status's menu and gets no question: *CheckOff* leaves a click alone while a dialog is open. What you pick in the menu counts like any other change to the box, in either view. In reading view the menu writes the note itself, so picking *to-do* or *incomplete* on a `[>]` box shows that mark for a moment, then `[>]` again, and the question opens.
- **Only your own edits count:** a click, a key, Task Status's menu, typing or ⌘Z, in the editor, and a click or Task Status's menu in a tab's reading view. A change that arrives through Obsidian Sync, from disk, from the system's own scripts, or in a second pane on the same note isn't acted on, so a tick is acted on once, on the device and in the pane where you made it. The one exception: Task Status's menu in reading view writes the note itself, so a change of boxes alone that reaches that note while the menu is open, or in the two seconds after it closes (from Sync, a save from another pane on the same note, or the system's own write), is taken for the menu's, and what you pick then changes only its line. On a device where *CheckOff* doesn't run, a tick is just a tick, and it isn't acted on when it syncs to one where it does: the report lists the task, and a tick there puts it right.
- **⌘Z** is an edit like any other, in the note you press it in: when it turns a done box open again, the task's other line follows. ⌘Z and ⇧⌘Z on a `[>]` box never ask, so the undo history can't get stuck there. *CheckOff*'s own change in a note is a step of its own there, so ⌘Z right after a tick or Mark done takes that step back first (the source's forward date, or its box), not your tick, and ⌘Z in the other note can undo *CheckOff*'s write there. Either leaves the task's lines disagreeing, and the report lists it. Undoing in both notes at once isn't there yet.
- **Writes check first:** each line is written only while it's as it was read, and a line that changed while the question was open gets nothing written. Reopen today moves the line as *Schedule* does, writing its new place first and taking it out of its old one last, so a failure part-way leaves a disagreement the report lists, never a lost line.

### Log notes

- Named `YYYY-MM-DD Title`, or `!today Title` for today. Made from an event, the title is cleaned for a file name the way CalNav does it: `Sync: Q3` becomes `2026-09-14 Sync - Q3`, and characters a file can't be named with are dropped. The event's own title stays as it is. A note with that title gets the Log template, with properties `parent`, `series`, `topic`, `date`, `time`, `endTime` and `who`.
- **Filed by project:** the log goes into its project or area's `›logs/` subfolder (made if missing), and `parent` is filled. The `›` (U+203A) in front sorts the folder above the project folders in Notebook Navigator, and a folder the system makes gets Navigator's history icon. A folder named `logs`, from before, isn't read: rename it `›logs`. When its event line's `[[Project|⭕]]` or `[[Area|🗃️]]` links name one project or area, that's where it goes, and the link stays: the line and its log say the same. Otherwise it waits in `Inbox`, with no `parent`, and the line as it was: no template asks for a project. File it afterwards with *Add project link* on its line or *Move to project* on the log; either moves it into the project's `›logs/` and sets the line's ⭕, and its `parent` is updated on the move.
- **Every log has a line in its daily note.** Made from a calendar event (*Add note* on its line, which adds the `[[YYYY-MM-DD Title|⋯]]` link and makes the log), the log takes `time` and `endTime` from the event line: its start, and the end time on the line under it, or the last time of the entry that replaced it. (`endTime` is text, like `time`; `end` would be a date property.) Typed as `YYYY-MM-DD Title` or `!today Title`, the template links the event line whose title matches, and takes its times the same way. With no such line it adds a `[<]` line with no time and leaves both properties empty until the calendar sync brings the event; the demo's `2026-09-18 Printer call` is one.
- A name a log already has opens that log instead.
- The event's link keeps working wherever the log is filed, because links go by note name.
- **Action items** are checklist items inside the log. Schedule them from there: the log keeps `[>] … [[date#^id|M/D]] ^id` and the daily note gets the task, with the log's ⭕ and a ↗ back to the log.

### Getting around

- **Today's daily note:** Daily notes' *Open today's daily note*, on a hotkey of your choice.
- **Previous and next daily note:** Daily notes' commands, or Notebook Navigator's calendar.
- ***Plan*** ("Plainday: Plan"): opens the next 2–5 days side by side, starting from the day you're on, or from today.
- ***Jump to date*** ("Plainday: Jump to date"): type a date in words and open its daily note, or its weekly or monthly note for `next week` or `last month`.
- **On a list line:** in Live Preview the cursor rests after the bullet, number or checkbox, never in front of them, so a checkbox stays drawn. ⌘←, Home and a click land at the start of the text, and ← from there goes to the very end of the line above, folded or not. → from the very end of a folded line goes straight to the line below it. Shift-arrows can still select the bullet or checkbox, and Source mode stays raw. End and ⌘→ stop at the end of the text first (see *Links at the end of a line*). The *ListCursor* startup script does this; the idea comes from the *Stick the cursor to the content* setting in [Outliner](https://github.com/vslinko/obsidian-outliner).

### Calendar sync

Two parts, no AI. `Config/Scripts/Calendar/fetchCalendar.swift` reads the Mac's calendars (every account, including iCloud and subscribed ones) into `calendar-events.json` beside it, and the *Sync calendars* command writes them into daily notes.

- **On the Mac**, the command runs the fetcher itself, so **Plainday: Sync calendars does the whole job.** On a phone there's no EventKit, so it applies whatever the Mac last fetched and Sync carried over.
- **On a schedule:** `sync-calendar.sh` syncs from a terminal, or from launchd at 7:15am, 12:15pm, 5:15pm and 9:15pm (`sync-calendar.sh on` / `off` / `status`). It asks Obsidian to run *Sync calendars*, because only Obsidian has permission to read the calendars; a job launchd starts has none of its own. When Obsidian isn't running, it opens it in the background (`--no-launch` skips that); if that fails too, it falls back to fetching the events file, which Obsidian applies at its next sync. It names its own vault in every CLI call, so it can't reach another vault that's open. `status` says whether the schedule is on, how the last run exited and the last log line; the log is `~/Library/Logs/calendar-sync.log`.
- **What syncs is yours to choose.** `Config/Calendar Sync.md` lists every calendar as a checkbox, grouped by account; tick the ones you want. New calendars appear unticked, a calendar missing from a fetch keeps its tick, and the note also carries the last run's report. The note isn't in the repository: it's made on the first run, from your own calendars.
- **How far ahead is yours too.** The note's `Sync range:` line takes 1, 2 or 3 weeks, or 1, 2, 3 or 6 months. Edit the line to change it: *Sync calendars* reads it on every run, so a scheduled run never waits on a prompt. Days beyond the range are left alone: shortening it hides nothing and deletes nothing.
- **Its record:** every line it writes is recorded in `calendar-sync.json`, keyed by the event's ID (plus the date, for one occurrence of a repeating event). Both JSON files sit in the Calendar folder rather than hidden, because Obsidian Sync skips dotfiles and the phone needs the events file. Don't edit them by hand.

**Lines it keeps current.** An event line it wrote, and you haven't touched, is its to keep current: when the event changes or moves in the calendar, the line changes or moves.

- **Three additions don't count as touching it:** `[[Project|⭕]]` links after the title, a link to its log at the end (`Planning call [[Kestrel Outfitters 2026|⭕]] [[2026-09-20 Planning call|⋯]]`, before the ⭕ or around the title on older lines), and time entries under it (with notes nested under them), beside or in place of the end time. The sync keeps updating such a line and puts your additions back.
- **New time or title:** the line is updated and keeps its ⭕ links, log link and time entries. A rename changes only the title; the log keeps its name. A line whose title is wrapped in its log link is written with the ⋯ at the end instead. Time entries are never changed, so when the time moves on a line that has them, the report adds "check its time entries".
- **Moved to another day:** the ⭕ links and log link go to the new day's line. Time entries stay on the day they were worked: a line with time entries is forwarded, and keeps its links too. A line with only links is removed once the new day's line has them; if it doesn't (that day already had a line for the event, say), the old line is forwarded instead.
- **Free events get ℹ️:** a timed event whose Show As is Free is written with ℹ️ after its title, and the mark follows the calendar (busy → free adds it, free → busy takes it off, reported as *now free* / *now busy*), keeping the ⭕ links, log link and time entries. Tentative and unknown (birthdays, subscribed calendars) count as busy; all-day events get no mark. The mark is the sync's: take it off or add it by hand and the line is yours. Days already past aren't touched, so mark an old event by hand.

**Lines you've made yours.** Add anything else (notes that aren't time entries, a second note link, a title wrapped in a link to anything but its log, a different title, a checked box) and the line is yours.

- If the event then moves to another day, the sync forwards your line (`- [>] [[2026-09-20|9/20]] 1:00pm⇥Planning call`, notes and all) to just below that day's other events, and writes a fresh event line on the new day with the line's ⭕ links. Schedule won't touch a forwarded event.
- If an event you've edited changes its time or title, your line stays and the report says so.

**Canceled, renamed, adopted.**

- **Canceled or deleted in the calendar, the line stays, marked `[-]`**, as a record of what was planned, with its links, time entries and notes, whether or not you'd touched it. The sync can't tell a deletion from a cancellation: an event gone from a day it fetched counts as canceled. The report lists it under *Canceled*. If the event comes back (restored, a fetch that missed it, or deleted and made again), `[-]` turns back into `[<]` and the line is kept current again. A `[-]` you typed yourself is never turned back, and a line you'd marked some other way (`[x]`) is left as it is. Schedule won't touch a canceled event. The demo's 9/14 haircut is one.
- **An event whose ID changes** (moved to another calendar, say) keeps its line: the "new" event takes it over rather than the old one canceling it, and the line gets the new event's end time if you haven't added anything but links and time entries.
- **A log's line with no time** is adopted when its event arrives: written in the sync's shape with its log link, ⭕ links kept, anything under it kept below the end line. Whenever the sync writes a line that links a log (adopted, retimed, moved), the log's `time` and `endTime` are set from the line, so a log always says when its meeting is (*log times updated*). An all-day event sets no times. Only a log gets times (a note tagged `log`, or in a `›logs/` folder): a ⋯ on an event line that points at another note leaves that note alone.

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

Obsidian saves folds separately on each device, and forgets a note's folds when something outside Obsidian changes it: the calendar sync, or Obsidian Sync bringing edits from another device. Three of the system's scripts keep daily notes folded the way Schedule leaves them: your folds stay, and only what was added gets folded.

- Each device keeps a **snapshot** of the daily notes it has seen: each item with sub-bullets, where it was, and whether it was folded. Snapshots live in Obsidian's local storage on that device, beside its own fold records, so nothing is added to the vault. Snapshots of notes more than a month old are dropped.
- ***RefoldOnOpen*** (startup script, every device including a phone): a daily note whose items are all where the snapshot saw them opens as you left it. One that changed is matched against its snapshot by text: items you'd folded stay folded, items you'd opened stay open, and new items fold. An item that only moved, or whose text changed, counts as new. With no snapshot to go on, a note keeps the folds the device saved for it if they still fit; otherwise it folds everything, which is Schedule's fallback too. Folded is the default. It snapshots notes as you open and leave them, and your open notes as Obsidian quits (desktop only).
- ***SnapshotDailyNotes*** and ***RefoldDailyNotes*** (scripts, not commands) cover notes that are open while something outside Obsidian writes to them: the first runs before the write and the second after. Inside Obsidian, the calendar sync, *Schedule*, *Toggle time entry*, the Log template and *RefoldOnOpen* keep folds through *RefoldDailyNotes* directly. A tool outside Obsidian calls them through the command line's `eval`: `obsidian vault=<vault> eval code="plainday.SnapshotDailyNotes.invoke()"`, then `obsidian vault=<vault> eval code="plainday.RefoldDailyNotes.invoke()"`. The Raycast timer extension calls them around its writes. *RefoldDailyNotes* applies an open note's folds again even when they look unchanged, since text added to the last line inside a fold would otherwise show beside the folded item. Run on its own, it keeps the folds you see and folds the events.

### Rules for agents

- Read this section before editing any daily, weekly, monthly or yearly note, and write lines exactly as the scripts would: the tab after an event's time, the symbol aliases, `M/D` link aliases.
- A line that links a note ends `[[Project|⭕]] [[Note|⋯]]` (or `[[Area|🗃️]]`), with the ⭕ for the project the note is filed in and any `🚩 M/D` before both: keep the note link last and its project next to it. A line *Schedule* sent from a note also ends `[[Source#^id|↗]]`, after the ⋯: the task's line in that note, by its ID. A subtask's line names the project its task note or log is filed in. Never write 🗒️ or 🔗: nothing reads them. Only the links at the end say where time counts; a link in the text doesn't.
- Put nothing on a nested task: no ⭕, 🗃️, 🚩, ⋯, ↗, task ID or time. Those go on the line at the top of the nest. No ⭕ or 🗃️ on any line outside a daily, weekly, monthly or yearly note. A ↗ decides nothing: it only says where a line was sent from.
- Keep events at the top: `All day` events first, then timed events in time order. Add tasks after the last item of the first checklist.
- Don't check off, forward, move or restyle a `[<]` event. Events are moved in the calendar app, not in Obsidian. The calendar sync is the one exception: it moves and removes the event lines it wrote, forwards events and marks canceled ones `[-]`, as *Calendar sync* describes.
- Don't edit `calendar-sync.json` or `calendar-events.json` in `Config/Scripts/Calendar/`; only the calendar sync writes them.
- Don't add or remove time entries: they're the time log, and they change how Schedule treats a task. (The calendar sync writing and removing the end lines of its own event lines is the exception.)
- Don't edit an invoice's Billed entries, or the body of one that's sent or paid; don't write in a timesheet note (the time report rewrites it). Change billing through the *Invoice* command.
- To move a task to another day, week, month or year, follow *What Schedule does to a line*. Don't invent other forms.
- Don't add `id` or `tags` to daily, weekly, monthly or yearly notes.
- **Keep a line's ID at its very end.** A task's ID (`^k3x9m2`) is the last thing on the line, after every link; never put text after it, which makes Obsidian stop reading it as an ID. Don't change or remove one. A block ID you add to a task line is taken as its ID.
- **A line copied to another note keeps its ID only if it's the same task**; otherwise take the ID off the copy. Two open lines with one ID, or a done and an open one, are listed under Problems.
- To send a task on, use *Schedule* rather than editing the forward date by hand: it keeps every line of the task and its forward date in step.
- **To check off a sent task, check off both its lines,** as *Checking off a task* describes: the open line ticked where it is, and the source line done, its forward date naming that line's day. *CheckOff* doesn't act on an edit made from outside Obsidian.
- **Keep a task's deadline the same everywhere:** one 🚩 on each of its lines, with the same date, and the same day as its task note's `due`. Change it with *Due date*, which writes them all; the report lists a task whose deadlines differ.
- When editing daily notes from outside Obsidian while it's open, run `obsidian vault=<vault> eval code="plainday.SnapshotDailyNotes.invoke()"` before and `obsidian vault=<vault> eval code="plainday.RefoldDailyNotes.invoke()"` after, so open notes keep their folds.
- Older daily notes may use an earlier layout (`## Meetings` and `## To Do` headings). Leave them as they are; don't convert them.

## Invoices

The **Invoice** command bills a project's time as an invoice note, and moves the invoice along from draft to paid. The note is the invoice: Obsidian's *Export to PDF* prints it laid out like an invoice, and without the system it's still readable as one.

### Making one

Run *Invoice* on a project note (anywhere else, it asks which project has time to bill, or a flat fee to mark earned).

1. **Bill through:** a date in words, starting at `today` (see *Typing a date*). A month and day without a year is the closer one, this year's or next year's, since you bill work behind you as often as a few days ahead: in October, `9/16` is last month's. The dates *Mark sent* and *Mark paid* ask for work the same way.
2. **What it would bill:** the project's ended, billable time on no invoice yet, through that date, for a project billed by the hour (a `rate`, with `rate_type` `hourly` or empty, its own or its parent's). With `include_subprojects` on, its sub-projects' time too. When there's none, it says so, and when the next unbilled time is: `Nothing unbilled on Kestrel Outfitters 2026 through 9/6. The next unbilled time is on 9/14.` Time held back (below) isn't unbilled time, so the demo's changed 9/11 entry is skipped.
3. **The confirmation** shows:
	- **Fix first?** the Problems in that time (running clocks first), billed entries that changed since their invoice, and every billed entry missing from its daily note on any invoice, whatever project you're invoicing, since nothing says where that time went. One whose project isn't the one you're invoicing names its project (the row's own, so a sub-project's time on its parent's invoice names the sub-project): `Kestrel Outfitters 2026's 1001-KES (paid 9/15): 8/27/26 1:00pm - 3:10pm 'Kestrel Outfitters proposal: scope and estimate' was billed, but now it's missing from the daily note; put it back there to settle it`. A link here closes the confirmation without making the draft, and opens its note;
	- **Held back:** entries it won't bill, and why (below);
	- **Not billed by the hour:** sub-projects left out;
	- **To bill:** the dates, entries, hours and total, and a warning when it takes the project past its `max_hours` or `contract_max`.
   *Create draft* (or *Create anyway* when there's something to fix) writes it; Cancel doesn't. The confirmation's text can be selected and copied, so a missing entry's task and note can go straight back into its daily note.
4. **The draft** goes into the invoice folder (below), named with its number and the code of the note it bills (below): `1001-KES`. A *Before sending* callout at its top, which doesn't print, lists its entries' Problems, its project's billed entries that changed or are missing, and what was held back. Another project's missing rows stay in *Fix first?* only: they're about another client's invoice. Its number is one past the highest ever given in the vault, so a number is never used twice, even after its note is deleted.

**A flat fee** can't be invoiced yet. Run on a flat-fee project, *Invoice* asks the day the fee was earned instead, in words like *Bill through*, and sets `earned` on the project's note; the time report then counts the fee in that week's, month's and year's Earnings (see *Earnings in weekly and monthly notes*). Run again, it changes the day. A day still to come is fine, for a fee invoiced ahead: it counts at once, in its period, and the project's summary shows the date, so a year read wrong (`2/1` typed in October is next year's) is easy to spot. On a sub-project that's part of a flat fee set above it, it names that project and writes nothing; on a flat project that invoices its sub-projects' time (`include_subprojects`), it asks which you mean.

It needs your details first: the first run makes `Config/Invoice Settings.md` to fill in (`name`, `address` a line per item, `terms`, `payment_note`, `folder`, `last_number`). That note is yours: *Update Obsidian PM* never installs or changes it. The demo has its own, with invented details.

- **`last_number`:** the highest invoice number given so far, up to 999999. A new invoice takes one more than it, or than the highest invoice note's number if that's higher, and raises it to its own number once the note is made. A new settings note starts at `1000`, so the first invoice is `1001`; set it once to continue the numbers you used before. An older settings note without it, in a vault with no invoices yet, is opened for you to set it.
- **`folder`:** where every new invoice goes, like `Business/Invoices`. Left blank, each goes into its project's `invoices/` folder, and only a project's own folder note can be invoiced. It can't be inside `Config` or `Archive`.

**Who it bills:** one note, whose details head the invoice under *Bill to*.

- **The bill-to,** when there is one: the note the project's `bill_to` links to, else its nearest parent's. A sub-project billed through its parent's agency needs no `bill_to` of its own, even when it repeats its parent's `client`; one with its own `bill_to` is billed there instead, on its own invoices. Its time on its parent's invoice (`include_subprojects`) is billed to whoever that invoice bills.
- **Else the client:** the note the project's `client` links to, else its nearest parent's.
- **From that note** come the invoice's code (asked for once, and saved on that note, not on the client's), its `billing_name` (else the note's name) and its `address`. So with a `bill_to`, numbers carry the bill-to's code.
- **Neither, up the chain:** *Invoice* says the project has no `client` or `bill_to`, and stops. A bill-to that isn't a note yet stops it too. A client that isn't a note stops it only when it's the one billed; with a `bill_to`, the client's link is recorded as written.

### Where invoices live

One folder for every invoice is the better choice: invoices are business records, and a project's folder moves when it's archived. The demo keeps its invoices, and the base, in `Reference/Invoices/`.

- **A base leaves out excluded files.** With `Archive` excluded (Settings → Files and links → Excluded files), an archived project's `invoices/` drop out of the *Invoices* base, and the record of what you've invoiced goes incomplete. So pick a `folder` that's never excluded and never archived, outside `Projects/`.
- **Billing doesn't care where an invoice is.** Invoices are found by their `invoice` tag anywhere in the vault, `Archive` included, and each knows its project from its `parent` link. So nothing is billed twice, numbering continues, *Mark paid* works wherever the note sits, and the time report lists an invoice's changes wherever it's filed.
- **Moving your invoices into the folder** by hand, once `folder` is set, breaks nothing.
- **Name the folder `Invoices`,** without a number in front, like `Reference/Invoices`. Then the base, `Invoices.base`, has the folder's name, which is what makes a file a folder's note in Notebook Navigator (a base counts). Clicking the folder opens the base. The `Projects` folder and `Projects.base` work the same way.
- **The Invoices base** goes in the same folder (`Invoices.base`, beside the invoices), so it opens as a file: from the Quick Switcher or the file list, with its views, sorting and filters on the keyboard. *Update Obsidian PM* puts it there, and moves it when `folder` changes. Until you set `folder`, it stays in `Config/Bases/`. See *Update Obsidian PM* for how its updates arrive.

### The note

- **On the project's note:** the time report lists the project's invoices, and its sub-projects', under **Invoices**: its status in an unnamed first column (✏️ draft, 🕒 sent, ✅ paid, ❌ canceled), then its link, date, period, hours and total, newest first, then a **Total** of all but the canceled ones.
- **Properties:** `parent`, `invoice_status` (draft, sent, paid or canceled), `number`, `client`, `bill_to`, `invoice_date`, `period_start`, `period_end`, `hours`, `total`, `paid`; tagged `invoice`, with `cssclasses: pm-invoice`. The *Invoices* base (`Invoices.base`, beside the invoices) lists every invoice, grouped by status (drafts first, then sent, paid and canceled) and newest first in each: Date, Invoice, Project (the project's name, linked), Status and Total in dollars (`$1,235.00`), with the sum of Total under the rows it shows (filter it to a period to total that period). A **Bill to** column, who each invoice billed, linked, isn't shown by default: switch it on from the view's Properties menu. Obsidian shows only the statuses the view's group order lists, so a status of your own needs adding there, or its invoices don't show. Its Project column reads `parent`, or `area` on an invoice from before the rename; if you've changed your own copy of the base, set its `project` formula to `if(parent, link(parent.asFile().path, parent.asFile().basename), if(area, link(area.asFile().path, area.asFile().basename), ""))`.
	- **`invoice_date` is the day it's sent.** *Mark sent* sets it, and the date the invoice prints, so there's no separate sent date.
	- **`parent` is the project the invoice bills,** set when it's made. *SyncArea* never changes it, so moving the note never changes what it bills.
	- **`client` and `bill_to`:** `client` is the end client, the project's nearest `client` (blank when it has none), and `bill_to` is who was billed: the bill-to, or the client again when there's none, so every invoice says who it billed. *Rebuild* sets both on a draft from the project as it is now, and its Bill to block with them, but never its name: a draft keeps its number and code. To get a new code, delete the draft and run *Invoice* again; it takes the next number. Invoices made before `bill_to` recorded the billed note as `client`, so the base's Bill to column shows their `client`. A copy of the base you've changed doesn't get the column; to add it, give it a `billed` formula, `if(note.bill_to, link(note.bill_to.asFile().path, note.bill_to.asFile().basename), if(note.client, link(note.client.asFile().path, note.client.asFile().basename), ""))`, named Bill to.
	- **`invoice_status` is the invoice's own,** not the `status` projects use. Obsidian suggests a property's values from every note that has it, so one shared property would offer an invoice a project's status, which the Invoice command wouldn't read.
	- **Invoices made before these two** carry `status` and `project` instead. Billing still reads them: an older invoice's `project` decides its project, since its `parent` may have changed with a move. An invoice that says `area` instead of `parent` is read the same way. The *Invoices* base shows their Status blank. *Mark sent*, *Mark paid* and *Cancel* rename `status` to `invoice_status`; on a paid or canceled one, rename it by hand.
- **What prints:** your name and address and the date; under **Bill to**, the billed note's name and address; Project ID, Requested by and Terms when set; Total hours and Total due; then **Billable hours**, a line per date (and per rate, when sub-projects bill at different ones), like `9/14 — Homepage review with Imogen, Draft homepage wireframes`, and the payment note. Nothing printed is a link. In a draft, edit a line's description as you like.
- **Billed entries:** a section at the end, which doesn't print: the invoice's own copy of every entry it bills. Like a timesheet, it has a bold row per date with the day's hours, and that day's entries under it: time, project, task, notes, rate and hours. It's what stops an entry being billed twice and what shows when one changes. Don't edit it: an invoice whose Billed entries don't read, or don't add up to its `hours` and `total`, stops the project's invoicing until it's fixed.
	- **Each entry takes its date from the date row above it,** so each date row's hours must add up to its entries. A deleted date row, or an entry dragged under another day, is a Problem, not a quiet change of date.
	- **It's the end of the invoice:** nothing below it prints.
	- **Folded:** *Invoice* folds it when it makes or rebuilds the invoice, and keeps it folded through *Mark sent*, *Mark paid*, *Cancel* and *Check for changes*. Obsidian keeps folds per device, so on another device it opens unfolded.
	- **Invoices made before** keep theirs in a folded `[!pm-billed]` callout, which still reads; *Rebuild* on such a draft writes the section. A note with both counts the rows of each and lists a Problem.
	- **Its tables are padded,** as the reports' are (see *The time report*), so clicking into one doesn't change the invoice. An invoice made before keeps its tables as they were written; Obsidian pads one the first time you click into it, and Billing reads it either way. They can be frozen too: see *Freezing tables*.
	- Moving an invoice note with the *Advanced Rename and Delete Handler* plugin strips the `\` from the `\|` in its table's links. Billing still reads the table.
- Your details and the billed note's are copied in when the invoice is made, so a sent invoice never changes when they do.

### Moving it along

Run *Invoice* on the invoice note for what fits its status:

| Status | Choices |
|---|---|
| draft | **Rebuild from the daily notes** (through its `period_end`, keeping the descriptions you changed, and billing whoever the project bills now) · **Mark sent** |
| sent | **Check for changes** · **Mark paid** · **Cancel invoice** |
| paid | **Check for changes** |

- **Mark sent** asks for the invoice date, the day you send it, starting at today, and sets it on `invoice_date` and where the invoice prints it. On a draft that no longer matches the daily notes, it offers to rebuild it first.
- **Mark paid** asks for the date it was paid, and sets `paid`.
- **Cancel invoice** marks it canceled: its entries are unbilled again, for the next invoice.
- **Check for changes** writes what changed, and entries logged in its period since, into a callout at the top, which doesn't print. The time report lists every invoice's billing changes on the project's note and its timesheet, a draft's ending *rebuild it*. An archived project's invoices are listed there too, but *Check for changes* and *Rebuild* don't run on them.
- **A draft you don't want:** delete its note. Its number isn't given again, so the numbers skip it.
- The timesheets update right away on the desktop; a status typed by hand shows at the next report run.

### What's billed, and what changed

- **One place:** only invoices record billing. An entry is billed when it's in the Billed entries of an invoice that isn't canceled (drafts count), matched by its day, start and end. Nothing is written into daily notes.
- **Held back:** an entry the invoice won't bill, because it:
	- overlaps a billed entry without matching it (a billed entry you extended: split the new time into an entry of its own to bill it);
	- has a billed entry's times on another project;
	- repeats another entry at the same times.
- **Changed since invoiced:** a billed entry whose times changed (an entry of its project or task overlaps them), that's 🆓 now, on another project now, on a line that disagrees with itself, or under a nested task now, or that's missing: nothing is at its day and times, and no entry of its project or task overlaps them. Billing never guesses that an entry on another day, or at other times, is a billed one moved: nothing in the notes says so. The missing entry stays listed, in every Invoice's *Fix first?* and the error log, until you put it back where it was billed; there's no way yet to set one aside. Wording changes are shown but aren't billing changes. Entries logged in an invoice's period after it was made are listed too; they go on the next invoice.

### The PDF

Copy `Config/Scripts/Style Settings/pm-invoice.css` into `.obsidian/snippets/` and turn it on (Appearance → CSS snippets). Then *Export to PDF* on the invoice prints it without the properties, the Billed entries or the check callout, with any link as plain text. Qty, Rate and Amount stay on one line, as wide as their widest value. On an invoice longer than a page, the column names repeat at the top of each page, and no row is split between two. To be paid through a banking app that can't import invoices, attach the PDF to an invoice made there.

## Commands

The system's commands come from the Plainday plugin, and run from the command palette ("Plainday: Add note"), a hotkey, or the command line with the command's id: `obsidian command id=plainday:add-note`. Each id is the command's name in lower case with hyphens (`plainday:due-date`), apart from *Sync calendars* (`plainday:sync-calendars`). The hotkeys below are suggestions; set them under Settings → Hotkeys. *Complete* is Obsidian's own checklist toggle (`⌘⏎`).

### Typing a date

*Schedule*, *Due date*, *Jump to date* and *Invoice* ask for a date in words, and Natural Language Dates reads them. The line under the box shows the date they mean as you type (`Fri 10/2 · in 5 days`), and Enter takes it.

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
| `10/2`, `oct 2` | Fri 10/2 | The next 10/2: a date already past this year is next year's, so give the year (`9/1/26`) for one behind you. *Jump to date* and *Invoice* take the closer one instead: `9/16` is 11 days back, not next year's |
| `next week`, `this week` | Week starting 10/4, Week starting 9/27 | The weekly note, for *Schedule* and *Jump to date*. *Due date* takes a day: the first of next week, by your week setting, or today for this week |
| `week of oct 5` | Week starting 10/4 | The weekly note holding that day. *Due date* takes the first day of that week |
| `next month`, `this month`, `next year` | October 2026, September 2026, 2027 | The monthly or yearly note, for *Schedule* and *Jump to date*. *Due date* takes the first day of it |
| `w41`, `oct`, `2026-10`, `2027` | Week starting 10/4, October 2026, October 2026, 2027 | A week or a month in words, or a note's own name (see *Jump to date*). Without a year, *Schedule* takes the next one (`jan` is January 2027, `w5` week 5 of 2027) and *Jump to date* this year's |

### Schedule (`⌘S`)

- Asks for a date (see *Typing a date*) and moves the line (with its sub-bullets) to the end of that day's first checklist. *What Schedule does to a line* has the whole table.
- **A week, a month or a year** (`next week`, `next month`, `next year`, `w41`, `oct`, `2026-10`) sends the line to that weekly, monthly or yearly note instead, never inside its time report. The note is created from its template if it's missing. A week's preview names its note (`Week starting 10/4 · 2026w41`).
- **On a nested task,** or any line under a task, it schedules the task: the line at the top of the nest.
- **From a day, worked on** (time entries under it): the original stays as `[>]` with its time, finished nested tasks and notes, with no forward date, and the new line goes as `[/]` with its open nested tasks. Both lines end with the task's ID (a block ID the line already has, or a new one): `- [>] Draft homepage wireframes [[2026-09-18|🚩 9/18]] [[Kestrel Outfitters 2026|⭕]] [[Draft homepage wireframes|⋯]] ^w2h5nf`. No task note is made; one the line already links stays on both lines.
- **A done or canceled task** is reopened: see *What Schedule does to a line*.
- **From any note that isn't a daily, weekly, monthly or yearly note** (a subtask in a task note, a task in a project note or log): the original becomes `[>]`, with the forward date to the day (or the week, month or year: `Wk of 10/4`, `Oct. 2026`, `2027`) and the task's ID last, `- [>] Sign-off call on Friday [[2026-09-18#^k3x9m2|9/18]] ^k3x9m2`. The new line links back to the task's line in the source with ↗ (`[[Source#^k3x9m2|↗]]`), after its own ⋯ if it has one (a ↗ it had already is replaced), and carries the same ID. Its ⭕ or 🗃️ is its own note's project when it has a ⋯ filed in one, else the project or area the source is filed in, finished or not; a ⭕ or 🗃️ it had in the source gives way, since outside a periodic note a line has no project of its own. From a note in no project (the `Inbox`) nothing takes its place, so the new line has none. A ⭕ in the task's text stays: only the links at the end are its project. If the source keeps a ⭕ that now differs from the new line's, the time report lists the task's lines as disagreeing, so you can fix the source. From a note tagged `#project` / `#area` it gets that note's ⭕ / 🗃️ and no ↗. Example: *Schedule* on *Confirm the product list with Imogen* in *Shot list for catalog*, filed in Kestrel Fall Catalog, writes `- [ ] Confirm the product list with Imogen [[Kestrel Fall Catalog|⭕]] [[Shot list for catalog#^id|↗]]` with the subtask's ID, in the link and at the end. Its open nested tasks go with it, with everything under each, so they're on the day; its finished nested tasks and notes stay under the `[>]` line.
- **Already sent:** Schedule on a `[>]` line moves the task's open line (see *What Schedule does to a line*), and the forward date on every sent line of the task follows.
- **Checking off** a sent task, on its source line or its open line, checks off both, and a click on a `[>]` box asks first: see *Checking off a task*.
- `[/]` tasks keep their marker on the new day.
- Event lines can't be scheduled, nor a line under one: it says "Events must be moved in your calendar app" and changes nothing.

### Due date (`⇧⌘D`)

Asks for a date (see *Typing a date*) and adds ` [[2026-09-30|🚩 9/30]] ` before the links that end the line (the forward date, ⭕, 🗃️, ⋯ or ↗), or else at the end. The task's ID stays last: the 🚩 goes in ahead of it.

- **A line that already has a 🚩** gets the new date in its place, so running *Due date* again changes the deadline instead of adding a second one.
- **Every line of the task gets it:** the lines with the task's ID, and those whose ⋯ links its note, days already worked on and done lines included. Each gets the 🚩 where it would go on the line you're on, an old one replaced. The line you're on changes the moment you pick the date; the others follow a moment later. In the demo, *Due date* with `9/25/26` on 9/15's *Draft homepage wireframes* changes 9/14's and 9/15's lines, which share the ID `^w2h5nf`, and the task's line in Kestrel Outfitters 2026's `## To Do`, which links the note with ⋯.
- **Its task note's `due`** is set to the date too, written as the Task template writes it (`due: 2026-09-25`). Only that line changes, or it's added at the end of the note's properties when there's none, so its other properties stay exactly as they were. A `due` written in a way the Task template and Obsidian's property editor don't (as a list, with a comment on its line, with its key in quotes) is left as it is, and a notice says to set it by hand; so are properties Obsidian can't read. Only a task note in the system gets one: not a log, a plain note, or a project's or area's own note. A task note in `Archive` or outside the system keeps its `due`, and a notice says so, since no command works there; the lines in the system that link it with ⋯ still get the 🚩.
- **A subtask keeps its own deadline.** On a task's line, the subtasks in its note and their days aren't touched. On a subtask's day, *Due date* writes that subtask's lines, the day and its `[>]` line in the note, and leaves the task note's `due` alone: in the demo, 9/17's *Send final copy to Rafe* links *Write brochure copy* only with ↗.
- **Nothing else joins a task's lines,** as for *Add project link*: not a ↗ by itself, a link in a line's text, a nested line, or a line in `Archive` or outside the system. A line with no ID and no ⋯ is a task of its own, and only it changes. An event line among a task's lines gets no 🚩.
- **A task whose deadlines differ** (typed by hand, or one written before *Due date* set every line) is listed under the time report's Problems, naming each date: *Due date* on any of its lines fixes it.
- **No notice when it all went through:** the 🚩 on every line and the note's `due` are what you'd expect. A notice shows only for what didn't happen. A line that changed while *Due date* was writing (a synced edit arriving in that moment) keeps its old date, and so does a note it couldn't write; the notice names each, and running *Due date* again finishes. A task note's `due` left as it is says why, as above.
- **⌘Z** undoes only what *Due date* changed in the note you're in, one change a press: your line's 🚩, and any other line of the task or the `due` in that note. The task's other notes keep the new date; running *Due date* again sets them all to the date you pick.
- **On a nested task,** or any line under a task, the 🚩 goes on the task: the line at the top of the nest, and the task's other lines. A nested task's own 🚩 stays as it is.
- **The cursor stays where it was,** on the same words, whichever line the 🚩 goes on.
- **An event has no deadline:** on an event line, or a line under one, *Due date* does nothing and says so.
- If the line changes while the date box is open, nothing is written, and a notice says so. While Obsidian is still indexing the vault at startup, *Due date* changes nothing and says to try again in a moment.

### Add note

Links a line to a note of its own, of one of two kinds: a **task note** for a task, or a **log note** for an event (*On an event line* below). A task's note gets its ⋯ on every line of the task: `- [ ] Write brochure copy [[Pinecrest Library Brochure|⭕]] [[Write brochure copy|⋯]]`. The cursor stays where it was, on the same words; with a selection, it goes to the end of the selection.

- **On a nested task,** or any line under a task, it links the task's note: the line at the top of the nest, named from its text, whatever the cursor or selection. Under an event, it links the event's log; a meeting line in the form used before August 2025 and a canceled event the calendar sync wrote are events too. An event the calendar moved to another day (its `[>]` line, with the new date in front) keeps its log on its line there: *Add note* says so and changes nothing.
- **Every line of the task:** the ⋯ goes on each line that ends in the task's ID, ahead of any ↗. On a line that already has a ⋯, it puts that note's ⋯ on the task's other lines, which take the note's project as a change does, and says what it did: the lines that now link the project, or that there was nothing to add. So does a line whose task already links a note on another of its lines, unless you've selected a name, or that note is in `Archive` (then this line gets a note of its own, below, and a notice says the report will list the task as linking two notes). A note waiting in the `Inbox` is filed where the task's lines say. A line with a ⋯ of its own is left alone.
- **The name** is the selection. With nothing selected and text after the cursor, it's the task's text up to its first link. A line with only a ↗ has no note of its own yet, and gets one: the ↗ is where it was sent from. With only whitespace after the cursor (a task's hidden ID aside), it inserts an empty link (`[[|⋯]]`) with the cursor inside, to search for a note with another name; the link goes in before the line's ↗ and ID, which stay last.
- **A new note** is made on the spot with the Task template, with no menu. You stay in the daily note. It's filed in the line's project: in a daily, weekly, monthly or yearly note, the one its ⭕ or 🗃️ says, finished or not, or when it names none, the one the task's other lines agree on, where a line in any other note (a task note, log, plain note or project note) names the project that note is filed in; in any other note, that note's project, so a subtask in a task note gets its note in that project, and from then on it's a task with a note like any other. A line with no project gets a note in `Inbox`, unfiled: the line gets its ⋯ but no ⭕, so its time shows as *Unassigned* until you file the note, with *Add project link* on the line or *Move to project* on the note.
- **A date in the name** (`2026-09-30 Renew car registration`) becomes the new note's `due` and comes off the line; with two dates, the last one.
- **A note of that name already there:**
	- in the line's project: it's linked;
	- waiting in `Inbox`: it's filed in the line's project;
	- filed in a project while the line has none: the task takes the note's project;
	- filed in another project than the line's: it asks **A note with this name already exists**, naming the note and its project, since the task will link it. *Move* moves the note to the line's project; *Leave it* leaves the note where it is, and the task takes the note's project, finished or not. For a separate note, press Esc and give the task another name;
	- in `Reference` or anywhere else outside the system, or a project's or area's own note, an invoice or a timesheet: it's linked from this line, and nothing else changes;
	- in `Archive`: it's an old note, so the task gets a fresh note in its project, named with the project so the old days' links keep pointing at the archived one: *Write copy (Kestrel Outfitters 2026)*. With no project, it waits in `Inbox` as *Write copy 2*. The old note is left alone. The task's next line of that name, or a second run after one that stopped short, links the fresh note instead of making another: one named with a project, wherever it's filed, or one with a number while it waits in `Inbox`. A meeting line is the exception: a log of the same date and title in `Archive` is that meeting's own, and it's linked, unless a log of that name outside `Archive` is there too, which is taken instead.
- **It refuses** time on a sent or paid invoice that its change would move or leave counting nowhere, as *Add project link* does, and a line that changed while you were asked. Otherwise it refuses only when the line's project already holds a different note of that name.
- **A line left disagreeing with its note** (its ⭕ names one project while its note is filed in another) counts nowhere until you fix it. *Add note* doesn't stop for that: a notice afterwards names the line, and the report lists it under Problems. So does a line that names a project while its note waits in `Inbox` (its ⭕ names an archived project, say); its time still counts. A line of the task other than yours that takes a project is named too. A notice names only lines the command wrote: one that disagreed already, and that it left as it was, is listed by the report as before.
- **Settling on a project is a change like *Add project link*'s,** a new note included: the whole task takes that project, the task note or log a subtask sits in included, it asks if a note would leave a project or counted time would move, and it stops at time on a sent or paid invoice, before any note is made. On *Leave it*, the notes already in that project stay, and the rest of the task goes there.
- It writes no ⭕ on a line outside a daily, weekly, monthly or yearly note. An existing note's `parent` is set from its folder; new notes get it from the Task template.
- **On an event line** it links a log note instead, at the end of the line after the title, its ℹ️ or 🆓 and any ⭕, putting the daily note's date in front of the name so the Log template picks it up: `- [<] 10:00am⇥Homepage review with Imogen [[Kestrel Outfitters 2026|⭕]] [[2026-09-14 Homepage review with Imogen|⋯]]`. It makes the log right away, the way it makes a task note: through the Log template, which files it by the line's ⭕ or 🗃️, or else leaves it in `Inbox` with no menu. You stay in the daily note, and the ⋯ opens the log. A log of that name already is settled the way a task's note is, above. The name is the selection or, with nothing selected, the title after the time, without its marks, wherever the cursor is on the line. A line that already links a log is left alone, and so is one with no title (a time with nothing after it).

### Add project link (`⌥⌘P`)

Says which project a line's task belongs to, and the task follows. It works on a line in a daily, weekly, monthly or yearly note, or a line under one.

- On a task or event line, asks for a project or area (leaving out finished ones) and writes `[[Project|⭕]]`, or `[[Area|🗃️]]`, in place of one the line already has: before the ⋯ or ↗, or at the end when there's neither. Esc cancels. The cursor stays where it was, on the same words.
- **Every line of the task follows:** the lines with its ID, and those whose ⋯ links its note. Each line in a periodic note gets the new ⭕, days already worked on included, so their time moves with it. A ⭕ for a third project is replaced too.
- **Its own note moves** into the picked project (a log into its `›logs/`), and its `parent` follows (*SyncArea*).
- **A task and everything under it share one project,** so the whole task moves together. Each subtask in its note changes project on every line, and a subtask's own note moves too, with whatever is under that. On a subtask's line, the task note or log it sits in moves, with every line of that task: in the demo, picking Kestrel Outfitters 2026 on 9/17's *Send final copy to Rafe* asks to move *Write brochure copy*, and 9/11, 9/15 and 9/17 all change.
- **Its line in a project note** moves to the end of the new project's `## To Do`, with everything nested under it.
- **Nothing else ties a note to the task:** not a ↗ by itself, a link in a line's text, a plain note a task was sent from, or a project note. The demo's *Brochure kickoff* log names *Write brochure copy* only in its follow-up's text, so it stays where it is.
- **Warn after, never block.** A note in `Archive` stays where it is, since no command works there, and so do a project's own note, an invoice and a timesheet. A line whose ⋯ links one of them still gets the new ⭕, so it then disagrees with its note and its time counts nowhere. Nothing stops the change for that: a notice afterwards names the line, and the report lists it under Problems until you take the ⋯ off or move the note. Time on a sent or paid invoice that would stop counting is the exception, refused like time leaving the project that billed it.
- **It asks once,** before anything is written, when a note filed in a project would leave it, or when time already counted toward one project would count toward another: *Move task?*, *Move log?* or *Move note?*, or *Change project?* when no note moves. Started from a subtask's line, it asks *Moving a subtask requires moving its parent*, and names the task note or log it sits in. The question highlights the one note to decide about (*Move 2 notes?* names each, when there are more), then says in a sentence that its subtasks and their notes move too, and where its time will count. It names no days or lines: the system takes care of every one. When some time would stop counting, because its line will disagree with its note, it says so. That alone doesn't make it ask. *Cancel* writes nothing. Filing a note out of `Inbox` doesn't ask, and nor does a line whose time counted as Unassigned, or a day with no time.
- **It refuses billed time:** after you answer and before anything is written, every entry whose time would count toward another project is matched to the invoices, the way *Billing* matches them. If one is on a sent or paid invoice that billed it to another project, nothing changes, and the notice names the invoice: *Nothing changed: this task's time on 9/11 is on 1001-KES (paid 9/15).* Moving time back to the project that billed it is always allowed, and a draft never refuses. That includes time on a line that disagrees with itself: it isn't counted anywhere until the line is fixed, but fixing it would start it counting.
- **If a write fails,** the notice says so; the report lists what's left disagreeing, and running the command again from any line of the task finishes it.
- **Anywhere else it changes nothing,** before the menu, and says what to do instead: in a project note, a task moves from one of its days, or by cutting and pasting its line into the other project's `## To Do` when nothing is attached to it; in a task note, a log or a plain note, run *Move to project* on the note.
- **On a nested task,** or any line under a task or event, it acts on the line at the top of the nest. A meeting line in the form days used before August 2025 (`11:00am [[2025-03-04 Team meeting|Team meeting]]`) is an event like any other: it gets its ⭕ after its title, and the log its title links moves.
- On an event line the ⭕ goes after the title and its marks, before the log link, where the calendar sync keeps it through updates and moves.

### Move to project (`⌥⌘M`)

Moves the note you're on into a project or area picked from the same menu as *Add project link*, so refiling never means hunting for a folder. It's also *Move to project…* in the file menus (see *MoveToProjectMenu*). To file the note a daily-note line links, use *Add project link* on the line.

- **What it works on:** a task note, a log or a plain note in `Projects` or `Inbox`, and a project or area's own note. On a daily, weekly, monthly or yearly note it says to run *Add project link* on a line. An invoice and a timesheet stay where they are, a note outside the system isn't moved, and a file that isn't a note isn't offered. The file menus leave all of those out.
- **Where it goes:** a log note (tagged `#log`, or in a `›logs/` folder) into the project's `›logs/`, made if missing, so a log left in `Inbox` is filed the way the Log template files it. A project or area's own note takes its whole folder along, sub-projects and logs included. A note tagged `#project` that isn't its folder's own note moves as a plain note: a project needs a folder of its name, with the note inside. Anything else goes into the project's folder. Obsidian's move updates the links, and *SyncArea* sets `parent`.
- **The note's tasks follow:** each task in the note, and each task or event whose ⋯ links it, gets the new ⭕ on every line in a periodic note, and its line in a project note moves to the new project's `## To Do`, as *Add project link* moves them. It asks and refuses as *Add project link* does. The whole task moves together, as with *Add project link*: each subtask's own note goes too, and when the note is a subtask's own note, the task note or log it sits in moves with it. A note linked only in the text of the note's lines stays where it is.
- **A note already in the project you pick** moves nothing, and its lines are still written. That's how you put a note right after dragging it in the file explorer: the notice says it was already there, and what changed.
- **Several at once:** while Notebook Navigator has the focus, it moves the notes selected there, one after another, each a change of its own with its own question. *Cancel* on one stops the rest, and the notice says what had moved already; a billed-time refusal skips only that note. A note inside a project that's moving with it goes along with its project.
- **A project or area** moves as its folder. Moving one asks (*Move project?*, *Move area?*) when it's the only thing moving: its own time stays with it, but a project moved inside another project counts toward that project's totals, and takes its rate if it has none of its own (see *The time report*). Its notes keep their project, so their lines are left alone.
- **It refuses, with a notice:** a name already taken where it would go, and a project into itself or one of its sub-projects (the menu leaves those out, along with project notes that have no folder to hold anything). Archived work is finished and usually invoiced, so bring it back by hand. Esc cancels.
- Finished projects still go into `Archive` by hand: the menu only lists projects and areas under `Projects/` that aren't finished.

### Toggle time entry (`⌘T`)

- **On or under a task or event in today's daily note:** with no running entry, adds `- 9:01am - ` just above the task's first nested task, or after its sub-bullets if it has none, and an open `[ ]` task becomes `[/]` (it stays `[/]` after the timer stops; events and other markers never change). With a running entry, fills in the end time; a `: 🆓` typed on the running entry stays.
- **On a nested task,** or any line under a task or event, the clock is the task's: it starts under the line at the top of the nest, above its first nested task, and that task is the one marked `[/]`. A clock running under a nested task (typed there by hand) stops from the task too. Under an event, the entry goes under the event, and its own span then stops counting (see *Events*).
- **On an entry's line**, that entry is the one. With several running under the task, a list asks which (`Stop 10:30am: Task name`).
- **Anywhere else** (not on a task, a task in another note, reading view, no note open): a list of running timers in any daily note, today's first, then newest day first (`⏱ Stop 11:00pm: Task name · 9/14`), then today's open tasks and events, top lines only: a nested task's clock is its task's. Picking one starts or stops it in its daily note and says what it did; you stay where you are. `⌘↵` goes to the item's line instead. Timing only happens in today's note because the report dates entries by their daily note: move a task to today with Schedule to time it there. Stopping works anywhere.
- **A stop that would make an entry of 12 hours or more** (a timer from another day, or one forgotten since morning) isn't filled in: the entry's note opens with the cursor after `- 9:00am - `, to type the real end. A timer from yesterday evening stopped after midnight still stops.
- `⌘T` replaces Obsidian's New tab shortcut, and Notebook Navigator's first shortcut if you use it.

### Plan

Asks how many days (2–5) and opens that many consecutive daily notes side by side, from the daily note you're on, or from today. Missing notes are made from the template.

### Jump to date (`⌘J`)

Asks for a date (see *Typing a date*) and opens its note in the pane you're in; `⌘↵` opens it in a split to the right.

- **A day** opens its daily note. **`this`, `next` or `last` with `week`, `month` or `year`** opens the weekly, monthly or yearly note, named and filed by Notebook Navigator's week, month and year patterns (else `weeks/gggg[w]ww`, `months/YYYY-MM` and `years/YYYY` beside the daily notes).
- **Weeks** start on the day your settings say (see *Typing a date*), so `next week` is always the week after this one's note. Revived's own weeks start on Monday, which on a Sunday would land in this week's note; *Jump to date* counts the weeks from today instead. A week written with its year (`2026-W41`) is the one holding that ISO week's Monday.
- **A week or a month in words:** `week of oct 5` (or of any date: `week of friday`, or `week starting oct 4`) opens the weekly note holding that day, and the preview says when it starts and names it (`Week starting 10/4 · 2026w41`). `w38`, `wk 38` or `week 38` is week 38, counted the way the weekly notes count, and `sep`, `sept`, `september` or `9/2026` is that month. They mean this year unless a year comes before or after: `w1 2027`, `2027 w1`, `Sep 2027`. (*Schedule* takes the next one instead.)
- **A periodic note's own name** opens it too, spelled the way the patterns spell it: `2026w41`, `2026-10`, `2027`.
- **A quarter** (`Q4`, `next quarter`) opens the daily note of its first day: there are no quarterly notes.
- **A month and day without a year** (`9/16`, `sep 16`) is whichever is closer, this year's or next year's, since jumping goes back as often as forward. Schedule and *Due date* take the next one.
- **With the original Natural Language Dates**, words always mean a day, so `next week` opens a daily note; a note's own name still works.
- **A note that doesn't exist yet** is created from its template after asking: the Daily Note template, or for a period the template Notebook Navigator's calendar uses (else *Weekly Note*, *Monthly Note* or *Yearly Note*). Tick **Don't ask again on this device** to skip the question from then on; while it's skipped, the prompt says so and offers **Ask again**. If a template files the note somewhere other than the pattern's folder (the Weekly Note template moves its note into `Planner/weeks`), *Jump to date* says so: make the two agree, or the next jump won't find the note.
- It replaces the *Natural Language Date* command of the Jump-to-Date plugin, which only works with the original Natural Language Dates plugin. If `⌘J` runs that command, move the hotkey to *Plainday: Jump to date*.

### Convert to project

Turns the selected text into a project: a note of that name from the Project template, in a new project folder at the top of `Projects/`, and a link in place of the selection. With Notebook Navigator, the folder gets the project look and the note is pinned, as for any new project. *Move to project* files it under an area or another project afterwards. It won't run if a note with that name exists.

### Sync calendars

Fetches (on the Mac) and writes the ticked calendars' events into daily notes, as far ahead as the Calendar Sync note's `Sync range:` line says. Changes it held back and lines it couldn't write also go in the error log, with a toast when they're new (see *The error log*). See *Calendar sync*.

### Time report

Refreshes every time report where the numbers changed, in the note you're on too, and each project's timesheet note, then the error log, with a toast when it found new Problems. See *The time report* and *The error log*.

### View error logs

Opens the error log, `Config/Error Log.md`, in the pane you're in: every Problem the time report and the calendar sync found, one line per kind per note (see *The error log*). Before the first time report on the desktop there's none yet, and it says so.

### Invoice

On a project note, makes a draft invoice from its unbilled time through a date you pick. On a flat-fee project, which can't be invoiced yet, it asks when the fee was earned and sets `earned` on its note, so the time report counts it (see *Making one*). On an invoice note, rebuilds it, checks it for changes, or marks it sent, paid or canceled. It never invoices an archived project, rebuilds or checks its invoices, or sets its `earned`: it says the project is archived. See *Invoices*.

### Update Obsidian PM

Installs the system from a local clone of the repository into the vault it runs in. See the README. It also puts the two bases where they open as files:

- **`Projects/Projects.base`** beside the projects, the `Projects` folder's note in Notebook Navigator: an *Active* view (anything not Done, Canceled or On Hold) and an *Inactive* one, each grouped by status.
- **`Invoices.base`** beside the invoices, in the `folder` Invoice Settings names (see *Where invoices live*), else in `Config/Bases/`. When `folder` changes, the next update moves it there as it is, with any sorting or filters you added. While Invoice Settings can't be read (its properties don't parse, or `folder` isn't a folder), the base stays where it is and the update says why.

**`Config/Table Settings.md`** is installed when the vault has none, with both settings blank, and is yours from then on: an update never changes or lists it (see *Freezing tables*).

**A base saves your view changes into its file:** sorting, filters, column widths. So once you've used a base, an update sees it as changed by you and leaves it alone: it's listed under *Changed in this vault*. To take a new version from the repository, turn on *Take the repository's version* in the update's dialog; your copy of a file outside `Config` goes to the vault's trash first, so you can copy a view back from it.

### Startup scripts

These run on their own when Obsidian starts, one after the other once the vault's layout is ready, and again whenever Plainday is reloaded:

- ***NewNoteGuard*** keeps Templater's trigger for new notes off notes that aren't new. Obsidian reports a note as created whenever it appears, including one that arrives through Sync, a move or a restore, and Templater applies `Get Template.md` to any note whose body below its properties is empty: a log note with no notes yet, or a person with only properties. A note you make starts empty, so one that appears with properties and nothing below them is held from Templater for a moment, and it's skipped with no write and no notice. It does the same for a note a template has just made and moved (*Add note* filing a task note, a calendar's new day), which Templater would otherwise run through the templates a second time. On every device, once Obsidian has restarted there after an update.
- ***SyncArea*** keeps `parent` current when notes move to another folder, one at a time or as a whole folder: it points at the nearest project or area above them, the first folder note (`Folder/Folder.md`) tagged `#project` or `#area`. A moved project's own note points at its new parent. A moved note that still has the older `area` gets `parent` in its place. It says "Updated parent on N notes". It leaves `parent` alone when notes land outside any project or area (`Inbox`, `Reference`), anywhere in `Archive` or `Config`, on an invoice (its `parent` is the project it bills), or when a folder is only renamed in place (Obsidian updates those links itself), and keeps a template's own pick for a brand-new note. It doesn't change the ⭕ on the lines that link a note moved this way, by a drag or *Move file to another folder*: until those follow too, move notes with *Move to project* to keep their lines current, and the report lists a line whose ⭕ and note disagree under Problems. It runs on every device, and each device handles only its own moves: Obsidian Sync delivers a move made elsewhere as a delete and a new file, so nothing is processed twice.
- ***RefoldOnOpen*** refolds each daily note as it opens, on every device. See *Folding*.
- ***MoveToProjectMenu*** puts *Move to project…* in the file menus: Notebook Navigator's menu for a note, for several selected, and for a project or area's folder; a tab's **⋯** menu; a link's right-click menu (for notes, not the project a ⭕ points at); and the core file explorer's. The item appears only for what *Move to project* moves.
- ***TrailingLinks*** draws the links that end a task or event line small, at the right of the line, on every device, hides a task's ID until the cursor reaches the end of the line, and makes End and ⌘→ stop at the end of the text first (see *Links at the end of a line*). It only looks at the lines on screen, and while you type only at the line you're on and the lines nested under it. It uses Obsidian's own editor code, which Plainday passes in.
- ***ListCursor*** keeps the cursor out of a list line's marker (its indent, its bullet or number, and its checkbox) in Live Preview, on every device. A plain cursor that would land there goes to the start of the text, whatever put it there, a write from outside Obsidian included. ← and → count a folded line as one line, so the cursor never lands on a line the fold hides. A selection and two or more cursors are left alone. It reads only the cursor's own line, so a line starting with `- ` in a code block counts as a list line, and `> - ` in a quote doesn't. Like *TrailingLinks*, it uses Obsidian's own editor code.
- ***CheckOff*** keeps a sent task's two lines in step: a tick on either one checks off both, and a click on a `[>]` box asks first (see *Checking off a task*). It acts only on your own edits in the editor, and on your clicks and Task Status's menu in reading view, on the device and in the pane where you make them, and while you type it only checks whether an edit changed a checkbox's mark. Like *TrailingLinks*, it uses Obsidian's own editor code.
- ***TimeReportOnStartup*** refreshes the time reports and the error log on the desktop once the vault is indexed, with a toast when there are new Problems. It needs the *TaskIds* script too (for the task checks); if a script it needs is missing, it waits a few seconds for it and otherwise skips with a console warning. A report already running finishes with the scripts it started with.

## Templates

New notes run `Get Template.md`, which picks a template from the title; the README's *Creating notes* table lists them. A note that already has properties is never treated as new: *NewNoteGuard* keeps the trigger off it, and if one still reaches `Get Template.md` that way, the template stops before writing anything, with a notice saying the note already has properties, beside Templater's own error notice (the check is `arrivedNote.js`, below, so it works while the scripts reload). A note made on this device that gets its properties before Templater looks, as a base's *New* button does, still gets its template. The Log template, finding a log of the same name where the new one would go, opens that log and trashes the new note only when it was empty; a note that arrived with text is left in place. Templater user scripts in `Config/Scripts/Templater/` shape what happens next:

- **No template asks for a project or area.** The Task and Log templates file a note where the command that made it says: *Add note* hands over the project or area its line's one ⭕ or 🗃️ names, and a log goes where its event line's one ⭕ or 🗃️ points. Otherwise the note waits in `Inbox` (Raycast's Open Log Note asks for that too). The Project and Area templates make a folder at the top of `Projects/`, with the note as its folder note. A name another note already has, anywhere in the vault, stops the template with a notice: the new note's shorter path would take over that note's links, and the time on them. The Task template stops the same way before filing a note in `Inbox`. *Add project link* and *Move to project* file them all afterwards. Either way the `!…` trigger (and any dates) come off the name.
- **`showNewNote.js`** runs once those templates finish: it redraws the properties panel (after the move, Obsidian's panel otherwise stays empty in Live Preview until the note is reopened) and moves the cursor from the title into the body.
- **`folderLook.js`** runs once the Project or Area template has written its note: with Notebook Navigator installed, it gives the new folder the project or area look (a red circle or a green archive, unless you've given the tag a look in Navigator) and pins the note when Navigator's settings say to (see *Areas, projects and task notes*). Waiting keeps its write apart from the template's, which matters when Navigator keeps looks in the note.

`eventTimes.js` reads a start and end time from a calendar event line, `recordEvent.js` writes a new log's line into its daily note, and `arrivedNote.js` tells a note that arrived with its properties from a new, empty one (the same rule as *NewNoteGuard*).

## Plugins

**Required:** Plainday, the plugin this repository builds from the scripts in `Config/Scripts/CustomJS/`, installed through BRAT from the repository's releases until the community directory lists it (see the README); Templater (script folder `Config/Scripts/Templater`, trigger on new file creation); [Natural Language Dates (Revived)](https://github.com/Amato21/nldates-revived), and the core Daily notes and Bases plugins. The original Natural Language Dates works in Revived's place, but reads a bare weekday as last week's; only one of the two can be on at a time.

**Recommended:**

- [Notebook Navigator](https://github.com/johansan/notebook-navigator): a calendar for the periodic notes, and folder notes. The scripts read its week, month and year patterns when it's installed, and new project and area folders get a look in it: a red circle or a green archive, or the look you've given their tag.
- [Task Status](https://github.com/ebullient/obsidian-task-status): shows `[<]`, `[>]`, `[-]` and the other markers as their own icons, and `⇧⌘⏎` picks one.
- [Selectable Tables](https://github.com/frankreporting/selectable-tables): arrow keys select and move through a table's cells, and a table can keep its first rows and columns in view as it scrolls. `Config/Table Settings.md` sets a default for the system's tables (see *Freezing tables*).

## Working on the system

Changes go through pull requests from a git worktree, and are tested one at a time in a clone of the repository opened as its own vault, with `Config/Scripts/dev-vault.sh`. The tests run with `node --test "Config/Scripts/tests/*.test.mjs"` from the vault root. `CLAUDE.md` has the workflow and the privacy rule; the README has the tests and CI.

- **Plainday is built from the scripts:** `npm run build`, in a worktree, bundles every file in `Config/Scripts/CustomJS/` with the plugin's own code in `plugin/` into `main.js`, and `npm test` tests the bundle. A saved script changes nothing in a vault running Plainday until it's built and the plugin reloaded; `dev-vault.sh test` does both for the dev vault. npm never runs in a folder Obsidian opens as a vault.
- **Testing the calendar sync:** the repository holds nothing about calendars. Give a test vault its own calendar, tick only that one in its Calendar Sync note, and seed test events there.
