---
id: 2026091618000000
tags: 
---
# Welcome to the demo vault

This is a small, made-up vault that shows the Obsidian PM system at work: a freelancer's notes from late August to mid-September 2026. Every person, client, amount and event in it is invented. For installing the plugins and setting up your own vault, see [[README]]; for how everything works, see the [[Manual]].

## Where to look first

1. **A full working day:** [[2026-09-16|9/16/26]]. Calendar events with a meeting log and a ⭕ project link, tasks with time entries and notes, and one deliberately mistyped entry that the report flags under Problems.
2. **A task worked on over two days:** [[2026-09-14|9/14/26]] and [[2026-09-15|9/15/26]]. The wireframes task is forwarded (`[>]`) from Monday to Tuesday, both lines link its task note with 🗒️, and Tuesday has sub-tasks with their own entries and a 🆓 entry. Monday also has a canceled `[-]` event.
3. **A project's time report:** [[Kestrel Outfitters 2026|⭕ Kestrel Outfitters 2026]]. Its sub-project [[Kestrel Fall Catalog|⭕ Kestrel Fall Catalog]] bills at the parent's rate. Compare [[Pinecrest Library Brochure|⭕ Pinecrest Library Brochure]] (flat fee) and [[Garden Club Newsletter|⭕ Garden Club Newsletter]] (non-billable). [[Block Party Poster|⭕ Block Party Poster]] has a deliberate mistake: its `rate_type` was never filled in, so its hour counts as billable and the report lists the project under Problems, on its own note and on the week, month and year of that hour.
4. **The week's report:** [[2026w38]], then [[2026-09]] and [[2026]].
5. **Archived work:** [[Marlowe Bakery Rebrand|⭕ Marlowe Bakery Rebrand]] sits in 90 Archive. Its entries on [[2026-08-27|8/27/26]] and [[2026-08-28|8/28/26]] are left out of every report.

Everything under "## Time tracking" is written by the TimeReport command, not by hand. On the desktop it runs at startup too; the reports here are already current, so opening the vault changes nothing until you log more time.

## Basic commands

| Command | Action | Shortcut |
| --- | --- | --- |
| ToggleTimeEntry | Log time | `⌘T` |
| Schedule | Move a task to another day | `⌘S` |
| DueDate | Add a due date | `⇧⌘D` |
| AddTaskNote | Make or link a task note | Command palette |
| TimeReport | Refresh the reports | Command palette |
| New note | Create note; include `!task …`, `!project …`, date + title like `2026-09-21 Kickoff call`, or plain dates like `2026-09-21`, and templates are applied | `⌘N` |
| Plan | Plan ahead: the next few daily notes side by side | Command palette |
| JumpToDate | Open the note for a date in words: `friday`, `next week`, `oct 2` | `⌘J` |

Run the task commands with the cursor on a task line. ToggleTimeEntry times tasks in today's daily note; press it again to stop. In the command palette, the commands are "CustomJS: …".

The calendar sync (CalendarSync) reads macOS calendars, so it needs setup first; see [[README]].
