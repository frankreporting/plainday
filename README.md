# Plainday

A Markdown planner for [Obsidian](https://obsidian.md). Plainday lets you track tasks, projects, and events entirely in Markdown, and it converts your plaintext timestamps into timesheets and invoices. It also syncs your calendars' events into clean, simple bullets in your daily notes. Think of Plainday as a set of superpowers for your periodic notes. It works with Obsidian's own links, properties and Bases, and if you turn it off, your notes are still completely readable.

### Highlights:

- **Tasks are plain Markdown checklists,** in daily, weekly, monthly and yearly notes.
- **A task can have its own note** for more context, or not: it's optional.
- **Projects and areas** organize tasks, as in Things and the [PARA method](https://fortelabs.com/blog/para/).
- **Time is tracked** with timestamps in a bullet under each task or event.
- **Calendars sync** from their private links, on a computer, phone or tablet. An event is another checkbox, `[<]`, above the tasks in your daily note.
- **Timesheets and invoices** come from the same time entries, billable or not.
- **Shortcuts do the text wrangling:** schedule a task, set a due date, make a project, move a task to a project or area, start and stop a timer, and more.
- **Every date prompt takes plain words:** `friday`, `next week`, `oct 2`.
- **A task knows every line it's on.** Move today's task to another project, and every other day you worked on it follows.

A day in a daily note:

```markdown
- [<] 9:30am	Kestrel standup [[Kestrel Outfitters 2026|⭕]] ^e-q7m2xk
	- 10:00am
- [/] Draft the proposal [[2026-09-18|🚩 9/18]] [[Kestrel Outfitters 2026|⭕]] [[Draft the proposal|⋯]]
	- 9:40am - 11:05am: outline
	- 3:00pm - 3:30pm: 🆓 fixing my own mistake
- [x] Pick the paper stock [[Pinecrest Library Brochure|⭕]]
- [ ] Water the plants
```

`[<]` is an event, with its end time under it, `[ ]` an open task, `[/]` started, `[x]` done, `[>]` sent to another day and `[-]` canceled. ⭕ links the project the time counts for, 🚩 the due date and ⋯ the task's own note, and 🆓 marks time you won't bill. **[The manual](https://github.com/frankreporting/plainday/blob/main/Config/Manual.md)** describes it all: [the daily notes](https://github.com/frankreporting/plainday/blob/main/Config/Manual.md#daily-notes), what each command does, and how the time report and the calendar sync decide what they write.

## Install

In Obsidian, open **Settings → Community plugins**, turn community plugins on, then **Browse**, search for **Plainday**, install it and turn it on. It works on a computer, phone or tablet.

For beta builds, install [BRAT](https://github.com/TfTHacker/obsidian42-brat), run **BRAT: Plugins: Add a beta plugin for testing** from the command palette, enter `frankreporting/plainday`, and choose *Latest version*.

Plainday needs no other plugin. It finds your daily notes where the core Daily notes plugin puts them, or where Notebook Navigator's calendar does if you choose it (*Settings → Plainday → Folders → Periodic notes*). These plugins add to it:

- **[Templater](https://github.com/SilentVoid13/Templater)** runs the Templater code in your own templates for task notes, logs, projects, areas and periodic notes. Without it, a template's `{{title}}`, `{{date}}` and `{{time}}` are filled in.
- **[Natural Language Dates (Revived)](https://github.com/Amato21/nldates-revived)** reads dates in languages other than English, and suggests dates as you type in a note. Plainday reads English dates itself.
- **[Notebook Navigator](https://github.com/johansan/notebook-navigator)** gives the periodic notes a calendar, new project and area folders their look (a red circle or a green archive) and a new `›logs` folder a clock, with *Move to project…* in its menus.
- **[Task Status](https://github.com/vburzynski/obsidian-task-status)** adds a picker for a task's checkbox (`⇧⌘⏎`, or a long press). Plainday draws the markers itself.
- **[Selectable Tables](https://github.com/frankreporting/selectable-tables)** allows you to set a default for frozen header rows and columns in the tables found in reports, timesheets, and invoices.

## How your notes are organized

```
Projects/                                  your areas and projects
├── 🗃️ Freelance/                          an area: a folder, with a folder note tagged #area
│   ├── Freelance.md
│   ├── ⭕ Kestrel Outfitters 2026/        a project in the area: a folder note tagged #project
│   │   ├── Kestrel Outfitters 2026.md
│   │   ├── Draft homepage wireframes.md   a task's own note
│   │   └── ›logs/                         the project's event logs
│   └── ⭕ Pinecrest Library Brochure/
│       └── Pinecrest Library Brochure.md
└── 🗃️ Household/                          another area
    └── Household.md
Inbox/                                     notes Plainday makes before you file them
Reference/                                 everything else you keep, and the periodic notes
└── Planner/
    ├── days/2026-09-15.md
    ├── weeks/2026w38.md
    ├── months/2026-09.md
    └── years/2026.md
Archive/                                   finished projects, moved here whole
```

In the tree, 🗃️ marks an area and ⭕ a project; the folders' names are plain. The organization principle is very much based on the [PARA method](https://fortelabs.com/blog/para/) (Projects, Areas, Resources, Archive), plus periodic notes to plan in. A task belongs to a project or area by the ⭕ or 🗃️ link on its line, and its own note, if it has one, goes in that project or area's folder. Every note in an area or project has a `parent` property linking the folder note above it, kept current as notes move. You can define your own folder names in the settings.

## Getting started

1. Open today's daily note: the Daily notes plugin's *Open today's daily note*, or *Plainday: Jump to date* and type `today`.
2. Make a project with *Plainday: New project*.
3. Type a task, `- [ ] Draft the proposal`, and with the cursor on it run *Add project link* to put it in the project.
4. Run *Toggle time entry* on the task to start a timer, and again to stop it. The time goes under the task.
5. Run *Schedule* to move the task to another day: type `friday`.
6. Run *Time report*: the project's note gets its totals, and the day's week, month and year theirs.

Plainday sets no hotkeys. These are suggested (*Settings → Hotkeys*, search "Plainday"): *Toggle time entry* `⌘T` (in place of Obsidian's New tab), *Schedule* `⌘S`, *Due date* `⇧⌘D`, *Jump to date* `⌘J`, *Add project link* `⌥⌘P` and *Move to project* `⌥⌘M`.

## Commands

All of them are in the command palette as "Plainday: …". [The manual's *Commands*](https://github.com/frankreporting/plainday/blob/main/Config/Manual.md#commands) says exactly what each one does.

| Command | What it does |
| --- | --- |
| Schedule | Moves a task to another day, or into a weekly, monthly or yearly note. A task you've worked on leaves a `[>]` line behind |
| Due date | Sets a task's 🚩 due date, on every line of the task and in its note |
| Add note | Makes a task's own note, or an event's log, in its project or area |
| New event log | Makes a log for an event you name, linked from its line |
| Add project link | Says which project or area a task belongs to, on every line of the task |
| Move to project | Moves the note you're on into a project or area, and its tasks follow |
| New project, New area | Makes a project or an area: a folder with its note, in your projects folder |
| Convert to project | Turns the selected text into a new project, and links it there |
| Toggle time entry | Starts or stops a timer on the task or event you're on; anywhere else, picks one |
| Jump to date | Opens the note for a date in words: `friday`, `next week`, `oct 2` |
| Plan | Opens the next 2 to 5 daily notes side by side |
| Sync calendars | Downloads your calendars and writes their events into your daily notes |
| Time report | Writes time totals into project, area, weekly, monthly and yearly notes, and each project's timesheet |
| Invoice | Makes a draft invoice from a project's unbilled time, or marks an invoice sent, paid or canceled |
| View error logs | Opens the list of Problems the time report and the calendar sync found |

The Obsidian command-line tool runs them from a terminal too: `obsidian command id=plainday:add-note`.

## Settings

Everything is in **Settings → Plainday**: the folders for projects, the Inbox and the archive, and where the periodic notes go; your templates for each kind of note; the date format Plainday writes in (*Dates*, your region's as it comes); your details for invoices and the folder they go in; the tables; the editor; and your calendars. *Copy* and *Paste*, at the top, carry the settings to another device or keep a backup. The copy holds your calendar links, so keep it private. [The manual's *Settings*](https://github.com/frankreporting/plainday/blob/main/Config/Manual.md#settings) says what each one does.

## Calendars

Plainday reads a calendar from its private link. In **Settings → Plainday → Calendars**, *Add calendar* takes the link, and *How to get the links*, beside it, says where each provider keeps it:

- **Google Calendar:** on the web, the calendar's settings, *Integrate calendar → Secret address in iCal format*. On a work or school account, the admin can turn these addresses off; ask them.
- **iCloud:** share the calendar in Calendar and turn on *Public Calendar*. Anyone with that link can read the calendar, as with Google's secret address.
- **Outlook:** *Settings → Calendar → Shared calendars → Publish a calendar*, the *ICS* link.
- **A calendar someone shares with you** has no link you can use: ask its owner for one. A calendar you subscribe to has its own web address.

Then *Sync calendars* downloads them and writes their events into your daily notes. Events arrive when you run it; syncing on a schedule is coming. For now, only one device can sync, and your other devices pick up the events through whatever vault sync you use.

Each link works like a password, so Plainday keeps it in that device's secret storage, never in a note or its settings file, and *Paste* carries it to another device. The sync is tested with Google and iCloud private links and calendars published from Outlook. Outlook isn't fully tested (see *Known limitations*); if you sync an Outlook calendar, please [open an issue](https://github.com/frankreporting/plainday/issues) saying what you see. [The manual's *Calendar sync*](https://github.com/frankreporting/plainday/blob/main/Config/Manual.md#calendar-sync) has the rest.

## Privacy and your files

- **Network:** Plainday goes online only to download the calendar links you add, and sends nothing.
- **No account, no payment, no ads, no telemetry.**
- **Only your vault:** Plainday reads and writes files only inside your vault. Its settings are in its own data file there (`.obsidian/plugins/plainday/`), calendar links in each device's secret storage, and what the syncing device remembers about events in Obsidian's storage on that device.
- **What it changes on its own:**
	- on a computer, as the vault opens, the time report's blocks in project, area and periodic notes and the timesheets, making a weekly, monthly or yearly note it needs, and its list of Problems in the error log note;
	- a new daily, weekly, monthly or yearly note's alias and folder;
	- a note's `parent` property when the note moves;
	- a sent task's other line when you tick one of its lines.

Everything else it writes because you ran a command.

## Known limitations

- **A tick in a hover preview, a canvas card or a note embedded in another changes only that line.** A sent task then shows done on one line and open on its other, which the time report lists under Problems. Tick a sent task in its own tab instead ([*Checking off a task*](https://github.com/frankreporting/plainday/blob/main/Config/Manual.md#checking-off-a-task)).
- **Calendars sync only when you run *Sync calendars*, and from one device** ([*Calendar sync*](https://github.com/frankreporting/plainday/blob/main/Config/Manual.md#calendar-sync)).
- **Outlook isn't fully tested.** An all-day repeating event from an Outlook calendar doesn't sync. A published Outlook calendar carries no guests, so an invitation you declined there still shows. A calendar published from your own Outlook or Microsoft 365 account hasn't been tried ([*Calendar sync*](https://github.com/frankreporting/plainday/blob/main/Config/Manual.md#calendar-sync)).
- **A periodic note's name must hold its whole date.** Notes named without part of it, such as a week named `W40` in its year's folder, aren't found, and the settings say so ([*Periodic notes*](https://github.com/frankreporting/plainday/blob/main/Config/Manual.md#periodic-notes)).

## Try the demo vault

This repository is also a vault: a made-up freelancer's notes from late August to mid-September 2026. Every person, client, amount and event in it is invented. To try it:

1. Clone it into a folder named `Plainday Demo`: `git clone https://github.com/frankreporting/plainday.git "Plainday Demo"`.
2. In Obsidian, choose **Open folder as vault** and pick that folder.
3. Install Plainday as above. Its settings for the demo are already there, with invented details.
4. Open `Welcome.md`.

Don't make your own vault a copy of this repository: the sample notes' paths would collide with your notes.

## License

[MIT](https://github.com/frankreporting/plainday/blob/main/LICENSE). The sample notes are covered by the same license.

Plainday also ships code from other projects, each under its own license, with its notice at the top of the file:

- [ical.js](https://github.com/kewisch/ical.js) 2.2.1, which reads calendar feeds, in `main.js`, under the [Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/). Its source is in its repository.
- [chrono-node](https://github.com/wanasit/chrono) 2.10.3, which reads typed dates, in `main.js`, under the MIT License, with English rules from Natural Language Dates (Revived), also MIT.
- Icons from [Lucide](https://lucide.dev) for the task markers, in `styles.css`, under the ISC License.

## Working on Plainday

The plugin's code is in `plugin/src/`. In a clone that Obsidian doesn't open as a vault, with Node 20 or later, run `npm ci` once; then `npm run build` builds `main.js`, `npm test` tests it, and `npm run lint` runs Obsidian's lint. `node --test "Config/Scripts/tests/*.test.mjs"` runs the rest of the tests. GitHub Actions runs all of them on every pull request.

[`CLAUDE.md`](https://github.com/frankreporting/plainday/blob/main/CLAUDE.md) has the workflow and the privacy rule: nothing from a real vault in code, tests, sample notes, commits or pull requests. [The manual's *Working on the system*](https://github.com/frankreporting/plainday/blob/main/Config/Manual.md#working-on-the-system) has the rest, including the script that copies this repository's templates and manual into a vault of your own.
