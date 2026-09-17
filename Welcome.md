---
id: 2026091618000000
tags: 
---
# Welcome to the demo vault

This is a small, made-up vault that shows the Obsidian PM system at work: a freelancer's notes from late August to mid-September 2026. Every person, client, amount and event in it is invented. For installing the plugins and setting up your own vault, see [[README]].

## Where to look first

1. **A full working day:** [[2026-09-16|9/16/26]]. Calendar events with a meeting log and a ⭕ project link, tasks with time entries and notes, and one deliberately mistyped entry that the report flags under Problems.
2. **A task worked on over two days:** [[2026-09-14|9/14/26]] and [[2026-09-15|9/15/26]]. The wireframes task is forwarded (`[>]`) from Monday to Tuesday, both lines link its task note with 🔗, and Tuesday has sub-tasks with their own entries and a 🆓 entry. Monday also has a canceled `[-]` event.
3. **A project's time report:** [[Kestrel Outfitters 2026|⭕ Kestrel Outfitters 2026]]. Its sub-project [[Kestrel Fall Catalog|⭕ Kestrel Fall Catalog]] bills at the parent's rate. Compare [[Pinecrest Library Brochure|⭕ Pinecrest Library Brochure]] (flat fee) and [[Garden Club Newsletter|⭕ Garden Club Newsletter]] (non-billable).
4. **The week's report:** [[2026w38]], then [[2026-09]] and [[2026]].
5. **Archived work:** [[Marlowe Bakery Rebrand|⭕ Marlowe Bakery Rebrand]] sits in 90 Archive. Its entries on [[2026-08-27|8/27/26]] and [[2026-08-28|8/28/26]] are left out of every report.

Everything under "## Time tracking" is written by the TimeReport command, not by hand. On the desktop it runs at startup too; the reports here are already current, so opening the vault changes nothing until you log more time.

## Things to try

| Try | How |
| --- | --- |
| Log time | Open today's daily note, put the cursor on a task and press `⌘T` (ToggleTimeEntry). Press it again to stop. |
| Move a task to another day | `⌘S` (Schedule) on a task line |
| Add a due date | `⇧⌘D` (DueDate) |
| Make or link a task note | ``⌥⌘` `` (AddTaskNote) on a task line |
| Refresh the reports | Command palette: "CustomJS: TimeReport" |
| Fix the Problems example | On 9/16, add "pm" to `2:30 - 3:45pm`, then run TimeReport |
| New notes | Create a note named `!task …`, `!project …`, `2026-09-21 Kickoff call` or `2026-09-21` and let the template file it |
| Plan ahead | "CustomJS: Plan" opens the next few daily notes side by side |

The calendar sync (CalendarSync) reads macOS calendars, so it needs setup first; see [[README]].
