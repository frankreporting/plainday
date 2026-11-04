class TimeReport {
    // Time reports built from the time entries in daily notes. Runs at startup on the desktop
    // (TimeReportOnStartup), and as the command "CustomJS: TimeReport". It writes only to these
    // notes, whatever note is open, under "## Time Report" (OBS-133; "## Time tracking" before, renamed
    // where it heads a block):
    //   - each project or area note with entries (or with a block already): a link to its timesheet
    //     note, its hours, Earned and effective rate, By Project when time was logged to a sub-project,
    //     then By Week or By Month, its invoices, and Problems (which also say what changed since an
    //     invoice, OBS-5);
    //   - each project's timesheet note, beside its note: every entry, billable and 🆓, in one table
    //     with the invoice that billed it (OBS-5, OBS-242), and Problems that say why an entry is ⚠️ (OBS-143);
    //   - each weekly and monthly note in Planner (weeks/, months/, from Notebook Navigator's
    //     patterns) for a period with entries: Hours, by project and by day (weekly) or by week
    //     (monthly), then Earned, the billed projects' money, and its Problems;
    //   - each yearly note (years/): an Hours table and an Earned table, a row per project and a
    //     column per month (headers link to the monthly notes), and Problems.
    // On the desktop, missing periodic notes are created first. Weeks run Sunday to Saturday, the
    // same weeks Notebook Navigator names gggg[w]ww.
    // Each report sits between %% time:start %% and %% time:end %%; running it again replaces only
    // that block, and only when the numbers changed (the "Updated" line says when they last did). Summaries
    // only, except the timesheet notes, which hold entry-by-entry detail. Projects in Archive count like
    // any other (OBS-213).
    //
    // A time entry is a bullet directly under a top-level task or event line, one at the left edge
    // (rule 7): `- 9:01am - 9:40am`, optionally `: note`. 🆓 at the start of the note doesn't bill it
    // (`- 5:00pm - 5:30pm: 🆓 not billing`); 🆓 as a word of its own on the task or event line doesn't
    // bill any entry under it, and an entry marked both ways is 🆓 and listed under Problems (OBS-24).
    // One under a sub-task isn't counted and is listed (rule 5); one anywhere else is nothing the system
    // defines, and isn't read.
    // `- 3:00pm - ` is a running clock. An end earlier than a pm start past midnight
    // (`10:30pm - 5:51am`) runs into the next day. Lines nested under an entry are notes about
    // it, not entries. Old daily notes (to August 2025) list meetings as `3:15pm⇥[[log|title]]`
    // under ## Meetings, without a bullet; entries under those count too. Anything else that
    // looks like a time range is listed under Problems, never silently skipped. Frontmatter,
    // code blocks and %% / <!-- --> comments are skipped.
    //
    // An event line (`- [<] 4:00pm⇥Title`) with the calendar sync's end time under it (`⇥- 4:30pm`)
    // counts from its start to that end once it has ended, as an entry on the project the line
    // resolves to, else Unassigned (OBS-24); it's checked for overlaps like any entry (OBS-47).
    // The end line takes a note after a colon like an entry does (`⇥- 4:30pm: 🆓 not billing`).
    // ℹ️ after the title, before its ⭕ links, marks an event the calendar says you're free during:
    // not your time, so it's never counted and never overlaps anything. Time entries directly under
    // an event are its time instead: its end line is then ignored, and a 🆓 left there is a Problem.
    // A busy event with a start and no usable end line is a Problem, like a running clock, except
    // that one ending when it starts is quietly nothing. All-day, canceled ([-]) and forwarded ([>])
    // events, and any marker but [<], are never counted.
    //
    // The project an entry belongs to is the ⭕ or 🗃️ on its top-level line, or Unassigned (rule 4,
    // resolve). Only the links that end a line count (OBS-90): a link in the text is part of the title,
    // even a link to a project. Nothing else says where time goes: not a ⋯, a ↗ or a log, not `parent`,
    // not another line. A line that disagrees with itself (two project links, or a ⭕ against the project
    // its own note is filed in) counts toward neither, and is listed on both. A project folder note inside
    // another project's folder is a sub-project: its hours also count toward the parent. An archived
    // project (in Archive) counts like any other, an archived sub-project into its live parent too, through
    // its `parent` when no folder says, but a live project is never under an archived one, and an archived
    // project's time is never billed (OBS-213).
    // An area (a folder note tagged exactly #area) counts like a project, as a row of its own, but is
    // never a parent and never has one: the projects inside it don't add up into it.
    // Its note gets a report the way a project's does, and with no `rate` or `rate_type` of its own
    // its time is non-billable (OBS-51).
    //
    // Money comes from project note properties: `rate` (hourly; a sub-project without one uses its
    // parent's), `rate_type` (anything but hourly means no Earned), and a cap from `max_hours`, or
    // `contract_max` ÷ rate. Earned is billable rounded hours × rate. A flat fee's `rate` is the fee,
    // never Earned by the hour; a project's summary divides it by the hours for an effective rate. A
    // `rate` on a non-billable note values its time instead: Invested is its rounded hours × that
    // rate, and never counts as Earned (OBS-156).
    //
    // Time is billable only when it's someone's to bill: the entry has a project, that project's
    // `rate_type` (its own or inherited) isn't `non-billable`, and there's no 🆓 on the entry.
    // Everything else — 🆓, time with no project, a non-billable project — counts as 🆓 instead, so
    // Billable is what could be invoiced and Total is still every hour worked. A project with time
    // and no `rate_type` bills by default and says so in Problems, since quietly invoicing nothing
    // is the worse mistake (OBS-28). Only entries that have already
    // ended count, for hours and money alike (a synced event with its times filled in ahead isn't work yet).
    //
    // Minutes are kept exact; rounding is display only. Each entry rounds UP to the next ROUND_TO
    // minutes (2:01 → 2:15), the way invoices are billed: any work counts, 15 minutes minimum.
    // Everything that touches `app` is at the bottom; the rest is plain functions, tested with
    // `node --test "Config/Scripts/tests/*.test.mjs"`.
    static START = "%% time:start %%";
    static END = "%% time:end %%";
    static HEADING = "## Time Report";
    // Problems open a report as a callout, so they catch the eye (OBS-167): built into Obsidian, and
    // orange in the default theme too, where a checkbox like [!] is only an icon in some themes
    static PROBLEMS = "> [!warning] Problems";
    // The heading before OBS-133, renamed where it heads a block (renameHeading), as is a "## Time
    // report" in any other case
    static OLD_HEADING = "## Time tracking";
    // A project note's By Week table turns into By Month once its entries span more weeks than this
    static WEEKS_MAX = 13;
    static ARCHIVE = "Archive/";
    // What each of the Planner's folders holds, for makeIndex
    static PLANNER_KIND = { days: "day", weeks: "week", months: "month", years: "year" };
    static QUOTE_MAX = 80;
    static CREATED_KEY = "time-report-created-notes";
    // A project's timesheet note sits beside it, named after it: "Kestrel Outfitters 2026 timesheet"
    static SHEET = " timesheet";
    // Every timesheet carries this class, for the day bands of pm-timesheet.css (OBS-242)
    static SHEET_CLASS = "pm-timesheet";
    // A timesheet's summary line, its numbers aside (tableHeading), whichever kinds of time it names: its one
    // table's heading. It had two tables before OBS-242, Billable time and 🆓 time.
    static SHEET_HEADING = "### Billable time: # hrs · 🆓 time: # hrs";
    static SHEET_HEADINGS = /^### (?:Billable time: # hrs(?: · 🆓 time: # hrs)?|🆓 time: # hrs)$/u;
    // An invoice's status as the mark in its links, in the timesheets and on the project's note (OBS-117)
    static INVOICE_MARK = { draft: "✏️", sent: "🕒", paid: "✅", canceled: "❌" };
    // Freezing tables for the Selectable Tables plugin (OBS-238). The default is set in TABLE_SETTINGS. A
    // freeze is that plugin's mark in a table's header row, `%%freeze 2 1%%` for 2 rows and 1 column, read
    // as its src/editor/freeze-mark.ts reads it: the first one counts, spaces inside are fine, and one in a
    // code span is text. Beside it the report writes a label saying whose freeze it is: `%%default 2 1%%`,
    // its own default, or `%%custom%%`, yours. FREEZE_COMMENT is a comment as the report writes it, which
    // defuse leaves whole: never next to another `%`, or after a `<` (Templater's `<%`).
    static TABLE_SETTINGS = "Config/Table Settings.md";
    static FREEZE_MARK = /%%\s*freeze\s+(\d+)\s+(\d+)\s*%%/;
    static FREEZE_LABEL = /%%\s*(?:default\s+(\d+)\s+(\d+)|custom)\s*%%/;
    static FREEZE_COMMENT = /((?<![%<])%%(?:freeze \d+ \d+|default \d+ \d+|custom)%%(?!%))/;
    static MAX_FROZEN_COLUMNS = 9;
    static ROUND_TO = 15;
    static LONG_MINUTES = 12 * 60;
    // Time under a sub-task isn't counted, only listed (Brian, 2026-10-30): counting it too would leave
    // no reason to fix the line
    static SUB_TIME = "is under a nested task, so it isn't counted; move it up to the task at the left edge, or outdent the nested task";

    static TIME = String.raw`\d{1,2}:\d{2}\s?[ap]m`;
    // `9:01am - 9:40am: note`, or `3:00pm - ` still running. En and em dashes count too, since
    // phones turn "--" into one.
    static ENTRY = new RegExp(String.raw`^(${TimeReport.TIME})\s*[-–—]\s*(${TimeReport.TIME})?\s*(?::\s*(.*?))?\s*$`, "i");
    // Starts like a range but isn't one: `10:00 - 11:00am`, `4:34pm - 5:38`, `9am - 10am`
    static RANGEISH = /^\d{1,2}(?::\d{2}\s*(?:[ap]\.?m\.?)?|\s*[ap]\.?m\.?)\s*(?:[-–—−]|to\b|until\b)/i;
    // A time range anywhere in a line, in any of the ways one gets mistyped
    static LOOSE_RANGE = new RegExp([
        String.raw`\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m?\.?)?\s*(?:[-–—−]|to\b|until\b)\s*\d`,
        String.raw`\d{1,2}(?:\.\d{2})?\s*[ap]\.?m?\.?\s*(?:[-–—−]|to\b|until\b)\s*\d`,
        String.raw`\b\d{1,2}\s*[-–—−]\s*\d{1,2}(?::\d{2})?\s*[ap]\.?m\b`,
        String.raw`${TimeReport.TIME}.*${TimeReport.TIME}`,
    ].join("|"), "i");
    static BULLET = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    // An entry line up to where its end time goes: `\t- 9:00am - `
    static ENTRY_START = new RegExp(String.raw`^(\s*(?:[-*+]|\d+[.)])\s+)(${TimeReport.TIME})\s*[-–—]\s*`, "i");
    static OLD_EVENT = /^\d{1,2}:\d{2}\s?[ap]m\b/i;
    // A timed event line's body, up to the tab before its title: `[<] 4:00pm⇥`
    static EVENT_HEAD = new RegExp(String.raw`^\[<\]\s+(${TimeReport.TIME})\t`, "i");
    // The calendar sync's end-time line under an event: `4:30pm` on its own, or with a note after a
    // colon like an entry's (`4:30pm: 🆓 not billing this`)
    static END_LINE = new RegExp(String.raw`^(${TimeReport.TIME})(?:\s*:\s*(.*?))?\s*$`, "i");
    // 🆓 as a word of its own on a task or event line (a phone may add U+FE0F); links come out first
    static FREE_WORD = /(?<=^|[\s(\[])🆓\uFE0F?(?=$|[\s.,;:!?)\]])/u;
    static FREE_WORDS = /(?<=^|[\s(\[])🆓\uFE0F?(?=$|[\s.,;:!?)\]])/gu;
    static EMPTY_BRACKETS = /\s*[(\[]\s*[)\]]/g;
    static LINK = /\[\[[^\]]*\]\]/g;
    // The free mark at the end of an event's title; a phone may leave out the U+FE0F
    static FREE_MARK = /(?:^|\s)ℹ️?$/u;
    // ⋯, ↗, ⭕, 🗃️ and 🚩 links, and a sent line's forward date (FORWARD_LINK),
    // which say nothing about what a line is
    static SYMBOL_LINK = /\[\[[^\]|]*\|\s*(?:⋯|↗|⭕|🗃|🚩|➡)[^\]]*\]\]|\[\[(?:[^\]|#]*\/)?(?:\d{4}-\d{2}-\d{2}|\d{4}w\d{2}|\d{4}-W\d{2}|\d{4}-\d{2}|\d{4})#\^[A-Za-z0-9-]+\|\s*(?:\d{1,2}\/\d{1,2}|Wk of \d{1,2}\/\d{1,2}|[^\s\]|]+ \d{4}|\d{4})\s*\]\]/gu;
    // A sent line's forward date (OBS-181): a link to a periodic note's line with a date for its label,
    // `[[2026-10-08#^k3x9m2|10/8]]` (TaskIds.FORWARD); or one written with a ➡️ before its date
    static FORWARD_LINK = /\[\[(?:[^\]|#]*\/)?(?:\d{4}-\d{2}-\d{2}|\d{4}w\d{2}|\d{4}-W\d{2}|\d{4}-\d{2}|\d{4})#\^[A-Za-z0-9-]+\|\s*(?:\d{1,2}\/\d{1,2}|Wk of \d{1,2}\/\d{1,2}|[^\s\]|]+ \d{4}|\d{4})\s*\]\]|\[\[[^\]|]*\|\s*➡[^\]]*\]\]/gu;
    // One of the links that end a line (OBS-90), as TrailingLinks draws them: a due date's 🚩 M/D, a
    // note's ⋯ or ↗, a project's ⭕ or an area's 🗃️, alone in its alias; or a forward date (OBS-181),
    // a periodic note's line with a date for its label (TaskIds.FORWARD), or one with a ➡️ in front of
    // its date. A phone may add or drop the U+FE0F.
    static TRAIL_LINK = /\[\[([^\]|]+)\|\s*(🚩️?\s*\d{1,2}\/\d{1,2}|➡️?[^\]]*|⋯|↗️?|⭕️?|🗃️?|(?<=\[\[(?:[^\]|#]*\/)?(?:\d{4}-\d{2}-\d{2}|\d{4}w\d{2}|\d{4}-W\d{2}|\d{4}-\d{2}|\d{4})#\^[A-Za-z0-9-]+\|\s*)(?:\d{1,2}\/\d{1,2}|Wk of \d{1,2}\/\d{1,2}|[^\s\]|]+ \d{4}|\d{4}))\s*\]\]$/u;
    // The free mark and 🆓, as words between or after those links, as the calendar sync allows them
    static TRAIL_MARK = /(?:^|\s)(?:ℹ|🆓)️?$/u;
    // A block ID ending a line (` ^abc123`, as Copy link to block adds it): Obsidian hides it, so the
    // links before it still end the line
    static BLOCK_ID = /\s\^[A-Za-z0-9-]+$/;
    // An event line whose title is one link, the way lines were written before OBS-57: `[<] 10:00am⇥
    // [[2026-09-14 Review|Review]]`, a log's line with no time yet, a canceled or forwarded event,
    // and the old layout's `10:00am⇥[[Weekly sync#Sep 14|Weekly sync]]` without a bullet. That link
    // is the event's own note.
    static WRAPPED_TITLE = new RegExp(String.raw`^(?:\[<\]\s+(?:(?:all day|${TimeReport.TIME})\s+)?|(?:\[.\]\s+)?(?:\[\[\d{4}-\d{2}-\d{2}\|[^\]]*\]\]\s+)?(?:all day|${TimeReport.TIME})\s+)\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$`, "iu");
    static DATE_LINK = /^\d{4}-\d{2}(-\d{2})?$/;
    static SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    static MONTHS = ["January", "February", "March", "April", "May", "June", "July",
        "August", "September", "October", "November", "December"];

    // ---------------------------------------------------------------- reading a note

    // Minutes after midnight for "9:01am", or null
    minutes(time) {
        const m = String(time).trim().match(/^(\d{1,2}):(\d{2})\s?([ap]m)$/i);
        if (!m) return null;
        const h = Number(m[1]), min = Number(m[2]);
        if (h < 1 || h > 12 || min > 59) return null;
        return (h % 12) * 60 + min + (m[3].toLowerCase() === "pm" ? 720 : 0);
    }

    formatTime(minutes) {
        const m = ((minutes % 1440) + 1440) % 1440;
        const h = Math.floor(m / 60);
        return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
    }

    indentWidth(line) {
        let w = 0;
        for (const ch of line.match(/^\s*/)[0]) w += ch === "\t" ? 4 : 1;
        return w;
    }

    lines(text) {
        return text.split(/\r?\n/);
    }

    // What Obsidian shows as note text. Frontmatter and code blocks are hidden whole; %% and <!-- -->
    // comments are cut out of the lines they touch, so `- [ ] Task %%note%% [[P]]` reads as
    // `- [ ] Task  [[P]]`. Returns { visible: [text per line], hidden: [true where nothing shows],
    // frontmatterEnd (line or -1), starts, ends (report marker lines), blocks: [{ start, end }]
    // (each start paired with the next end), unclosed: [{ line, what }] }.
    scan(lines) {
        const visible = lines.slice();
        const hidden = new Array(lines.length).fill(false);
        const starts = [], ends = [], unclosed = [];
        const hide = (j) => { hidden[j] = true; visible[j] = ""; };
        let i = 0, frontmatterEnd = -1;
        if (lines[0]?.trimEnd() === "---") {
            frontmatterEnd = lines.findIndex((l, j) => j > 0 && l.trimEnd() === "---");
            if (frontmatterEnd > 0) for (; i <= frontmatterEnd; i++) hide(i);
            else frontmatterEnd = -1;
        }
        const closer = { "%%": "%%", "<!--": "-->" };
        let fence = null, comment = null, openedAt = -1;
        for (; i < lines.length; i++) {
            const t = lines[i].trim();
            if (fence) {
                hide(i);
                if (t.length >= fence.length && t === fence[0].repeat(t.length)) fence = null;
                continue;
            }
            if (!comment) {
                if (t === TimeReport.START) { starts.push(i); continue; }
                if (t === TimeReport.END) { ends.push(i); continue; }
                // A fence opener: three or more backticks (no backtick after them) or tildes
                // (four or more spaces of indent, with no tab from list nesting, is indented code instead)
                const f = t.match(/^(`{3,}|~{3,})(.*)$/);
                const lead = lines[i].match(/^\s*/)[0];
                if (f && !(f[1][0] === "`" && f[2].includes("`")) && (lead.includes("\t") || lead.length < 4)) {
                    fence = f[1]; openedAt = i; hide(i);
                    continue;
                }
            }
            // Cut comments out of the line, carrying an open one over to the next line
            let rest = lines[i], shown = "";
            while (rest) {
                if (comment) {
                    const at = rest.indexOf(closer[comment]);
                    if (at === -1) { rest = ""; break; }
                    rest = rest.slice(at + closer[comment].length);
                    comment = null;
                    continue;
                }
                const pct = rest.indexOf("%%"), html = rest.indexOf("<!--"), tick = rest.indexOf("`");
                const at = [pct, html].filter((x) => x !== -1).reduce((a, b) => Math.min(a, b), Infinity);
                // Inline code comes first: `%%` in backticks is text, not a comment
                if (tick !== -1 && tick < at) {
                    const run = rest.slice(tick).match(/^`+/)[0];
                    const close = rest.indexOf(run, tick + run.length);
                    const upTo = close === -1 ? tick + run.length : close + run.length;
                    shown += rest.slice(0, upTo);
                    rest = rest.slice(upTo);
                    continue;
                }
                if (at === Infinity) { shown += rest; break; }
                shown += rest.slice(0, at);
                comment = at === pct ? "%%" : "<!--";
                openedAt = i;
                rest = rest.slice(at + comment.length);
            }
            if (shown !== lines[i]) {
                visible[i] = shown;
                if (!shown.trim()) hidden[i] = true;
            }
        }
        if (fence) unclosed.push({ line: openedAt, what: "code block" });
        if (comment) unclosed.push({ line: openedAt, what: comment === "%%" ? "%% comment" : "<!-- comment" });

        const blocks = [];
        for (const st of starts) {
            const e = ends.find((x) => x > st);
            if (e !== undefined && !starts.some((x) => x > st && x < e) && !blocks.some((b) => b.end === e)) blocks.push({ start: st, end: e });
        }
        return { visible, hidden, frontmatterEnd, starts, ends, blocks, unclosed };
    }

    // What a line is: "entry" (a whole range), "open" (running clock), "rangeish" (a bullet that
    // looks like a range but doesn't match), "item" (any other list item), "event" (an old-style
    // meeting line), "heading" or "text"
    classify(line) {
        const bullet = line.match(TimeReport.BULLET);
        if (bullet) {
            const body = bullet[3].trim();
            const entry = body.match(TimeReport.ENTRY);
            if (entry) return { kind: entry[2] ? "entry" : "open", entry, body };
            if (TimeReport.RANGEISH.test(body)) return { kind: "rangeish", body };
            return { kind: "item", body, box: /^\[.\]/.test(body) };
        }
        const t = line.trim();
        if (/^#{1,6}\s/.test(t)) return { kind: "heading", body: t };
        if (this.indentWidth(line) === 0 && TimeReport.OLD_EVENT.test(t) && !TimeReport.LOOSE_RANGE.test(t.replace(/\[\[[^\]]*\]\]/g, ""))) return { kind: "event", body: t };
        return { kind: "text", body: t };
    }

    // Whether an event line's body carries the free mark after its title (its ⭕ links and a 🆓 aside)
    freeEvent(body) {
        return TimeReport.FREE_MARK.test(body.trimEnd().replace(TimeReport.BLOCK_ID, "").replace(TimeReport.SYMBOL_LINK, "").replace(TimeReport.FREE_WORDS, "").replace(TimeReport.EMPTY_BRACKETS, "").trimEnd());
    }

    // Whether a task or event line carries 🆓 as a word of its own (links aside), which frees every
    // entry under it, and whether it holds a 🆓 that isn't one (`Stray🆓`), which counts for nothing
    freeLine(body) {
        const text = body.replace(TimeReport.LINK, "");
        const free = TimeReport.FREE_WORD.test(text);
        return { free, stray: !free && text.includes("🆓") };
    }

    // Reads one daily note. Returns { entries, problems, events, visible }; each entry, problem and
    // event carries `context`, the task line and the lines it's nested under (nearest first), and `top`,
    // the number of the top-level line at the top of its nest (null with none), where resolve reads
    // its project. `visible` is the note's lines as scan shows them.
    // Only time directly under a top-level task or event counts (rule 7). An entry under a sub-task has
    // `subTask`: it's listed, and build counts it nowhere (rule 5). An entry anywhere else is dropped.
    // `events` are the timed event lines: { line, start, end (from the end-time line under it, or
    // null), endText, endNote, endFree (🆓 after the end line's colon), lineFree (🆓 on the event
    // line), free (ℹ️), ranges (time entries under it), minutes, text, top, subTask (nested under a
    // task or event, so its span is time under a sub-task) }. Once an event has ended, build() counts
    // a busy one with an end line as an entry (OBS-24). An event under nothing but plain bullets isn't
    // defined in the system, and isn't read.
    parseNote(text, date) {
        const lines = this.lines(text);
        const entries = [];
        const problems = [];
        const events = [];
        const { visible, hidden, starts, blocks, unclosed } = this.scan(lines);
        const problem = (i, kind, message, context = [], top = null) =>
            problems.push({ date, line: i + 1, kind, message, text: (visible[i].trim() || lines[i].trim()), context, top });
        const inBlock = new Array(lines.length).fill(false);
        for (const b of blocks) for (let j = b.start; j <= b.end; j++) inBlock[j] = true;
        for (const s of starts) {
            if (!blocks.some((b) => b.start === s)) problem(s, "markers", "has no matching `%% time:end %%`, so it's ignored; lines after it are still read");
        }
        for (const u of unclosed) problem(u.line, "unclosed", `opens a ${u.what} that never closes, so nothing after it is read`);

        const stack = [];        // open ancestors: { width, kind, body, line }
        const strayFlagged = new Set();   // lines with a 🆓 that isn't a word, said once each
        const stray = (c, top) => {
            if (strayFlagged.has(c.line)) return;
            strayFlagged.add(c.line);
            problem(c.line, "free", "has a 🆓 that isn't on its own, so it doesn't count; put a space before it", [{ body: c.body, line: c.line + 1 }], top);
        };
        let oldEvent = null;     // an old-style meeting line still collecting bullets at its own level
        const timedKinds = ["entry", "open", "rangeish"];
        // A checklist or event line, the only lines a nest has a top among
        const isLine = (c) => c.box || c.kind === "event";
        // The outermost of `chain` (nearest first) that's one, and its line number when it's at the left edge
        const topOf = (chain) => {
            const node = chain.filter(isLine).at(-1) ?? null;
            return { node, line: node?.width === 0 ? node.line : null };
        };

        for (let i = 0; i < lines.length; i++) {
            if (hidden[i]) continue;
            if (inBlock[i]) { stack.length = 0; oldEvent = null; continue; }
            const raw = visible[i];
            if (!raw.trim() || raw.trim() === TimeReport.START || raw.trim() === TimeReport.END) continue;

            const width = this.indentWidth(raw);
            while (stack.length && stack[stack.length - 1].width >= width) stack.pop();
            const node = { width, line: i, ...this.classify(raw) };
            const ancestors = stack.slice().reverse();
            stack.push(node);

            const timed = timedKinds.includes(node.kind);
            // An event line, and what sits under it: its end-time line, or time entries in its place
            const head = node.kind === "item" && node.box && node.body.match(TimeReport.EVENT_HEAD);
            if (head) {
                const mark = this.freeLine(node.body);
                const chain = [node, ...ancestors.filter((a) => !(a.kind === "text" && a.width > 0))];
                const top = topOf(chain);
                node.event = {
                    date, line: i + 1, start: this.minutes(head[1]), startText: head[1], end: null, endText: null, endBare: false,
                    endNote: "", endFree: false, endStray: false, lineFree: mark.free, lineStray: mark.stray,
                    free: this.freeEvent(node.body), ranges: false, minutes: 0, text: raw.trim().replace(/\t+/g, " "),
                    context: chain.map((c) => ({ body: c.body, line: c.line + 1 })), top: top.line, subTask: top.node !== node,
                };
                if (node.event.start !== null && top.line !== null) events.push(node.event);
            }
            // Entries directly under the event are its time; a sub-task's entries are the sub-task's
            const under = ancestors.find((a) => a.event)?.event;
            if (under && timed) {
                if (ancestors[0].event) under.ranges = true;
            } else if (under && ancestors[0].event && node.kind === "item" && !node.box) {
                const end = node.body.match(TimeReport.END_LINE);
                if (end && this.minutes(end[1]) === null) {
                    const chain = ancestors.filter((a) => !(a.kind === "text" && a.width > 0));
                    problem(i, "format", "isn't a real time, so it isn't the event's end", chain.map((c) => ({ body: c.body, line: c.line + 1 })), topOf(chain).line);
                    continue;
                }
                if (end) {
                    // The sync's bare end line wins; a noted one (`4:30pm: 🆓`) stands until a bare one comes
                    const bare = !node.body.slice(end.index + end[1].length).includes(":");
                    if (under.endText === null || (bare && !under.endBare)) {
                        const note = (end[2] ?? "").trim();
                        under.end = this.minutes(end[1]);
                        under.endText = end[1];
                        under.endBare = bare;
                        under.endFree = /^🆓/u.test(note);
                        under.endNote = under.endFree ? note.replace(/^🆓\uFE0F?\s*/u, "") : note;
                        under.endStray = !under.endFree && note.includes("🆓");
                    }
                    continue;
                }
            }
            if (width === 0) {
                if (node.kind === "event") oldEvent = node;
                else if (node.kind === "heading" || node.kind === "text" || node.box) oldEvent = null;
            }
            // Nested under an entry: a note about that entry
            if (ancestors.some((a) => timedKinds.includes(a.kind))) continue;

            // Indented continuation text isn't what an entry hangs from
            let context = ancestors.filter((a) => !(a.kind === "text" && a.width > 0));
            if (!context.length && oldEvent) context = [oldEvent];
            // Plain bullets (not checkboxes) and what's under them are never entries: an itinerary,
            // a list of notes. Only a task or event can hold time.
            const plainParent = context.length > 0 && context[0].kind === "item" && !context[0].box;
            // The top of the nest: the outermost task or event line this sits under
            const top = topOf(context);

            if (!timed) {
                // Flag what looks like a time range where an entry could have been meant: a checkbox
                // line that starts with a time, a line under a task or event, or a line starting with a
                // time. Prose, plain lists and tasks that mention "haircut 2-3pm" are left alone.
                const candidate = (node.box ? /^\[.\]\s*\d/.test(node.body) : false)
                    || ((node.kind === "item" && !node.box || (node.kind === "text" && width > 0)) && context.length > 0 && !plainParent)
                    || (width === 0 && node.kind === "text" && /^[\d>]/.test(node.body));
                if (candidate && TimeReport.LOOSE_RANGE.test(node.body) && !/^\[[<>]\]/.test(node.body)
                    && !/^\[-\]\s+(?:all day|\d{1,2}:\d{2}\s?[ap]m)\t/i.test(node.body)) {
                    problem(i, "format", "looks like a time range but isn't a `- h:mmam - h:mmpm` bullet, so it isn't counted",
                        context.map((c) => ({ body: c.body, line: c.line + 1 })), top.line);
                }
                continue;
            }
            // A list under a plain bullet with no task or event above it: an itinerary, never time
            if (plainParent && !top.node) continue;

            const ctx = context.map((c) => ({ body: c.body, line: c.line + 1 }));

            // What looks like time with its format off is listed wherever it could have been meant as
            // time; a well-formed entry is read only where it counts, below
            if (node.kind === "rangeish") {
                problem(i, "format", "doesn't match `h:mmam - h:mmpm`, so it isn't counted", ctx, top.line);
                continue;
            }
            if (node.kind === "open") {
                problem(i, "open", "clock still running (no end time), so it isn't counted", ctx, top.line);
                continue;
            }

            const [, startText, endText, noteRaw] = node.entry;
            const start = this.minutes(startText);
            let end = this.minutes(endText);
            if (start === null || end === null) {
                problem(i, "format", "isn't a real time, so it isn't counted", ctx, top.line);
                continue;
            }
            let crossesMidnight = false;
            if (end < start) {
                if (/pm$/i.test(startText) && /am$/i.test(endText)) {
                    end += 1440;
                    crossesMidnight = true;
                } else {
                    problem(i, "order", "ends before it starts, so it isn't counted", ctx, top.line);
                    continue;
                }
            }
            if (end === start) {
                problem(i, "zero", "starts and ends at the same time", ctx, top.line);
                continue;
            }

            // Only time directly under a top-level task or event counts (rule 7). Under a sub-task it's
            // listed (rule 5); anywhere else it's nothing the system defines, and isn't read at all.
            const direct = top.line !== null && context[0] === top.node;
            const subTask = !direct && top.line !== null && isLine(context[0]);
            if (!direct && !subTask) continue;

            const note = (noteRaw ?? "").trim();
            const own = /^🆓/u.test(note);
            // 🆓 on the task or event line, or a line above it, frees every entry under it
            const marks = context.map((c) => (c.freeLine ??= this.freeLine(c.body)));
            const above = marks.some((m) => m.free);
            const free = own || above;
            const entry = {
                date, line: i + 1, start, end, minutes: end - start, crossesMidnight, free,
                note: free ? note.replace(/^🆓\uFE0F?\s*/u, "") : note,
                task: this.taskText(context[0].body),
                context: ctx,
                top: top.line,
                ...(subTask ? { subTask } : {}),
            };
            entries.push(entry);
            if (subTask) {
                problem(i, "subtime", TimeReport.SUB_TIME, ctx, top.line);
                continue;
            }

            if (!own && note.includes("🆓")) problem(i, "free", "has 🆓 after other text, so it doesn't count; put 🆓 right after the colon", ctx, top.line);
            if (own && above) problem(i, "free", "has 🆓 here and on the line above; one is enough", ctx, top.line);
            if (!above) context.filter((c, k) => marks[k].stray).forEach((c) => stray(c, top.line));
            if (entry.minutes >= TimeReport.LONG_MINUTES) problem(i, "long", `is ${this.hours(entry.minutes)} hours long`, ctx, top.line);
        }
        // What each timed event is worth. A free one (ℹ️) is never counted and never a Problem.
        // Entries under a busy one are its time, so its end line is ignored, and a 🆓 left there is
        // said so. Otherwise its span runs from its start to its end line, past midnight when it
        // reads pm → am; a busy event with no usable end is a Problem like a running clock, except
        // that a zero-length one (a reminder) is quietly nothing.
        // Each carries the event's start, so build() can hold it back until the event has begun
        const eventProblem = (ev, kind, message) => problems.push({ date, line: ev.line, kind, message, text: ev.text, context: ev.context, start: ev.start, top: ev.top });
        for (const ev of events) {
            if (ev.free) continue;
            if (ev.lineStray) stray({ line: ev.line - 1, body: ev.context[0].body }, ev.top);
            if (ev.ranges) {
                if (ev.endFree) eventProblem(ev, "free", "has 🆓 on its end line, but the entries under it are its time, so it doesn't apply; put 🆓 on the entries or the event line");
                ev.end = null;
                continue;
            }
            if (ev.end === null) { eventProblem(ev, "open", "has no end time under it, so it isn't counted"); continue; }
            if (ev.end < ev.start) {
                if (/pm$/i.test(ev.startText) && /am$/i.test(ev.endText)) {
                    ev.end += 1440;
                    ev.crossesMidnight = true;
                } else {
                    eventProblem(ev, "order", "ends before it starts, so it isn't counted");
                    ev.end = null;
                    continue;
                }
            } else if (ev.end === ev.start) {
                ev.end = null;
                continue;
            }
            ev.minutes = ev.end - ev.start;
            if (ev.subTask) { eventProblem(ev, "subtime", TimeReport.SUB_TIME); continue; }
            if (ev.lineFree && ev.endFree) eventProblem(ev, "free", "has 🆓 on the event line and on its end line; one is enough");
            if (ev.endStray) eventProblem(ev, "free", "has 🆓 after other text on its end line, so it doesn't count; put 🆓 right after the colon");
            if (ev.minutes >= TimeReport.LONG_MINUTES) eventProblem(ev, "long", `is ${this.hours(ev.minutes)} hours long`);
        }
        return { entries, problems, events, visible };
    }

    // An ended busy event with its end line, as the entry the report counts: its span, the end
    // line's note, 🆓 from the end line or the event line, and the title as its task
    eventEntry(ev) {
        return {
            date: ev.date, line: ev.line, path: ev.path, project: ev.project, ...(ev.archived ? { archived: true } : {}), ...(ev.subTask ? { subTask: true } : {}), start: ev.start, end: ev.end, minutes: ev.minutes,
            crossesMidnight: !!ev.crossesMidnight, free: ev.endFree || ev.lineFree, note: ev.endNote,
            task: this.taskText(ev.context[0].body), context: ev.context, startText: ev.startText, endText: ev.endText, text: ev.text,
        };
    }

    // A task or event line as plain text for a table: no checkbox, event time, symbol links or
    // date breadcrumbs; other links show their alias. A 🆓 comes out: a timesheet shows it in its own
    // column (OBS-242).
    taskText(body) {
        const text = body.trimEnd().replace(TimeReport.BLOCK_ID, "")
            .replace(/^\[.\]\s*/, "")
            .replace(/^\[\[\d{4}-\d{2}-\d{2}\|[^\]]*\]\]\s*/, "")
            .replace(TimeReport.OLD_EVENT, "")
            .replace(/^all day\b/i, "")
            .replace(TimeReport.SYMBOL_LINK, "")
            .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
            .replace(/\[\[([^\]#]*)(?:#[^\]]*)?\]\]/g, "$1");
        return text.replace(TimeReport.FREE_WORDS, "").replace(TimeReport.EMPTY_BRACKETS, "")
            .replace(/\s+/g, " ")
            .trim()
            .replace(TimeReport.FREE_MARK, "")
            .trim();
    }

    links(body) {
        return [...body.matchAll(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)].map((m) => ({
            target: m[1].split(/[#^]/)[0].trim(),
            alias: (m[2] ?? "").trim(),
        })).filter((l) => l.target && !TimeReport.DATE_LINK.test(l.target));
    }

    // ---------------------------------------------------------------- projects
    // `index` answers questions about notes: { linkDest(linktext, fromPath) → path | null,
    // isProject(path), isArea(path), isInvoice(path), isTimesheet(path), parentLink(path) → "[[link]]" |
    // null, exists(path), kind(path) ("day", "week", "month", "year" or "other": Schedule's test, kept for
    // the run), inSystem(path) (rule 12, OBS-208), inInbox(path), paths() (every note) }. makeIndex builds
    // one from plain data (tests); appIndex from Obsidian's metadata cache.
    //
    // Time counts toward a project or an area (OBS-51). An area (#area) takes time linked to it, or to
    // a note filed straight under it, as its own row, but it's never a parent: projects inside it
    // don't add up into it, so it isn't a total of anything.
    counts(path, index) {
        return index.isProject(path) || index.isArea(path);
    }

    // An area and not also a project: its own row, never a parent, 🆓 unless it sets a rate
    isAreaOnly(path, index) {
        return index.isArea(path) && !index.isProject(path);
    }

    // A project or area's link in a report: [[Name]], or [[path/Name|Name]] when another note has its
    // name. An area's link is plain too: the tables list areas under an **Area** row (OBS-167).
    reportLink(target, path) {
        const name = this.basename(path);
        return target === name ? `[[${name}]]` : `[[${target}|${name}]]`;
    }

    // The mark on a line's link to a project or area: ⭕, or 🗃️ for an area
    linkMark(path, index) {
        return this.isAreaOnly(path, index) ? "🗃️" : "⭕";
    }

    dirname(path) {
        return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    }

    basename(path) {
        return path.split("/").pop().replace(/\.md$/, "");
    }

    // What a note's `parent` points at, when `want` says yes to it. Read only for an archived project
    // (parentProject); parentProblems compares it with the folder.
    areaProject(path, index, want = (p) => index.isProject(p)) {
        const target = index.parentLink(path)?.match(/\[\[([^\]|#]+)/)?.[1]?.trim();
        const dest = target ? index.linkDest(target, path) : null;
        return dest && dest !== path && want(dest) ? dest : null;
    }

    // `parent` links a note to the project or area it's filed under, a copy of what its folder says that
    // decides nothing (rule 3), or an invoice to the project it bills (OBS-175). Older notes call it
    // `area`, which is read when a note has no `parent`, so a vault works before its notes are renamed.
    // A note's `parent` link from its frontmatter (`area` on older notes), or null. One pass over
    // the keys, since the report asks for every note's
    parentValue(fm) {
        if (!fm) return null;
        let parent, area;
        for (const k in fm) {
            const lower = k.toLowerCase();
            if (lower === "parent") parent ??= fm[k];
            else if (lower === "area") area ??= fm[k];
        }
        return this.firstLink(parent) ?? this.firstLink(area);
    }

    // A property's link: the value, or a list's first; null when it's empty or not text
    firstLink(value) {
        const first = Array.isArray(value) ? value[0] : value;
        return typeof first === "string" && first.trim() ? first : null;
    }

    // The nearest folder note at or above `dir` that `want` says yes to
    nearestProjectFolder(dir, path, index, want = (p) => index.isProject(p)) {
        for (; dir; dir = this.dirname(dir)) {
            const folderNote = `${dir}/${this.basename(dir)}.md`;
            if (folderNote !== path && index.exists(folderNote) && want(folderNote)) return folderNote;
        }
        return null;
    }

    // The project or area a note belongs to: itself if it's one, else the nearest project or area
    // folder note above it. Its `parent` says nothing (rule 3).
    projectOfNote(path, index) {
        const counts = (p) => this.counts(p, index);
        if (counts(path)) return path;
        return this.nearestProjectFolder(this.dirname(path), path, index, counts);
    }

    // The project a project sits inside: the nearest project folder note above its own folder. Never an
    // area, and an area has none: time doesn't roll up into an area, and an area filed inside a project
    // isn't a sub-project billed at its rate. A sub-project's folder can be moved into Archive alone, so
    // a project there reads its `parent` when no folder gives it one (Brian, 2026-10-28); that's the
    // one place a project's `parent` is read (rule 3).
    parentProject(path, index) {
        if (this.isAreaOnly(path, index)) return null;
        let dir = this.dirname(path);
        if (this.basename(dir) === this.basename(path)) dir = this.dirname(dir);
        return this.nearestProjectFolder(dir, path, index) ?? (this.isArchived(path) ? this.areaProject(path, index) : null);
    }

    // The links that end a line (OBS-90): { marks: its ⭕ and 🗃️ links, notes: its ⋯ links, from: its ↗
    // links, due: its 🚩 links, title: the link an old event's title is wrapped in, or null }, each
    // { target, alias }. Only the run of links that ends the line counts, stepping over the free mark
    // and 🆓 among them, and a block ID after them; a link in the text is part of the title.
    lineLinks(body) {
        const marks = [], own = [], from = [], due = [];
        let rest = body.trimEnd().replace(TimeReport.BLOCK_ID, "").trimEnd();
        for (;;) {
            const link = rest.match(TimeReport.TRAIL_LINK);
            if (link) {
                const target = link[1].split(/[#^]/)[0].trim();
                const symbol = link[2].replace(/[️\s]/g, "");
                if (/^(?:⭕|🗃)$/u.test(symbol)) marks.unshift({ target, alias: link[2] });
                else if (symbol === "⋯") own.unshift({ target, alias: link[2] });
                else if (symbol === "↗") from.unshift({ target, alias: link[2] });
                else if (symbol.startsWith("🚩")) due.unshift({ target, alias: link[2] });
                rest = rest.slice(0, link.index).trimEnd();
                continue;
            }
            const mark = rest.match(TimeReport.TRAIL_MARK);
            if (mark && mark.index > 0) { rest = rest.slice(0, mark.index).trimEnd(); continue; }
            break;
        }
        const notes = own.filter((l) => l.target);
        const wrapped = notes.length ? null : rest.trim().match(TimeReport.WRAPPED_TITLE);
        const title = wrapped ? { target: wrapped[1].split(/[#^]/)[0].trim(), alias: "" } : null;
        return { marks: marks.filter((l) => l.target), notes, from, due, title: title?.target ? title : null };
    }

    // Where a line's project is read when the line isn't one a top-level line can be: { project: null, … }
    static NO_PLACE = { project: null, archived: false, live: null, conflict: null };

    // The one project lookup (rules 4 and 18): where the time at line `i` of the note at `path` counts.
    // `lineAt(n)` gives line n, as it shows. `top` is the top of the line's nest when the caller knows it
    // (nestTop can't see a bullet at the left edge under a meeting line in the form used before August
    // 2025, which is that meeting's time; parseNote can), else nestTop finds it. { project, archived,
    // live, conflict }:
    //   project   the top line's ⭕ or 🗃️, or null. Nothing else on any line says where time goes.
    //   archived  whether that project is in Archive.
    //   live      what a command and Billing read: `project`, or for an archived one the live project
    //             the line's other link names, else null (OBS-213).
    //   conflict  null, or what the line disagrees with: nothing decides, and `project` holds the ⭕ the
    //             line names first. { links: [paths] } for two project links that name different projects,
    //             or { note, noteProject } for a ⭕ against the project its own note is filed in. Each with
    //             `lineProject`, and `event` for an event line, as the Problem is worded for one.
    // In a note that isn't a daily, weekly, monthly or yearly note a line has no project of its own, and
    // a line whose top isn't a checklist or event line at the left edge isn't defined in the system.
    resolve(lineAt, i, path, index, top = this.nestTop(lineAt, i)) {
        if (index.kind(path) === "other") return TimeReport.NO_PLACE;
        const line = lineAt(top);
        if (!line || this.indentWidth(line) > 0) return TimeReport.NO_PLACE;
        const read = this.classify(line);
        if (read.kind !== "event" && !read.box) return TimeReport.NO_PLACE;
        const links = this.lineLinks(read.body);
        const named = this.named(links, path, index);
        const project = named[0] ?? null;
        if (!project) return TimeReport.NO_PLACE;
        const archived = this.isArchived(project);
        const event = this.eventKind(line) !== null;
        // Its own note is read only to compare with the ⭕, never in its place
        const own = this.ownNote(links, path, index);
        const noteProject = own.map((note) => ({ note, noteProject: this.projectOfNote(note, index) })).find((n) => n.noteProject && n.noteProject !== project) ?? null;
        const conflict = named.length > 1 ? { links: named, lineProject: project, event }
            : noteProject ? { ...noteProject, lineProject: project, event } : null;
        const live = !archived ? project : named.find((p) => !this.isArchived(p)) ?? (noteProject && !this.isArchived(noteProject.noteProject) ? noteProject.noteProject : null);
        return { project, archived, live, conflict };
    }

    // The projects and areas a line's ⭕ and 🗃️ links (lineLinks) name, each once
    named(links, path, index) {
        const dest = (l) => (TimeReport.DATE_LINK.test(l.target) ? null : index.linkDest(l.target, path));
        return [...new Set(links.marks.map(dest))].filter((d) => d && this.counts(d, index));
    }

    // A line's own notes, as `links` (lineLinks) gives them: what its ⋯ links, and the log an older
    // event's title is wrapped in, when that note is in the system or in Archive. A ⋯ to any other note
    // is a reference, which nothing compares, and a ↗ is read by nobody (rule 4, *Words*).
    ownNote(links, path, index) {
        return [...links.notes, ...(links.title ? [links.title] : [])]
            .map((l) => (TimeReport.DATE_LINK.test(l.target) ? null : index.linkDest(l.target, path)))
            .filter((p) => p && (index.inSystem(p) || this.isArchived(p)));
    }

    // The project or area line `i` of `note` ({ path }) counts toward, as resolve reads it; outside the
    // periodic notes, the one its note is in (rule 4). With `live`, for a command, an archived ⭕ is passed
    // over; the task checks read the line as the report counts it, archived projects included (OBS-213).
    // Where the line disagrees with itself it's the ⭕, so the checks don't list the line a second time.
    lineProject(note, i, lines, index, live = true) {
        if (index.kind(note.path) === "other") return this.projectOfNote(note.path, index);
        const where = this.resolve((n) => lines[n], i, note.path, index);
        return live ? where.live : where.project;
    }

    // A note's lines as the checks read them: what Obsidian shows (scan), with the report's own blocks
    // left out, as parseNote leaves them out. Kept on `note`, since each check reads the same ones.
    shown(note) {
        if (note.shown) return note.shown;
        const { visible, blocks } = this.scan(this.lines(note.text));
        for (const b of blocks) visible.fill("", b.start, b.end + 1);
        return (note.shown = visible);
    }

    // The day a line in a periodic note (`kind`) is listed under: its own, or a week's, month's or year's first
    noteDate(note, kind) {
        return kind === "day" ? note.date ?? this.dailyDate(note.path) : this.periodStart(note.path, kind) ?? this.today();
    }

    // Every top-level line in the periodic notes among `notes` that disagrees with itself or its own note
    // (rule 15), with or without time under it: a ⭕ against the project its own note is filed in, two
    // project links that name different projects, and a ⭕ while its own note waits in the Inbox. One record
    // per line on each project it names, { project, conflict: { side, kind, date, path, line, text, event,
    // lineProject, and note and noteProject, or links, or note and inbox } }. Both sides say the same, so a
    // period's report shows `side` "line" only (inScope). Plain, so the report, renderReports.mjs and the
    // private test run the same code.
    ownNoteProblems(notes, index) {
        const out = [];
        for (const note of notes) {
            const kind = index.kind(note.path);
            if (kind === "other" || !/⭕|🗃/u.test(note.text)) continue;
            const lines = this.shown(note);
            const lineAt = (n) => lines[n];
            lines.forEach((text, i) => {
                if (!/^\S/.test(text) || !/⭕|🗃/u.test(text)) return;
                const { project, conflict } = this.resolve(lineAt, i, note.path, index, i);
                if (!project) return;
                const at = { kind, date: this.noteDate(note, kind), path: note.path, line: i + 1, text: text.trim(), event: this.eventKind(text) !== null, lineProject: project };
                if (conflict?.links) conflict.links.forEach((p, k) => out.push({ project: p, conflict: { ...at, side: k ? "note" : "line", links: conflict.links } }));
                else if (conflict) {
                    const { note: own, noteProject } = conflict;
                    out.push({ project, conflict: { ...at, side: "line", note: own, noteProject } }, { project: noteProject, conflict: { ...at, side: "note", note: own, noteProject } });
                } else {
                    const waiting = this.ownNote(this.lineLinks(this.classify(text).body), note.path, index).find((n) => index.inInbox(n));
                    if (waiting) out.push({ project, conflict: { ...at, side: "line", note: waiting, inbox: true } });
                }
            });
        }
        return out;
    }

    // Every mark on a sub-task (rules 5 and 15): a ⭕, 🗃️, 🚩, ⋯, ↗ or task ID on a checklist line nested
    // under a task or event at the left edge. [{ path, line, text, message }], line counted from 0. A block
    // ID counts only when it's a task's, which a sent line ([>], or one with a forward date) makes it.
    subTaskProblems(notes, T) {
        const tasks = new Set(), out = [];
        for (const note of notes) {
            for (const line of this.shown(note)) {
                const box = line.match(T.CHECKBOX), id = box ? T.idOf(line) : null;
                if (id && (box[1] === ">" || T.forwardOf(line))) tasks.add(id.toLowerCase());
            }
        }
        for (const note of notes) {
            const lines = this.shown(note);
            const lineAt = (n) => lines[n];
            lines.forEach((text, i) => {
                if (!/^\s/.test(text) || !T.CHECKBOX.test(text)) return;
                const top = this.nestTop(lineAt, i);
                if (top === i || this.indentWidth(lines[top]) > 0) return;
                const { marks, notes: own, from, due } = this.lineLinks(this.classify(text).body);
                const id = T.idOf(text);
                const home = (symbol) => marks.some((l) => l.alias.startsWith(symbol));
                const found = [...(home("⭕") ? ["⭕"] : []), ...(home("🗃") ? ["🗃️"] : []), ...(due.length ? ["🚩"] : []), ...(own.length ? ["⋯"] : []), ...(from.length ? ["↗"] : []),
                    ...(id && tasks.has(id.toLowerCase()) ? ["task ID"] : [])];
                if (!found.length) return;
                const list = found.length > 1 ? `${found.slice(0, -1).join(", ")} and ${found.at(-1)}` : found[0];
                out.push({ path: note.path, line: i, text: text.trim(), message: `is nested, so its ${list} count${found.length > 1 ? "" : "s"} for nothing: only a task at the left edge can carry ${found.length > 1 ? "them" : "it"}; outdent it, or take ${found.length > 1 ? "them" : "it"} off` });
            });
        }
        return out;
    }

    // The project or area a note's folder puts it in: for a project or area's own note, the one above
    folderProject(path, index) {
        let dir = this.dirname(path);
        if (this.basename(dir) === this.basename(path)) dir = this.dirname(dir);
        return this.nearestProjectFolder(dir, path, index, (p) => this.counts(p, index));
    }

    // Every note in Projects or the Inbox whose `parent` names another project or area than its folder does
    // (rule 15), on the notes of both: { project, kind: "parent", only: "project", path, named, folder }. A
    // note with no `parent` isn't compared, nor is one that names no project, an invoice, a timesheet
    // or anything in Archive, where a note's `parent` is left as it was on purpose.
    parentProblems(index) {
        const out = [];
        for (const path of index.paths()) {
            const named = this.isArchived(path) ? null : this.areaProject(path, index, (p) => this.counts(p, index));
            if (!named || index.isInvoice(path) || index.isTimesheet(path) || index.kind(path) !== "other" || !index.inSystem(path)) continue;
            const folder = this.folderProject(path, index);
            if (named === folder) continue;
            for (const project of [folder, named]) if (project) out.push({ project, kind: "parent", only: "project", path, named, folder });
        }
        return out;
    }

    // Same answers as appIndex, from [{ path, tags, parent, props }] (tags as Obsidian collects them,
    // frontmatter and inline; props is the frontmatter, for rate and caps). `area` stands in for
    // `parent` on a note that has none, as in an older note's frontmatter. `kind`, `inSystem` and `inInbox`
    // say what a path is; by default a note in the Planner's folders is periodic, every note is in the
    // system, and an `Inbox` folder is the Inbox.
    makeIndex(notes, {
        kind = (path) => TimeReport.PLANNER_KIND[path.match(/(?:^|\/)Planner\/(days|weeks|months|years)\/[^/]+$/)?.[1]] ?? "other",
        inSystem = () => true,
        inInbox = (path) => path.startsWith("Inbox/"),
    } = {}) {
        const byPath = new Map(notes.map((n) => [n.path, n]));
        const byLower = new Map();
        for (const n of notes) {
            const key = n.path.replace(/\.md$/, "").toLowerCase();
            byLower.set(key, n.path);
        }
        const tagged = (path, tag) => [].concat(byPath.get(path)?.tags ?? []).some((t) => String(t).replace(/^#/, "").toLowerCase() === tag);
        return {
            exists: (path) => byPath.has(path),
            isProject: (path) => tagged(path, "project"),
            isArea: (path) => tagged(path, "area"),
            isInvoice: (path) => tagged(path, "invoice"),
            isTimesheet: (path) => tagged(path, "timesheet"),
            kind,
            inSystem,
            inInbox,
            paths: () => notes.map((n) => n.path),
            parentLink: (path) => {
                const n = byPath.get(path);
                return n ? this.firstLink(n.parent) ?? this.firstLink(n.area) : null;
            },
            props: (path) => byPath.get(path)?.props ?? {},
            linkDest: (linktext) => {
                const want = linktext.replace(/\.md$/, "").toLowerCase();
                if (byLower.has(want)) return byLower.get(want);
                const hits = notes.filter((n) => n.path.replace(/\.md$/, "").toLowerCase().endsWith(`/${want}`));
                return hits.sort((a, b) => a.path.length - b.path.length)[0]?.path ?? null;
            },
        };
    }

    // ---------------------------------------------------------------- the model

    isArchived(path) {
        return !!path && path.startsWith(TimeReport.ARCHIVE);
    }

    // A property's date as YYYY-MM-DD ("2026-09-30", "2026-09-30T09:00", a Date), a real day only, or null
    isoDate(value) {
        const m = (typeof value?.toISOString === "function" ? value.toISOString() : String(value ?? "")).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
        if (!m) return null;
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        return d.toISOString().slice(0, 10) === `${m[1]}-${m[2]}-${m[3]}` ? d.toISOString().slice(0, 10) : null;
    }

    // A frontmatter number: 100, "100", "$1,250.00"; else null
    number(value) {
        const n = typeof value === "number" ? value : parseFloat(String(value ?? "").replace(/[$,\s]/g, ""));
        return Number.isFinite(n) && n > 0 ? n : null;
    }

    prop(props, name) {
        const key = Object.keys(props ?? {}).find((k) => k.toLowerCase() === name);
        return key ? props[key] : undefined;
    }

    // notes: [{ date: "YYYY-MM-DD", path, text }]. With `now` ({ date, minutes }), entries and events
    // that haven't ended yet are left out, and don't overlap anything; without it everything counts.
    // `checked` is every note whose lines the own-note check reads (taskNotes), `notes` by default.
    build(notes, index, { now = null, checked = notes } = {}) {
        const entries = [];
        const billed = [];       // the entries as Billing read them before OBS-213, for matching billed rows (see below)
        const events = [];       // every timed event line
        const problems = [];
        const day = (date) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 864e5;
        const ended = (e) => !now || day(e.date) * 1440 + e.end <= day(now.date) * 1440 + now.minutes;
        // A line that disagrees with itself (resolve's `conflict`), or time under a sub-task: its time
        // counts nowhere and isn't billed, and a billed row on it says so. Nothing decides between two
        // projects (Brian, 2026-10-28), archived or not, so archiving a project never moves time.
        const disputed = new Set();
        // `billingEntries` are the entries as read before OBS-213: Billing matches a billed row to the
        // entry it billed among them, so a billed row reads exactly as it always did. An
        // archived entry with a live project further on is there as a copy on that project, `report`
        // naming the report's entry; one with no live project isn't there.
        const forBilling = (e, where) => (!where.archived ? e : where.live ? { ...e, project: where.live, report: e } : null);
        for (const n of notes) {
            const parsed = this.parseNote(n.text, n.date);
            // An archived project's time stays in every report, and its Problems are listed like any
            // project's (OBS-213); `archived` marks its entries, which are never billed
            const lineAt = (k) => parsed.visible[k];
            const place = (top) => (top === null ? TimeReport.NO_PLACE : this.resolve(lineAt, top, n.path, index, top));
            for (const e of parsed.entries) {
                e.path = n.path;
                const where = place(e.top);
                e.project = where.project;
                const b = forBilling(e, where);
                if (where.archived) e.archived = true;
                entries.push(e);
                if (b) billed.push(b);
                if (where.conflict || e.subTask) disputed.add(e);
            }
            for (const p of parsed.problems) {
                // The sync writes events months ahead: what's wrong with one waits until it has started
                if (p.start !== undefined && now && day(p.date) * 1440 + p.start > day(now.date) * 1440 + now.minutes) continue;
                p.path = n.path;
                p.projects = [place(p.top).project];
                problems.push(p);
            }
            // A busy event with an end line and no entries of its own counts once it has ended: its
            // span is an entry like any other, on the project its line resolves to, else Unassigned
            for (const ev of parsed.events) {
                ev.path = n.path;
                const where = place(ev.top);
                ev.project = where.project;
                ev.archived = where.archived;
                events.push(ev);
                if (ev.end !== null && !ev.free && !ev.ranges && ended(ev)) {
                    const entry = this.eventEntry(ev);
                    entries.push(entry);
                    const b = where.archived ? (where.live ? { ...this.eventEntry({ ...ev, project: where.live, archived: false }), report: entry } : null) : entry;
                    if (b) billed.push(b);
                    if (where.conflict || ev.subTask) disputed.add(entry);
                }
            }
        }
        for (const e of disputed) e.disputed = true;
        for (const b of billed) if (disputed.has(b.report ?? b)) b.disputed = true;

        // Overlaps, across every project and across midnight; an event's span overlaps like an entry's
        // A tie keeps note order, archived or not, so archiving a project rewords no overlap
        const timeline = entries.map((e) => ({ e, from: day(e.date) * 1440 + e.start, to: day(e.date) * 1440 + e.end }))
            .sort((a, b) => a.from - b.from || a.to - b.to);
        let latest = null;
        for (const t of timeline) {
            if (latest && t.from < latest.to) {
                const other = latest.e;
                const where = other.date === t.e.date ? `line ${other.line}` : `${this.shortDate(other.date)} line ${other.line}`;
                problems.push({
                    date: t.e.date, line: t.e.line, path: t.e.path, kind: "overlap",
                    message: `overlaps ${other.startText ? "the event " : ""}${this.formatTime(other.start)} - ${this.formatTime(other.end)} (${where})`,
                    text: t.e.startText ? t.e.text : `- ${this.formatTime(t.e.start)} - ${this.formatTime(t.e.end)}`,
                    projects: [t.e.project, other.project].filter(Boolean).length ? [t.e.project, other.project] : [null],
                    // The entry it overlaps, so a timesheet can mark both rows (OBS-132)
                    other: { path: other.path, line: other.line },
                });
            }
            if (!latest || t.to > latest.to) latest = t;
        }

        // Parent projects. A loop (A inside B inside A, through two archived projects' `parent`s) is cut
        // where it closes.
        const parent = new Map();
        const projectProblems = [];
        const addChain = (p) => {
            const path = [];
            while (p && !parent.has(p)) {
                // An archived sub-project stays under its live parent, whose total and hours cap count it
                // (Brian, 2026-10-28); Billing's scope leaves it out, so it's never invoiced.
                const up = this.parentProject(p, index);
                if (up && (up === p || path.includes(up))) {
                    parent.set(p, null);
                    projectProblems.push({ project: p, parent: up });
                    return;
                }
                parent.set(p, up);
                path.push(p);
                p = up;
            }
        };
        // The entries that count: every one but a disputed line's
        const kept = entries.filter((e) => !disputed.has(e));
        for (const e of kept) addChain(e.project);
        for (const e of billed) addChain(e.project);
        for (const p of problems) p.projects.forEach(addChain);

        // Lines that disagree with themselves, time or no time: said on each project they name
        for (const r of this.ownNoteProblems(checked, index)) {
            addChain(r.project);
            projectProblems.push(r);
        }
        // A chain can also close into a loop found earlier from another start
        for (const p of [...parent.keys()]) {
            const seen = new Set();
            for (let up = p; up; up = parent.get(up)) {
                if (seen.has(up)) {
                    projectProblems.push({ project: up, parent: parent.get(up) });
                    parent.set(up, null);
                    break;
                }
                seen.add(up);
            }
        }

        // Per project: its money (moneyOf), and how far up its `rate_type` came from
        const money = new Map();
        const typed = new Map();     // project → how far up its `rate_type` came from (0: its own), or -1 for none
        for (const p of parent.keys()) {
            const m = this.moneyOf(p, index);
            money.set(p, m.money);
            typed.set(p, m.typedAt);
            for (const message of m.problems) projectProblems.push({ project: p, message });
        }

        // Entries that haven't ended yet aren't work yet: out of hours and Earned alike
        const over = (e) => day(e.date) * 1440 + e.end <= day(now.date) * 1440 + now.minutes;
        const counted = now ? kept.filter(over) : kept;
        const billingEntries = now ? billed.filter(over) : billed;

        // Billable or not, decided once here rather than in `totals`, which is also called without a
        // `money` map. `free` stays exactly what it always was: the 🆓 typed on the entry.
        for (const e of [...counted, ...billingEntries]) e.billable = !e.free && !!e.project && money.get(e.project)?.type !== "non-billable";

        // A project with time on it and no `rate_type` anywhere up its chain bills by default, since
        // the alternative is invoicing nothing and never noticing. Say so, so it's set rather than assumed.
        const worked = new Set(counted.map((e) => e.project).filter(Boolean));
        for (const p of [...worked].sort()) {
            const m = money.get(p) ?? {};
            const ownRate = this.number(this.prop(index.props?.(p) ?? {}, "rate")) !== null;
            if (!m.type) projectProblems.push({ project: p, message: "has no `rate_type`, so its time counts as billable; set one (`hourly`, `flat`, `non-billable`)" });
            // An own `rate` under a non-billable parent earns nothing and now bills nothing either
            else if (m.type === "non-billable" && ownRate && typed.get(p) > 0) {
                projectProblems.push({ project: p, message: "has its own `rate` but inherits `non-billable`, so its time counts as 🆓; give it a `rate_type` of its own" });
            }
            // An area's time is its own unless it says otherwise, so a `rate` alone making it billable is
            // likely a mistake: a rate meant to value its time takes `rate_type: non-billable` (OBS-156)
            else if (this.isAreaOnly(p, index) && ownRate && typed.get(p) === -1) {
                projectProblems.push({ project: p, message: "has a `rate` and no `rate_type`, so its time counts as billable; set one (`hourly`, or `non-billable` to value its time without billing it)" });
            }
        }

        problems.sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line);
        // Areas, whose notes report by month (OBS-133)
        const areas = new Set([...parent.keys()].filter((p) => this.isAreaOnly(p, index)));
        return { entries: counted, billingEntries, disputed: now ? [...disputed].filter(over) : [...disputed], problems, parent, projectProblems, money, events, areas };
    }

    // A project's money: `rate` and `rate_type`, each from the project or else its nearest parent that
    // has one (archived parents count here), the hourly rate that Earned uses, the rate that values a
    // non-billable note's time (`invest`, OBS-156), a Rate label, the cap, a flat fee and when it was
    // earned. { money, typedAt (how far up `rate_type` came from: 0 its own, -1 none), problems }.
    // Invoice reads a flat fee with it too.
    moneyOf(p, index) {
        const problems = [];
        const set = (v) => v !== undefined && v !== null && String(v).trim() !== "";
        // Its properties and those of the projects above it, nearest first
        const chain = [];
        const seen = new Set();
        for (let up = p; up && !seen.has(up); up = this.parentProject(up, index)) {
            seen.add(up);
            chain.push(index.props?.(up) ?? {});
        }
        // Where a property is first set, from `from` up, or -1; and the `rate_type` that applies there
        const at = (name, from = 0) => chain.findIndex((props, k) => k >= from && set(this.prop(props, name)));
        const typeOf = (from) => { const k = at("rate_type", from); return k === -1 ? null : String(this.prop(chain[k], "rate_type")).trim().toLowerCase(); };
        const typeAt = at("rate_type");
        let rateAt = at("rate");
        let type = typeOf(0);
        // A rate set on a non-billable note values its time (OBS-156), down to its non-billable
        // sub-projects; a sub-project that bills never bills at it, and has no rate unless it sets one
        const valued = rateAt !== -1 && typeOf(rateAt) === "non-billable";
        if (valued && type !== "non-billable") rateAt = -1;
        const rateRaw = rateAt === -1 ? undefined : this.prop(chain[rateAt], "rate");
        const amount = rateRaw === undefined ? null : this.number(rateRaw);
        if (!type && amount !== null) type = "hourly";
        // An area is someone's own time unless it says otherwise: with neither `rate` nor
        // `rate_type` it's non-billable, and isn't asked for one (OBS-51)
        if (!type && amount === null && this.isAreaOnly(p, index)) type = "non-billable";
        const rate = type === "hourly" ? amount : null;
        // The rate that puts a value on a non-billable note's time: never its client parent's
        const invest = type === "non-billable" && valued && amount !== null ? amount : null;
        if (rateRaw !== undefined && amount === null && rateAt === 0) {
            problems.push(`has a \`rate\` that isn't a positive number (${String(rateRaw).slice(0, 20)}), so it has no Earned`);
        } else if (type === "hourly" && amount === null && rateRaw === undefined) {
            problems.push("is hourly but has no `rate`, so it has no Earned");
        }
        const dollars = amount === null ? "" : this.money(Math.round(amount * 100)).replace(/\.00$/, "");
        // A flat fee is a `rate` set where `flat` applies: never an hourly parent's rate
        const flatFee = type === "flat" && amount !== null && typeOf(rateAt) === "flat";
        const label = !type ? "" : type === "hourly" ? (dollars ? `${dollars}/hr` : "hourly")
            : type === "flat" ? (flatFee ? `${dollars} flat` : "flat")
            : invest !== null ? `${dollars}/hr ${type}` : type;
        const props = index.props?.(p) ?? {};
        const maxHours = this.number(this.prop(props, "max_hours"));
        const contract = this.number(this.prop(props, "contract_max"));
        const cap = maxHours ?? (contract !== null && rate ? contract / rate : null);
        // A flat fee, on the note that sets it: a sub-project inside a flat project is part of its fee
        const fee = flatFee && rateAt === 0 ? amount : null;
        // The day a flat fee was earned, until a flat fee can be invoiced (OBS-165): `earned` on the
        // note that sets the fee, which Invoice writes when run on a flat project
        let earned = null;
        if (set(this.prop(props, "earned"))) {
            const raw = this.prop(props, "earned");
            if (fee === null) problems.push(type === "flat" ? "has an `earned` day, but its flat fee is set above it, so the day goes there" : "has an `earned` day but no flat fee of its own, so it counts for nothing");
            else {
                earned = this.isoDate(raw);
                if (!earned) problems.push(`has an \`earned\` that isn't a date (${String(raw).slice(0, 20)}), so its fee isn't counted as earned`);
            }
        }
        return { money: { rate, type, label, capMinutes: cap === null ? null : Math.round(cap * 60), invest, fee, earned }, typedAt: typeAt, problems };
    }

    // Invoice notes as Billing reads them, in number order, then path, so the first invoice to bill an entry
    // is always the same one, whatever order the vault lists its files in
    readBilled(notes, index, billing) {
        return notes.map((n) => billing.readInvoice(n, this, index))
            .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }) || a.path.localeCompare(b.path));
    }

    // Invoice notes (OBS-5): read them, keep what they billed on the model for the timesheets, and
    // list on the project's own note (never on weekly, monthly or yearly notes) an invoice whose billed
    // entries changed since it was made (a draft's too, which says to rebuild it, OBS-143), an entry on
    // two invoices, and an invoice whose Billed entries can't be read. `notes` are [{ path, props, text }];
    // `billing` is a Billing.
    attachBilling(model, notes, index, billing) {
        const invoices = this.readBilled(notes, index, billing);
        const ledger = billing.ledger(invoices);
        const { byInvoice } = billing.invoiceChanges(model, this, index, ledger);
        model.billing = { billing, invoices, ledger, index, byInvoice };
        for (const invoice of invoices) {
            if (invoice.status === "canceled") continue;
            // Nothing says whose bill it is: its rows still mark their entries as billed, so it's listed
            // on each project they bill. It stops nothing: Billing treats it as covering every project.
            if (!invoice.project) {
                for (const project of billing.rowProjects(invoice, model, this, index)) model.projectProblems.push({ project, only: "project", invoice, noProject: true });
                continue;
            }
            // A table that can't be read would let its entries look unbilled; the Invoice command refuses
            // to invoice the project until it's fixed, and says so here
            if (invoice.problem) {
                model.projectProblems.push({ project: invoice.project, only: "project", invoice, problem: invoice.problem });
                continue;
            }
            for (const change of byInvoice.get(invoice) ?? []) {
                if (change.kind !== "wording") model.projectProblems.push({ project: invoice.project, only: "project", invoice, change });
            }
        }
        for (const twice of ledger.twice) {
            const project = twice.invoices[1].project ?? twice.invoices[0].project;
            if (project) model.projectProblems.push({ project, only: "project", twice });
        }
        return model;
    }

    // A project and every project below it
    subtree(root, parent) {
        const out = new Set([root]);
        for (const p of parent.keys()) {
            const seen = new Set();
            for (let up = p; up && !seen.has(up); up = parent.get(up)) {
                seen.add(up);
                if (up === root) { out.add(p); break; }
            }
        }
        return out;
    }

    // scope: { kind: "all" } | { kind: "month", month: "YYYY-MM" } | { kind: "project", path }
    //      | { kind: "period", unit: "week" | "month" | "year", key: "2026w38" | "2026-09" | "2026" }
    inScope(model, scope) {
        if (scope.kind === "project") {
            const set = this.subtree(scope.path, model.parent);
            return {
                entries: model.entries.filter((e) => set.has(e.project)),
                problems: model.problems.filter((p) => p.projects.some((x) => set.has(x))),
                projectProblems: model.projectProblems.filter((p) => set.has(p.project) || (p.parent && p.parent === scope.path)),
            };
        }
        const want = scope.kind === "all" ? () => true
            : scope.kind === "period" ? (d) => this.periodOf(d, scope.unit) === scope.key
            : (d) => d.startsWith(scope.month + "-");
        const entries = model.entries.filter((e) => want(e.date));
        // A problem about a project is the period's when the period has time on that project or on a
        // project below it, whose hours add up into it and which can take its rate from it (OBS-29)
        const worked = new Set();
        for (const e of entries) {
            for (let up = e.project; up && !worked.has(up); up = model.parent.get(up)) worked.add(up);
        }
        const projectProblems = [];
        for (const p of model.projectProblems) {
            // An invoice's changes, and billing settings, are for the project's own note (OBS-5)
            if (p.only === "project") continue;
            if (p.conflict) {
                // Said once, in the line's own period: its time counts nowhere, so no entry finds it,
                // and it may have none
                if (p.conflict.side === "line" && want(p.conflict.date)) projectProblems.push(p);
            } else if (worked.has(p.project) || (p.parent && worked.has(p.parent))) {
                projectProblems.push(p);
            }
        }
        return { entries, problems: model.problems.filter((p) => want(p.date)), projectProblems };
    }

    // ---------------------------------------------------------------- periods

    // The Sunday-to-Saturday week a date falls in, named like moment's gggg[w]ww in the "en" locale
    // (week 1 is the week with January 1st), e.g. 2026-09-13 → 2026w38, 2026-12-27 → 2027w01
    weekKey(date) {
        const [y, m, d] = date.split("-").map(Number);
        const day = Date.UTC(y, m - 1, d) / 864e5;
        const dow = (n) => new Date(n * 864e5).getUTCDay();
        const start = day - dow(day);
        const weekYear = new Date((start + 6) * 864e5).getUTCFullYear();
        const jan1 = Date.UTC(weekYear, 0, 1) / 864e5;
        const week = Math.floor((start - (jan1 - dow(jan1))) / 7) + 1;
        return `${weekYear}w${String(week).padStart(2, "0")}`;
    }

    dayName(date) {
        const [y, m, d] = date.split("-").map(Number);
        return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    }

    periodOf(date, unit) {
        return unit === "week" ? this.weekKey(date) : unit === "month" ? date.slice(0, 7) : date.slice(0, 4);
    }

    static PERIOD_NAME = { week: /^\d{4}w\d{2}$/, month: /^\d{4}-\d{2}$/, year: /^\d{4}$/ };

    // Every week, month and year that has at least one entry, or a flat fee earned in it:
    // { week: [...], month: [...], year: [...] }
    periodsWithEntries(model) {
        const out = {};
        // Time that isn't counted (Problems say why) has a period too, though nothing else may be in it
        const dates = [...model.entries.map((e) => e.date), ...(model.disputed ?? []).map((e) => e.date), ...this.earnedFees(model).map((f) => f.date)];
        for (const unit of ["week", "month", "year"]) {
            out[unit] = [...new Set(dates.map((d) => this.periodOf(d, unit)))].sort();
        }
        return out;
    }

    // The flat fees with an `earned` day: [{ project, date, cents }], archived projects' included
    // (OBS-213). A day still to come counts now, in its period: a fee invoiced ahead (Brian, 2026-10-11).
    earnedFees(model) {
        return [...(model.money ?? new Map())].filter(([, m]) => m.fee && m.earned)
            .map(([project, m]) => ({ project, date: m.earned, cents: Math.round(m.fee * 100) }));
    }

    // First and last day (YYYY-MM-DD) of a week key, for its title
    weekRange(key) {
        const weekYear = +key.slice(0, 4), week = +key.slice(5);
        const jan1 = Date.UTC(weekYear, 0, 1) / 864e5;
        const start = jan1 - new Date(jan1 * 864e5).getUTCDay() + (week - 1) * 7;
        const iso = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
        return [iso(start), iso(start + 6)];
    }

    // Frontmatter for a new periodic note: the same aliases the Weekly Note and Monthly Note templates
    // write ("Week of 9/13/26", "September 2026"); the Yearly Note template writes none. Keep in step
    // with those templates.
    periodFrontmatter(unit, key) {
        if (unit === "week") return `---\naliases: Week of ${this.shortDate(this.weekRange(key)[0])}\n---\n`;
        if (unit === "month") return `---\naliases: ${this.monthTitle(key)}\n---\n`;
        return "";
    }

    // Where a project's timesheet note goes when it has none yet: beside the project's note
    sheetPath(project) {
        const dir = this.dirname(project);
        return `${dir ? `${dir}/` : ""}${this.basename(project)}${TimeReport.SHEET}.md`;
    }

    // The whole of a new timesheet note: an id, the timesheet tag, its project as `parent` and the class for
    // its day bands (OBS-242), then its report, with no heading: the whole note is the report (OBS-167)
    sheetNote(id, parent, block) {
        return `---\nid: ${id}\ntags:\n  - timesheet\nparent: ${JSON.stringify(parent)}\ncssclasses:\n  - ${TimeReport.SHEET_CLASS}\n---\n\n${block}\n`;
    }

    // The edit { start, end, text } that gives a timesheet made before OBS-242 its class, keeping any
    // class it has: `cssclasses` as a list (indented or not), `[a, b]` or one class. Null when it has
    // it, has no properties, or has `cssclasses` in a form this doesn't read (a comment after it, a list
    // over several lines): a note left as it is beats properties that no longer parse, which would lose
    // its `timesheet` tag.
    sheetClass(content) {
        const cls = TimeReport.SHEET_CLASS;
        const nl = content.includes("\r\n") ? "\r\n" : "\n";
        const lines = content.split("\n").map((l) => l.replace(/\r$/, ""));
        if (lines[0] !== "---") return null;
        const close = lines.findIndex((l, i) => i > 0 && /^(?:---|\.\.\.)\s*$/.test(l));
        if (close === -1) return null;
        const offset = (n) => content.split("\n").slice(0, n).reduce((sum, l) => sum + l.length + 1, 0);
        const unquote = (v) => v.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
        const KEY = /^(["']?)cssclasses\1\s*:(.*)$/;
        const key = lines.findIndex((l, i) => i > 0 && i < close && KEY.test(l));
        if (key === -1) return { start: offset(close), end: offset(close), text: `cssclasses:${nl}  - ${cls}${nl}` };
        const value = lines[key].match(KEY)[2].trim();
        const whole = { start: offset(key), end: offset(key) + lines[key].length };
        if (value.includes("#")) return null;
        if (!value) {
            // Its items, with blank and comment lines between them; the new one goes after the last
            let last = key;
            for (let j = key + 1; j < close; j++) {
                if (/^\s*-(?:\s|$)/.test(lines[j])) last = j;
                else if (lines[j].trim() && !lines[j].trim().startsWith("#")) break;
            }
            const items = lines.slice(key + 1, last + 1).filter((l) => /^\s*-(?:\s|$)/.test(l));
            if (items.some((l) => unquote(l.replace(/^\s*-/, "")) === cls)) return null;
            const indent = items.length ? items[0].match(/^\s*/)[0] : "  ";
            return { start: offset(last + 1), end: offset(last + 1), text: `${indent}- ${cls}${nl}` };
        }
        if (value.startsWith("[")) {
            if (!value.endsWith("]")) return null;
            const items = value.slice(1, -1).split(",").map((v) => v.trim()).filter(Boolean);
            return items.some((v) => unquote(v) === cls) ? null : { ...whole, text: `cssclasses: [${[...items, cls].join(", ")}]` };
        }
        if (/^(?:null|~)$/i.test(value)) return { ...whole, text: `cssclasses:${nl}  - ${cls}` };
        if (/^[{|>&*!]/.test(value)) return null;
        return unquote(value) === cls ? null : { ...whole, text: `cssclasses:${nl}  - ${value}${nl}  - ${cls}` };
    }

    // Whether a note gets a timesheet: a project does, an area doesn't, since its time never ends and
    // its timesheet would only grow (OBS-131). An area's own report still shows its hours. An area
    // billed by the hour keeps one: Invoice bills it, and its timesheet is where billed and held-back
    // entries show.
    takesTimesheet(path, index, model) {
        return !this.isAreaOnly(path, index) || model?.money?.get(path)?.type === "hourly";
    }

    // Whether a project's timesheet has entries to show
    sheetHasEntries(model, project) {
        const b = model.billing;
        const on = b ? b.billing.scope(project, model, this, b.index) : new Set([project]);
        return model.entries.some((e) => on.has(e.project));
    }

    // ---------------------------------------------------------------- rendering

    // Each entry up to the next ROUND_TO minutes, as invoices are billed (decided 2026-09-14)
    rounded(minutes) {
        const step = TimeReport.ROUND_TO;
        if (!(step > 0) || minutes <= 0) return minutes;
        return Math.ceil(minutes / step) * step;
    }

    hours(minutes) {
        return (minutes / 60).toFixed(2);
    }

    // A table cell: hours with two decimals so columns line up, blank for zero so the cells where
    // work happened stand out (Brian, 2026-09-17)
    hoursCell(minutes) {
        const h = this.hours(minutes);
        return h === "0.00" ? "" : h;
    }

    // A money cell, blank for nothing earned
    moneyCell(cents) {
        return cents ? this.money(cents) : "";
    }

    shortDate(date) {
        const [y, m, d] = date.split("-");
        return `${+m}/${+d}/${y.slice(2)}`;
    }

    // Text quoted from notes can't open a comment in the report and hide its end marker, or run as Templater.
    // Running it twice changes nothing more (OBS-184: a table's cells are defused before they're measured,
    // and the report's lines again after): `%%%` becomes `%`, a zero-width space, `%`, another, `%`, with no `%%` left.
    // A table's freeze comments are left whole (OBS-238): each closes itself, so it can't hide what follows.
    defuse(text) {
        return String(text ?? "").split(TimeReport.FREEZE_COMMENT).map((part, i) => (i % 2 ? part
            : part.replace(/%(?=%)/g, "%\u200B").replace(/<!--/g, "<\u200B!--").replace(/-->/g, "--\u200B>")
                .replace(/<%/g, "<\u200B%"))).join("");   // Templater syntax, which a device could run when the note syncs in
    }

    // Totals in minutes, plus Earned in cents for entries whose project has an hourly rate, and
    // Invested in cents for entries whose non-billable project has a rate (OBS-156), which never adds to
    // Earned. Billable or not was decided in `build`; `money` is only needed for Earned and Invested.
    totals(entries, money = new Map()) {
        const t = { count: 0, exact: 0, billable: 0, free: 0, cents: 0, rated: false, invested: 0, valued: false };
        // "date cents" (a day and an hourly rate in cents) → billable minutes, and → a valued note's minutes
        const minutesByRate = new Map(), minutesByValue = new Map();
        const add = (map, e, rate, minutes) => {
            const key = `${e.date} ${Math.round(rate * 100)}`;
            map.set(key, (map.get(key) ?? 0) + minutes);
        };
        for (const e of entries) {
            t.count++;
            t.exact += e.minutes;
            const minutes = this.rounded(e.minutes);
            t[e.billable ? "billable" : "free"] += minutes;
            const m = money.get(e.project);
            if (m?.rate && e.billable) {
                t.rated = true;
                add(minutesByRate, e, m.rate, minutes);
            } else if (m?.invest) {
                t.valued = true;
                add(minutesByValue, e, m.invest, minutes);
            }
        }
        // Hours × rate per day and rate, as an invoice bills them (a row per date and rate, OBS-5): at a
        // whole-dollar rate every quarter hour is whole cents, and Earned, a timesheet and its invoices
        // agree. Invested is priced the same way, so it's what billing that time would have brought in.
        const price = (map) => [...map].reduce((sum, [key, minutes]) => sum + Math.round(minutes * Number(key.split(" ")[1]) / 60), 0);
        t.cents = price(minutesByRate);
        t.invested = price(minutesByValue);
        return t;
    }

    money(cents) {
        const [whole, frac] = (cents / 100).toFixed(2).split(".");
        return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
    }

    monthTitle(month) {
        return `${TimeReport.MONTHS[+month.slice(5) - 1]} ${month.slice(0, 4)}`;
    }

    // The projects `entries` were logged to directly, by name. In tables that list projects, each row
    // counts only its own entries, so the rows add up to All; a parent project with nothing logged to
    // it directly has no row, and its sub-projects show on their own (decided 2026-09-14).
    ownProjects(entries) {
        return [...new Set(entries.map((e) => e.project).filter(Boolean))]
            .sort((x, y) => this.basename(x).localeCompare(this.basename(y)));
    }

    // A table's rows for `projects` (OBS-167): the projects' rows, then, when there are areas, an
    // **Area** row with `width - 1` blank cells, heading the areas below it as Project heads the
    // table, and the areas' rows, each group in the order given. `row(path)` makes one row's cells. The
    // **Area** row has no numbers, so the rows still add up to All.
    groupedRows(model, projects, row, width) {
        const isArea = (p) => model.areas?.has(p) ?? false;
        const areas = projects.filter(isArea);
        return [...projects.filter((p) => !isArea(p)).map(row),
            ...(areas.length ? [this.boldRow(["Area", ...Array(width - 1).fill("")]), ...areas.map(row)] : [])];
    }

    // Earned for a row, or "" when the row's own project isn't hourly or nothing had a rate
    earnedFor(t, project, model) {
        const m = project ? model.money.get(project) ?? {} : {};
        return t.rated && !(m.type && m.type !== "hourly") ? t.cents : null;
    }

    // A weekly or monthly note's Earnings (OBS-133): a row per project that bills and has billable time
    // in the period (its own entries), with Billable, Rate and Earned, then All. A flat fee's row is there
    // when it has time in the period or was earned in it: no hours (they aren't billed by the hour), and
    // its fee as Earned in the period it was earned (`earned`), else N/A. Non-billable projects and
    // Unassigned are only in Hours. [] when nothing bills.
    earnedTable(model, entries, link, scope) {
        const earned = this.earnedFees(model).filter((f) => this.periodOf(f.date, scope.unit) === scope.key);
        const flatHere = new Map(earned.map((f) => [f.project, f.cents]));
        const projects = [...new Set([...this.ownProjects(entries), ...flatHere.keys()])]
            .sort((x, y) => this.basename(x).localeCompare(this.basename(y)));
        const rows = new Map(), hourly = [];
        for (const p of projects) {
            const m = model.money.get(p) ?? {};
            if (m.type === "non-billable") continue;
            if (m.type === "flat") { rows.set(p, [this.cell(link(p)), "–", m.label, flatHere.has(p) ? this.money(flatHere.get(p)) : "N/A"]); continue; }
            const list = entries.filter((e) => e.project === p);
            const t = this.totals(list, model.money);
            if (!t.billable) continue;
            const cents = this.earnedFor(t, p, model);
            hourly.push(...list);
            rows.set(p, [this.cell(link(p)), this.hoursCell(t.billable), m.label ?? "", cents === null ? "" : this.moneyCell(cents)]);
        }
        if (!rows.size) return [];
        // All is priced the way the rows' entries would be invoiced together, as Total is in a project's
        // tables, plus the flat fees earned here; with only flat fees not earned here it would be blank
        const t = this.totals(hourly, model.money);
        const fees = earned.reduce((sum, f) => sum + f.cents, 0);
        return this.table(["Project", "Billable", "Rate", "Earned"], this.numberAlign(4), [...this.groupedRows(model, [...rows.keys()], (p) => rows.get(p), 4),
            ...(hourly.length || fees ? [this.boldRow(["All", this.hoursCell(t.billable), "", this.moneyCell(t.cents + fees)])] : [])]);
    }

    // A project or area note (OBS-133), its sub-projects' time included. By Project, only when time was
    // logged to a sub-project: the note's own row first (blank when it has none), a row per sub-project,
    // then Total. Then By Week or By Month (see reportUnit), newest first, then Total, which matches By
    // Project's. Each table under its own H3; columns as `moneyColumns` says.
    projectTables(model, entries, scope, link) {
        if (!entries.length) return ["No time entries."];
        const subs = this.ownProjects(entries).filter((p) => p !== scope.path);
        const has = this.moneyColumns(model, [scope.path, ...subs]);
        const out = [];
        if (subs.length) {
            const head = ["Project", ...this.numberHeads(has, { rate: true })];
            const rows = [scope.path, ...subs].map((p) => [this.cell(link(p)), ...this.numberCells(model, entries.filter((e) => e.project === p), has, { project: p, rate: true })]);
            out.push("### By Project", "", ...this.table(head, this.numberAlign(head.length),
                [...rows, this.boldRow(["Total", ...this.numberCells(model, entries, has, { rate: true })])]), "");
        }
        const unit = this.reportUnit(model, scope.path, entries);
        const head = [unit === "week" ? "Week" : "Month", ...this.numberHeads(has)];
        const rows = this.periodRows(entries, unit, scope.linkTarget).map(({ label, list }) => [label, ...this.numberCells(model, list, has)]);
        out.push(`### By ${unit === "week" ? "Week" : "Month"}`, "", ...this.table(head, this.numberAlign(head.length),
            [...rows, this.boldRow(["Total", ...this.numberCells(model, entries, has)])]));
        return out;
    }

    // Which number columns a project or area note's tables have, from how the projects in them bill
    // (OBS-133): Exact and Total always; 🆓, Billable, Rate and Earned when any of them bills by the hour
    // (or by default, with no `rate_type`); Rate and Invested when a non-billable one has a rate that
    // values its time (OBS-156). A flat fee's hours aren't billed one by one, so it has Exact and Total
    // only, and its fee is in the summary. { billed, valued }
    moneyColumns(model, projects) {
        const m = (p) => model.money.get(p) ?? {};
        return { billed: projects.some((p) => m(p).type !== "non-billable" && m(p).type !== "flat"), valued: projects.some((p) => m(p).invest) };
    }

    // Their headings, in order: Exact, Total, 🆓, Billable, Rate (By Project only), Earned, Invested
    numberHeads({ billed, valued }, { rate = false } = {}) {
        return ["Exact", "Total", ...(billed ? ["🆓", "Billable"] : []), ...(rate && (billed || valued) ? ["Rate"] : []),
            ...(billed ? ["Earned"] : []), ...(valued ? ["Invested"] : [])];
    }

    // Their cells for `list`, the row of `project` (its Rate and, when it's hourly, its Earned) or a
    // row of several projects (a period, a Total: Earned is whatever its hourly entries earned). A
    // non-billable row leaves its money cells blank.
    numberCells(model, list, { billed, valued }, { project = null, rate = false } = {}) {
        const t = this.totals(list, model.money);
        const earned = this.earnedFor(t, project, model);
        return [this.hoursCell(t.exact), this.hoursCell(t.billable + t.free),
            ...(billed ? [this.hoursCell(t.free), this.hoursCell(t.billable)] : []),
            ...(rate && (billed || valued) ? [project ? model.money.get(project)?.label ?? "" : ""] : []),
            ...(billed ? [earned === null ? "" : this.moneyCell(earned)] : []),
            ...(valued ? [t.valued ? this.moneyCell(t.invested) : ""] : [])];
    }

    // A table's lines, padded the way Obsidian's table editor pads one (OBS-184), so that clicking into
    // it changes nothing: the time report compares its block exactly, and a table Obsidian had padded
    // would be written back every run. Every table the system writes comes from here; tables.test.mjs
    // fails on a row built by hand.
    //   - `head` is the header's cells, `align` each column's "left", "right", "center" or null (plain),
    //     and `rows` each row's cells: Markdown already fit for a cell (see tableText and cell). Each cell is
    //     defused here, before it's measured, since the report defuses its lines afterwards (see render).
    //   - A column is as wide as its longest cell as written, plus 2, and at least 5. "As written": a
    //     `\|` is two characters, a link its whole source, and a character counts as JavaScript counts
    //     it, so ✅ is 1 and ⚠️ is 2, and such columns don't line up by eye. Obsidian counts the same way.
    //   - A cell has one space before its text and the rest after it; right-aligned, the rest before it
    //     and one after; centered, split, with the extra one after. The second row fills each column
    //     with dashes, with the alignment's colons.
    //   - `freeze` is the freeze comments for the header (freezeHeader), which go at the start of its first
    //     cell, where Selectable Tables' commands put a mark, and are measured with it (OBS-238).
    table(head, align, rows, { freeze = "" } = {}) {
        if (freeze) head = [`${freeze} ${head[0] ?? ""}`, ...head.slice(1)];
        const lines = [head, ...rows].map((row) => {
            if (row.length > align.length) throw new Error(`TimeReport.table: a row of ${row.length} cells in a table of ${align.length} columns`);
            return align.map((_, i) => this.defuse(String(row[i] ?? "")).trim());
        });
        const width = align.map((_, i) => Math.max(5, ...lines.map((row) => row[i].length + 2)));
        const cell = (text, i) => {
            const space = width[i] - text.length;
            const before = align[i] === "right" ? space - 1 : align[i] === "center" ? Math.floor(space / 2) : 1;
            return " ".repeat(before) + text + " ".repeat(space - before);
        };
        const dashes = (a, w) => (a === "left" ? ` :${"-".repeat(w - 3)} ` : a === "center" ? ` :${"-".repeat(w - 4)}: `
            : a === "right" ? ` ${"-".repeat(w - 3)}: ` : ` ${"-".repeat(w - 2)} `);
        const line = (cells) => `|${cells.join("|")}|`;
        return [line(lines[0].map(cell)), line(align.map((a, i) => dashes(a, width[i]))), ...lines.slice(1).map((row) => line(row.map(cell)))];
    }

    // The alignments of a table whose first column names something and whose others hold numbers
    numberAlign(columns) {
        return [null, ...Array(columns - 1).fill("right")];
    }

    // A row with every cell that has something in it bolded (a Total)
    boldRow(cells) {
        return cells.map((v) => (v === "" ? "" : `**${v}**`));
    }

    // How a project or area note's time is broken down (OBS-133): an area's by month, since its time
    // never ends; a project's by week while its entries span WEEKS_MAX weeks or fewer, then by month,
    // so a year-long project doesn't reach 52 rows
    reportUnit(model, path, entries) {
        if (model.areas?.has(path)) return "month";
        const dates = entries.map((e) => e.date).sort();
        const sunday = (date) => {
            const n = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 864e5;
            return n - new Date(n * 864e5).getUTCDay();
        };
        return (sunday(dates.at(-1)) - sunday(dates[0])) / 7 + 1 <= TimeReport.WEEKS_MAX ? "week" : "month";
    }

    // The rows of a By Week or By Month table, newest first: [{ label, list }]. A week links its weekly
    // note (`9/13-9/19`). By month, each month of the latest entry's year links its monthly note
    // (`September 2026`), and each earlier year is one row linking its yearly note.
    periodRows(entries, unit, linkTarget) {
        const target = (u, key) => (linkTarget ? linkTarget(u, key) : key);
        const linked = (u, key, label) => {
            const t = target(u, key);
            return t === label ? `[[${t}]]` : `[[${t}\\|${label}]]`;
        };
        const md = (date) => `${+date.slice(5, 7)}/${+date.slice(8, 10)}`;
        const keyOf = unit === "week" ? (d) => this.weekKey(d) : (() => {
            const year = entries.reduce((y, e) => (e.date.slice(0, 4) > y ? e.date.slice(0, 4) : y), "");
            return (d) => (d.slice(0, 4) === year ? d.slice(0, 7) : d.slice(0, 4));
        })();
        return [...new Set(entries.map((e) => keyOf(e.date)))].sort().reverse().map((key) => {
            const list = entries.filter((e) => keyOf(e.date) === key);
            if (unit === "week") {
                const [from, to] = this.weekRange(key);
                return { label: linked("week", key, `${md(from)}-${md(to)}`), list };
            }
            return { label: key.length === 4 ? linked("year", key, key) : linked("month", key, this.monthTitle(key)), list };
        });
    }

    // The summary under Timesheet and Updated on a project or area note (OBS-133), its sub-projects
    // included: a label and a value a line.
    //   Hours:      20.50 used | 39.50 left        (`| 0.50 over` past the cap; no `left` without one)
    //   Earned:     $1,947.50 | $1,258.75 unpaid   (when it bills by the hour; see unpaidCents)
    //   Flat fee:   $1,200 | earned 9/30/26         (a flat fee: its own and its sub-projects' own)
    //   Eff. rate:  $87.53/hr                      (the effective hourly rate)
    // The effective rate of a note billed by the hour is Earned over its hours and its non-billable
    // sub-projects', 🆓 included, so it's at most the rates it bills at; a flat fee's is the fees, and
    // any Earned below it, over every hour. The earned day shows once every fee in it is earned. Two tabs line the values up in Live Preview's default font (Inter: a
    // tab is 17.8 px, the labels 52 to 66); Reading view shows a tab as a space.
    // Used is an hourly note's billable hours, as Invoice's cap warning counts them, and every hour of a
    // flat fee or a non-billable note. A non-billable note has a summary only when it has a cap.
    summaryLines(model, entries, path) {
        const m = model.money.get(path);
        if (!m) return [];
        const billed = m.type !== "non-billable";
        if (!billed && !m.capMinutes) return [];
        const t = this.totals(entries, model.money);
        const all = t.billable + t.free;
        const used = billed && m.type !== "flat" ? t.billable : all;
        const left = m.capMinutes ? m.capMinutes - used : null;
        const lines = [["Hours:", `${this.hours(used)} used${left === null ? "" : ` | ${this.hours(Math.abs(left))} ${left < 0 ? "over" : "left"}`}`]];
        if (billed) {
            if (t.cents) {
                const unpaid = this.unpaidCents(model, entries);
                lines.push(["Earned:", `${this.money(t.cents)}${unpaid > 0 ? ` | ${this.money(unpaid)} unpaid` : ""}`]);
            }
            let money = t.cents, minutes = all;
            if (m.type === "flat") {
                // A sub-project that sets a flat fee of its own is paid on top of this one's, so both count
                const holders = [...this.subtree(path, model.parent)].map((p) => model.money.get(p)).filter((x) => x?.fee);
                const fees = holders.reduce((sum, x) => sum + Math.round(x.fee * 100), 0);
                const days = holders.map((x) => x.earned);
                const earned = days.length && days.every(Boolean) ? days.sort().at(-1) : null;
                if (fees) lines.push(["Flat fee:", `${this.money(fees).replace(/\.00$/, "")}${earned ? ` | earned ${this.shortDate(earned)}` : ""}`]);
                money += fees;
            } else {
                // A flat sub-project's time is paid by its own fee, not this note's rate
                const flat = this.totals(entries.filter((e) => model.money.get(e.project)?.type === "flat"), model.money);
                minutes -= flat.billable + flat.free;
            }
            if (minutes > 0 && money) lines.push(["Eff. rate:", `${this.money(Math.round((money * 60) / minutes))}/hr`]);
        }
        return lines.map(([label, value]) => `**${label}**\t\t${value}`);
    }

    // What's unpaid of `entries`' Earned, in cents, entry by entry as the timesheet stands them: every
    // billable hourly entry but one billed on a paid invoice. One that changed since a paid invoice
    // billed it is unpaid for the time it gained. So a paid invoice counts for what it billed whatever
    // the rate or the entry is now, and an entry on two counts once.
    unpaidCents(model, entries) {
        const standing = this.sheetStanding(model);
        const open = [];
        for (const e of entries) {
            if (!e.billable || this.hourlyCents(model, e) === null) continue;
            const s = standing(e);
            const paid = s.invoice?.status === "paid";
            if (s.kind === "billed" && paid) continue;
            if (s.kind === "changed" && paid) {
                const gained = this.rounded(e.minutes) - s.row.billed;
                if (gained > 0) open.push({ ...e, minutes: gained });
                continue;
            }
            open.push(e);
        }
        return this.totals(open, model.money).cents;
    }

    // A yearly note: a row per project (its own entries only), then Unassigned and All; a
    // column per month, headed with a link to that monthly note, then the year. `measure` is
    // "earned" (dollars) or "hours" (billable + 🆓). Earned has only the projects whose billable hours
    // earned something by the hour (a row with no rate would be blank), and the flat fees earned that
    // year, each in the month it was earned; no Unassigned, and [] without them.
    yearTable(model, entries, scope, link, measure) {
        const fees = measure === "earned" ? this.earnedFees(model).filter((f) => f.date.slice(0, 4) === scope.key) : [];
        const earning = (p) => this.earnedFor(this.totals(entries.filter((e) => e.project === p), model.money), p, model) > 0;
        const projects = measure === "hours" ? this.ownProjects(entries)
            : [...new Set([...this.ownProjects(entries).filter(earning), ...fees.map((f) => f.project)])].sort((x, y) => this.basename(x).localeCompare(this.basename(y)));
        if (measure === "earned" && !projects.length) return [];
        if (measure === "hours" && !entries.length) return ["No time entries."];
        const months = TimeReport.SHORT_MONTHS.map((name, i) => ({ name, key: `${scope.key}-${String(i + 1).padStart(2, "0")}` }));
        const head = ["Project", ...months.map(({ name, key }) => `[[${scope.linkTarget ? scope.linkTarget("month", key) : key}\\|${name}]]`), scope.key];
        const out = [];
        // A month's (or with `month` null, the year's) Earned: what the entries earned by the hour, and
        // the flat fees earned then (the project's, or every one on the All row)
        const value = (list, project, month = null) => {
            const flat = measure === "earned" ? fees.filter((f) => (project ? f.project === project : true) && (!month || f.date.startsWith(month + "-"))).reduce((s, f) => s + f.cents, 0) : 0;
            if (!list.length && !flat) return "";
            const t = this.totals(list, model.money);
            if (measure === "hours") return this.hoursCell(t.billable + t.free);
            const c = (list.length ? this.earnedFor(t, project, model) ?? 0 : 0) + flat;
            return c ? this.money(c).replace(/\.00$/, "") : "";
        };
        const row = (name, list, project, bold = false) => {
            const cells = [name, ...months.map(({ key }) => value(list.filter((e) => e.date.startsWith(key + "-")), project, key)), value(list, project)];
            return bold ? this.boldRow(cells) : cells;
        };
        out.push(...this.groupedRows(model, projects, (p) => row(this.cell(link(p)), entries.filter((e) => e.project === p), p), months.length + 2));
        const unassigned = entries.filter((e) => !e.project);
        if (unassigned.length && measure === "hours") out.push(row("Unassigned", unassigned, null));
        out.push(row("All", entries, null, true));
        return this.table(head, this.numberAlign(head.length), out);
    }

    // Hours by column: a row per project (its own entries), Unassigned and All; `columns` are
    // [{ head, match(entry) }], followed by a total column headed `totalHead`. Cells are hours
    // (billable + 🆓, rounded per entry), blank when none.
    hoursGrid(model, entries, columns, totalHead, link) {
        const head = ["Project", ...columns.map((c) => c.head), totalHead];
        const hours = (list) => {
            if (!list.length) return "";
            const t = this.totals(list, model.money);
            return this.hoursCell(t.billable + t.free);
        };
        const row = (name, list, bold = false) => {
            const cells = [name, ...columns.map((c) => hours(list.filter(c.match))), hours(list)];
            return bold ? this.boldRow(cells) : cells;
        };
        const out = this.groupedRows(model, this.ownProjects(entries), (p) => row(this.cell(link(p)), entries.filter((e) => e.project === p)), columns.length + 2);
        const unassigned = entries.filter((e) => !e.project);
        if (unassigned.length) out.push(row("Unassigned", unassigned));
        out.push(row("All", entries, true));
        return this.table(head, this.numberAlign(head.length), out);
    }

    // A weekly note's breakdown by day: a column per day of the week, headed "Sun 9/6" with a link to
    // that daily note, then the week
    weekDaysTable(model, entries, scope, link) {
        const [from] = this.weekRange(scope.key);
        const start = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10)) / 864e5;
        const days = Array.from({ length: 7 }, (_, i) => new Date((start + i) * 864e5).toISOString().slice(0, 10));
        const columns = days.map((d) => ({ head: `[[${d}\\|${this.dayName(d).slice(0, 3)} ${+d.slice(5, 7)}/${+d.slice(8, 10)}]]`, match: (e) => e.date === d }));
        return this.hoursGrid(model, entries, columns, "Week", link);
    }

    // A monthly note's breakdown by week: a column per Sunday-to-Saturday week that overlaps the
    // month, headed "8/30-9/5" with a link to that weekly note, then the month. A week that straddles
    // two months counts only this month's days here, so the Month column matches the summary.
    monthWeeksTable(model, entries, scope, link) {
        const [y, m] = scope.key.split("-").map(Number);
        const first = Date.UTC(y, m - 1, 1) / 864e5, last = Date.UTC(y, m, 0) / 864e5;
        const weeks = [];
        for (let n = first; n <= last; n++) {
            const key = this.weekKey(new Date(n * 864e5).toISOString().slice(0, 10));
            if (!weeks.includes(key)) weeks.push(key);
        }
        const md = (date) => `${+date.slice(5, 7)}/${+date.slice(8, 10)}`;
        const columns = weeks.map((key) => {
            const [from, to] = this.weekRange(key);
            const target = scope.linkTarget ? scope.linkTarget("week", key) : key;
            return { head: `[[${target}\\|${md(from)}-${md(to)}]]`, match: (e) => this.weekKey(e.date) === key };
        });
        return this.hoursGrid(model, entries, columns, "Month", link);
    }

    problemLines(model, problems, projectProblems, entries, link) {
        const out = [];
        const quote = (text) => {
            const chars = Array.from(text);
            const t = chars.length > TimeReport.QUOTE_MAX ? chars.slice(0, TimeReport.QUOTE_MAX - 1).join("").trimEnd() + "…" : text;
            return t.replace(/`/g, "'");
        };
        for (const p of problems) {
            // A task Problem on a note that isn't a daily note links that note (addTaskProblems)
            const at = p.note ? `[[${p.note.replace(/\.md$/, "")}|${this.basename(p.note)}]]` : `[[${p.date}|${this.shortDate(p.date)}]]`;
            out.push(`- ${at} line ${p.line}: \`${quote(p.text)}\` ${p.message}`);
        }
        // Both of a line's projects, or an invoice's, can be in one report: said once
        const once = (line) => { if (!out.includes(line)) out.push(line); };
        for (const p of projectProblems) {
            if (p.noProject) {
                once(this.invoiceProblem(p, link));
                continue;
            }
            if (p.invoice || p.twice) {
                out.push(this.invoiceProblem(p, link));
                continue;
            }
            if (p.conflict) {
                once(this.conflictLine(p.conflict, link, quote));
                continue;
            }
            if (p.kind === "parent") {
                const note = this.noteLink(p.path);
                once(p.folder ? `- ${note} is filed under ${link(p.folder)}, but its \`parent\` names ${link(p.named)}; set \`parent\` to ${link(p.folder)}`
                    : `- ${note} is in no project's folder, but its \`parent\` names ${link(p.named)}; clear \`parent\`, or file the note`);
                continue;
            }
            out.push(p.message ? `- ${link(p.project)} ${p.message}`
                : `- ${link(p.project)} and ${link(p.parent)} are each inside the other (check their folders and \`parent\`); ${link(p.project)} is counted as top-level`);
        }
        const noProject = entries.filter((e) => !e.project).length;
        if (noProject) out.push(`- ${noProject} ${noProject === 1 ? "entry has" : "entries have"} no project (see Unassigned)`);
        return out;
    }

    // A link to a note, by its path, showing its name
    noteLink(path) {
        return `[[${path.replace(/\.md$/, "")}|${this.basename(path)}]]`;
    }

    // What's wrong with a line in a periodic note (ownNoteProblems), and what to do about it
    conflictLine(c, link, quote) {
        const at = `${c.kind === "day" ? `[[${c.date}|${this.shortDate(c.date)}]]` : this.noteLink(c.path)} line ${c.line}: \`${quote(c.text)}\``;
        if (c.links) return `- ${at} names ${c.links.map(link).join(" and ")}, so its time isn't counted on either; take the wrong link off`;
        const [kind, it] = c.event ? ["log", "log"] : ["task note", "note"];
        if (c.inbox) return `- ${at} links ${link(c.lineProject)}, but its ${kind} ${this.noteLink(c.note)} waits in the Inbox; run AddProjectLink on the line, or MoveToProject on the ${it}`;
        return `- ${at} links ${link(c.lineProject)}, but its ${kind} ${this.noteLink(c.note)} is filed under ${link(c.noteProject)}, so its time isn't counted on either; run AddProjectLink on the line, which moves the ${it} too, or MoveToProject on the ${it}`;
    }

    // Whether a Problem touches what's billed: every Problem but a mark on a sub-task, a `parent`, a ⭕
    // whose note waits in the Inbox (the time counts and bills), and a task whose lines disagree, unless
    // the disagreement is over the project (a stale forward date doesn't change a billable entry)
    changesBilling(p) {
        return (!["task", "subtask", "parent"].includes(p.kind) && !p.conflict?.inbox) || p.rule === "project";
    }

    // A billed entry that changed since its invoice was made, or an entry on two invoices (OBS-5). A
    // draft's change ends "rebuild it", since Rebuild fixes it. A timesheet adds an `overlap` (an entry
    // that overlaps billed time) of its own (OBS-143), which Rebuild doesn't fix.
    invoiceProblem(p, link) {
        const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
        const when = (r) => `[[${r.date}|${this.shortDate(r.date)}]] ${this.formatTime(r.start)} - ${this.formatTime(r.end)}`;
        if (p.twice) {
            const [a, b] = p.twice.invoices;
            return a === b ? `- ${when(p.twice.row)} is on [[${a.name}]] twice`
                : `- ${when(p.twice.row)} is billed on both [[${a.name}]] and [[${b.name}]]`;
        }
        if (p.problem) return `- [[${p.invoice.name}]] ${p.problem}, so this project can't be invoiced until it's fixed`;
        if (p.noProject) return `- [[${p.invoice.name}]] has no project that can be read, so nothing says whose bill it is; set its \`parent\` to the project it bills`;
        const { invoice, change: c } = p;
        // A sent invoice's date is the day it was sent
        const on = invoice.status === "paid" ? invoice.paid : invoice.status === "sent" ? invoice.invoiceDate : null;
        // A gone row links its daily note in the words, where you'd look for it (Brian, 2026-10-29)
        const now = c.kind === "times" ? `now ${this.formatTime(c.entry.start)} - ${this.formatTime(c.entry.end)}`
            : c.kind === "free" ? "now 🆓"
            : c.kind === "unassigned" ? "now on no project"
            : c.kind === "project" ? `now on ${link(c.entry.project)}`
            : c.kind === "disputed" ? "now on a line with two projects, so it isn't counted"
            : c.kind === "subtask" ? "now under a nested task, so it isn't counted"
            : c.kind === "overlap" ? `and ${c.entry.date === c.row.date ? "" : `[[${c.entry.date}|${this.shortDate(c.entry.date)}]] `}${this.formatTime(c.entry.start)} - ${this.formatTime(c.entry.end)} overlaps it`
            : `but now it's missing from [[${c.row.date}|the daily note]]`;
        const at = c.kind === "gone" ? this.missingRow(c.row) : when(c.row);
        // An archived project's draft can't be rebuilt: Invoice never bills its time (OBS-213). A
        // missing entry is settled by putting it back as billed.
        const fix = invoice.status === "draft" && c.kind !== "overlap" && !this.isArchived(invoice.project) ? "; rebuild it"
            : c.kind === "gone" ? "; put it back there to settle it" : "";
        return `- [[${invoice.name}]] (${invoice.status}${on ? ` ${md(on)}` : ""}): ${at} was billed, ${now}${fix}`;
    }

    // A missing billed row as its invoice recorded it, so you can tell what to put back (Brian,
    // 2026-10-29): its day and times, then its task and note, quoted
    missingRow(row) {
        const what = [row.task, row.note].filter(Boolean).join(": ").replace(/`/g, "'");
        return `${this.shortDate(row.date)} ${this.formatTime(row.start)} - ${this.formatTime(row.end)}${what ? ` \`${what}\`` : ""}`;
    }

    // Text for a table cell: one line, every | escaped, and a #tag or an HTML tag quoted from a task
    // or note shown as text, so it can't tag the note the table is in (a #project would make it a
    // project) or draw anything. Billing.tableText does the same for invoices.
    tableText(text) {
        return String(text ?? "").replace(/\s+/g, " ").trim().replace(/(?<!\\)((?:\\\\)*)\|/g, "$1\\|")
            .replace(/(^|\s)#(?=[^\s#])/g, "$1\\#").replace(/</g, "&lt;");
    }

    // A project note's timesheet (OBS-5; one table since OBS-242): every entry of the project, and of the
    // projects below it when its include_subprojects checkbox is on, billable and 🆓 together. A summary
    // line gives each kind's total (`### Billable time: 20.50 hrs · 🆓 time: 1.75 hrs`), leaving out a kind
    // the timesheet has no time of; the table has a bold row per day, newest first, then the day's
    // entries in time order (see sheet). Problems come first, when there's anything to say: its entries'
    // (see sheetEntryProblems), then its invoices' (see sheetProblems). Each part ends with a blank line.
    timesheetLines(model, scope, link) {
        const b = model.billing;
        const on = b ? b.billing.scope(scope.path, model, this, b.index) : new Set([scope.path]);
        const entries = model.entries.filter((e) => on.has(e.project));
        const project = new Set(entries.map((e) => e.project)).size > 1;
        const billable = entries.filter((e) => e.billable), free = entries.filter((e) => !e.billable);
        const total = (list) => `${this.hours(list.reduce((m, e) => m + this.rounded(e.minutes), 0))} hrs`;
        const own = this.sheetEntryProblems(model, on, scope.path, entries, link);
        // Problems first, as in every report (OBS-167)
        const out = this.problemsCallout([...own.lines, ...this.sheetProblems(model, on, entries, link)]);
        if (!entries.length) {
            out.push("No time entries.", "");
            return out;
        }
        const kinds = [...(billable.length ? [`Billable time: ${total(billable)}`] : []), ...(free.length ? [`🆓 time: ${total(free)}`] : [])];
        out.push(`### ${kinds.join(" · ")}`, "", ...this.sheet(model, entries, { project, link, flagged: own.flagged }), "");
        return out;
    }

    // A timesheet's own Problems (OBS-132): the lines its project's note has about the projects the
    // timesheet covers (overlaps, 🆓 twice, entries of 12 hours or more, a line that disagrees with
    // itself, a project's settings), but not its invoices', which sheetProblems says. { lines, flagged }:
    // flagged holds every entry a line is about, for its row's ⚠️: the entry on the line, both sides of an
    // overlap, and the entries under a task or event line a Problem is on (a stray 🆓 there, or a note
    // waiting in the Inbox). Running clocks, malformed lines, time under a sub-task and a line where
    // nothing decides aren't counted, so they have no row; only their line says so.
    sheetEntryProblems(model, on, root, entries, link) {
        const problems = model.problems.filter((p) => p.projects.some((x) => on.has(x)) && this.changesBilling(p));
        const projectProblems = model.projectProblems.filter((p) => !p.invoice && !p.twice && (this.changesBilling(p) || p.conflict?.inbox) && (on.has(p.project) || (p.parent && p.parent === root)));
        const at = (path, line) => `${path}\n${line}`;
        const named = new Set([...problems.flatMap((p) => [at(p.path, p.line), ...(p.other ? [at(p.other.path, p.other.line)] : [])]),
            ...projectProblems.filter((p) => p.conflict).map((p) => at(p.conflict.path, p.conflict.line))]);
        const about = (e) => named.has(at(e.path, e.line)) || (e.context ?? []).some((c) => named.has(at(e.path, c.line)));
        return {
            lines: problems.length || projectProblems.length ? this.problemLines(model, problems, projectProblems, entries, link) : [],
            flagged: new Set(entries.filter(about)),
        };
    }

    // A timesheet's Problems (OBS-143), so every ⚠️ in it says why: what changed since an invoice billed
    // time in it, and an entry on two invoices. The lines are the project note's, from the same changes
    // (Billing.invoiceChanges). An entry that's ⚠️ for no change of its own, such as one that overlaps a billed
    // row whose entry is still there, gets a line of its own. Empty when there's nothing to say.
    sheetProblems(model, on, entries, link) {
        const b = model.billing;
        if (!b) return [];
        const mine = (p) => !!p && on.has(p);
        const out = [], explained = new Set();
        for (const invoice of b.invoices) {
            if (invoice.status === "canceled") continue;
            if (!invoice.project && b.billing.rowProjects(invoice, model, this, b.index).some(mine)) out.push(this.invoiceProblem({ invoice, noProject: true }, link));
            if (invoice.problem) {
                if (mine(invoice.project)) out.push(this.invoiceProblem({ invoice, problem: invoice.problem }, link));
                continue;
            }
            for (const change of b.byInvoice?.get(invoice) ?? []) {
                if (change.kind === "wording" || !(mine(invoice.project) || mine(change.row.projectPath) || mine(change.entry?.project))) continue;
                out.push(this.invoiceProblem({ invoice, change }, link));
                if (change.entry) explained.add(change.entry);
            }
        }
        for (const twice of b.ledger.twice) {
            if (mine(twice.row.projectPath) || twice.invoices.some((i) => mine(i.project))) out.push(this.invoiceProblem({ twice }, link));
        }
        const standing = this.sheetStanding(model);
        const order = (x, y) => x.date.localeCompare(y.date) || x.start - y.start || x.end - y.end;
        for (const e of [...entries].sort(order)) {
            const s = standing(e);
            if (explained.has(e) || !this.warned(e, s)) continue;
            const same = e.date === s.row.date && e.start === s.row.start && e.end === s.row.end;
            const kind = !same ? "overlap" : !e.billable ? "free" : "project";
            out.push(this.invoiceProblem({ invoice: s.invoice, change: { row: s.row, kind, entry: e } }, link));
        }
        return out;
    }

    // An entry's hourly rate in cents, or null when its project isn't billed by the hour
    hourlyCents(model, e) {
        const m = model.money.get(e.project);
        return m?.type === "hourly" && m.rate ? Math.round(m.rate * 100) : null;
    }

    // How a timesheet's entries stand with the invoices: (entry) → Billing.standing. Only an hourly
    // project's entries are invoiced.
    sheetStanding(model) {
        const b = model.billing;
        return (e) => (!b || this.hourlyCents(model, e) === null ? { kind: "open" } : b.billing.standing(e, b.ledger));
    }

    // Whether an entry is ⚠️: changed since it was billed, or billed and now 🆓
    warned(e, s) {
        return s.kind === "changed" || (s.kind === "billed" && !e.billable);
    }

    // A timesheet's table (OBS-242). Its first column, unnamed, is each row's status:
    //   - an entry's, the first that fits: ⚠️ when it changed after it was billed, when a Problem names it
    //     (`flagged`, OBS-132), or when it's 🆓 and on an invoice (billed before it was made 🆓, until
    //     OBS-110 puts 🆓 time on invoices at no charge); 🆓 for a 🆓 entry; else the status of the
    //     invoice that billed it (✏️ draft, 🕒 sent, ✅ paid, 📄 a status of your own), or blank while
    //     it's on none (OBS-117);
    //   - a day's, from its entries' (dayMark).
    // The column is there where anything bills by the hour, and elsewhere only when a row is 🆓 or ⚠️.
    // Then Date / Time (the day's bold date, or the entry's times), Project when it shows more than one,
    // Bill (billable hours, named short for a phone's width) and 🆓, each only when the timesheet has that kind of time (an entry's hours, rounded as
    // billed, in its own; a day's total of each kind, blank when it has none), Task and Notes (with no
    // 🆓: the status column says it), and Invoice, the invoice that billed the entry, where anything bills
    // by the hour. It's about time, so it has no amounts.
    sheet(model, entries, { project, link, flagged = new Set() }) {
        const billing = entries.some((e) => this.hourlyCents(model, e) !== null);
        const billable = entries.some((e) => e.billable), free = entries.some((e) => !e.billable);
        const marks = billing || free || entries.some((e) => flagged.has(e));
        const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
        const standing = this.sheetStanding(model);
        // An entry's { mark, invoice, hourly }: hourly when an hourly invoice can bill it
        const status = (e) => {
            const s = billing ? standing(e) : { kind: "open" };
            const mark = flagged.has(e) || this.warned(e, s) ? "⚠️" : !e.billable ? "🆓" : s.kind === "open" ? "" : this.invoiceMark(s.invoice);
            return { mark, invoice: s.kind === "open" ? "" : `[[${s.invoice.name}]]`, hourly: e.billable && this.hourlyCents(model, e) !== null };
        };
        const head = [...(marks ? [""] : []), "Date / Time", ...(project ? ["Project"] : []), ...(billable ? ["Bill"] : []), ...(free ? ["🆓"] : []),
            "Task", "Notes", ...(billing ? ["Invoice"] : [])];
        const hours = (list) => this.hours(list.reduce((m, e) => m + this.rounded(e.minutes), 0));
        // A row's hours: in Billable, then in 🆓, each column only when the timesheet has it
        const split = (b, f) => [...(billable ? [b] : []), ...(free ? [f] : [])];
        const days = [...new Set(entries.map((e) => e.date))].sort().reverse()
            .map((d) => ({ d, list: entries.filter((e) => e.date === d).sort((x, y) => x.start - y.start || x.end - y.end) }));
        const rows = [];
        for (const { d, list } of days) {
            const each = list.map(status);
            const kind = (want) => list.filter((e) => e.billable === want);
            const sum = (want) => (kind(want).length ? `**${hours(kind(want))}**` : "");
            rows.push([...(marks ? [this.dayMark(each)] : []), `**[[${d}\\|${this.dayName(d).slice(0, 3)} ${md(d)}]]**`, ...(project ? [""] : []),
                ...split(sum(true), sum(false)), "", "", ...(billing ? [""] : [])]);
            for (const [k, e] of list.entries()) {
                const { mark, invoice } = each[k];
                const h = hours([e]);
                rows.push([...(marks ? [mark] : []), `${this.formatTime(e.start)} - ${this.formatTime(e.end)}`, ...(project ? [this.cell(link(e.project))] : []),
                    ...split(e.billable ? h : "", e.billable ? "" : h), this.tableText(e.task), this.tableText(e.note), ...(billing ? [invoice] : [])]);
            }
        }
        return this.table(head, head.map((h, i) => (h === "Bill" || h === "🆓" ? "right" : marks && i === 0 ? "center" : null)), rows);
    }

    // A timesheet day row's status, from its entries' ({ mark, hourly }, as sheet works them out), the
    // first that fits (OBS-242, Brian 2026-11-03):
    //   - ⚠️ when any entry is ⚠️, 🆓 or not, so a problem always shows on its day;
    //   - then only its hourly entries count, the billable time an hourly invoice bills: 🆓 entries and
    //     flat-fee time never hold a day back. Blank while any of them is on no invoice (nor is one on a
    //     canceled invoice); else the earliest status among them: ✏️ draft, 🕒 sent, 📄 a status of your
    //     own (most likely sent), then ✅ paid, so a day is ✅ only when every one is paid;
    //   - a day with no hourly entries is 🆓 when every entry is 🆓, and blank otherwise.
    dayMark(rows) {
        if (rows.some((r) => r.mark === "⚠️")) return "⚠️";
        const hourly = rows.filter((r) => r.hourly).map((r) => r.mark);
        if (!hourly.length) return rows.length && rows.every((r) => r.mark === "🆓") ? "🆓" : "";
        if (hourly.some((m) => m === "" || m === TimeReport.INVOICE_MARK.canceled)) return "";
        return ["✏️", "🕒", "📄"].find((m) => hourly.includes(m)) ?? "✅";
    }

    // An invoice's status as its mark (📄 for a status of your own)
    invoiceMark(invoice) {
        return TimeReport.INVOICE_MARK[invoice.status] ?? "📄";
    }

    // A project note's invoices (OBS-117): the project's and its sub-projects', newest first, each with
    // its status mark in an unnamed first column, then a Total of all but the canceled ones. Hours and
    // Total are the invoice's own `hours` and `total`.
    invoiceLines(model, scope, link) {
        const b = model.billing;
        if (!b) return [];
        const set = this.subtree(scope.path, model.parent);
        const list = b.invoices.filter((i) => i.project && set.has(i.project))
            .sort((x, y) => (y.invoiceDate ?? "").localeCompare(x.invoiceDate ?? "") || y.number.localeCompare(x.number, undefined, { numeric: true }));
        if (!list.length) return [];
        const project = new Set(list.map((i) => i.project)).size > 1;
        const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
        const minutes = (i) => (i.hours === null ? null : Math.round(i.hours * 60));
        const cents = (i) => (i.total === null ? null : Math.round(i.total * 100));
        const live = list.filter((i) => i.status !== "canceled");
        const head = ["", "Invoice", ...(project ? ["Project"] : []), "Date", "Period", "Hours", "Total"];
        return this.table(head, head.map((h, k) => (h === "Hours" || h === "Total" ? "right" : k === 0 ? "center" : null)), [
            ...list.map((i) => [
                this.invoiceMark(i), `[[${i.name}]]`, ...(project ? [this.cell(link(i.project))] : []),
                i.invoiceDate ? this.shortDate(i.invoiceDate) : "",
                i.periodStart && i.periodEnd ? `${md(i.periodStart)} – ${this.shortDate(i.periodEnd)}` : "",
                minutes(i) === null ? "" : this.hours(minutes(i)), cents(i) === null ? "" : this.money(cents(i)),
            ]),
            ["", "**Total**", ...(project ? [""] : []), "", "", `**${this.hours(live.reduce((s, i) => s + (minutes(i) ?? 0), 0))}**`,
                `**${this.money(live.reduce((s, i) => s + (cents(i) ?? 0), 0))}**`],
        ]);
    }

    // The block, markers included, for { kind: "project", path } or { kind: "period", unit, key };
    // either can carry `linkTarget(unit, key)`, the link text for a weekly or monthly note (its name,
    // or its full path when another note has the same name).
    // `link(path)` makes a project or area link (see reportLink; defaults to [[basename]]); inside
    // a table its `|` is escaped (see cell).
    render(model, scope, stamp, link = (p) => `[[${this.basename(p)}]]`) {
        // A project's timesheet link opens the block, beside when it was updated
        const top = scope.kind === "project" && scope.sheet ? `[[${scope.sheet}|Timesheet]] | *Updated ${stamp}*` : `*Updated ${stamp}*`;
        const out = [TimeReport.START, top, ""];
        // Problems only when there's something to say (OBS-133), and then first, right under the
        // Updated line, where they can't be missed below a long table (OBS-167)
        const problems = (mine) => out.push(...this.problemsCallout(this.problemLines(model, mine.problems, mine.projectProblems, mine.entries, link)));

        // A period's Problems, then its Earnings, when anything bills, then its Hours (OBS-133)
        if (scope.kind === "period") {
            const mine = this.inScope(model, scope);
            problems(mine);
            const earnings = scope.unit === "year" ? this.yearTable(model, mine.entries, scope, link, "earned") : this.earnedTable(model, mine.entries, link, scope);
            if (earnings.length) out.push("### Earnings", "", ...earnings, "");
            const hours = !mine.entries.length ? ["No time entries."]
                : scope.unit === "year" ? this.yearTable(model, mine.entries, scope, link, "hours")
                : scope.unit === "week" ? this.weekDaysTable(model, mine.entries, scope, link)
                : this.monthWeeksTable(model, mine.entries, scope, link);
            out.push("### Hours", "", ...hours, "");
        } else if (scope.kind !== "timesheet") {
            const mine = this.inScope(model, scope);
            problems(mine);
            const summary = this.summaryLines(model, mine.entries, scope.path);
            if (summary.length) out.push(...summary, "");
            out.push(...this.projectTables(model, mine.entries, scope, link), "");
            const invoices = this.invoiceLines(model, scope, link);
            if (invoices.length) out.push("### Invoices", "", ...invoices, "");
        } else {
            // Its own note, not the project's: a long table in a note costs every keystroke typed in it
            // (OBS-5 measured about 0.05 ms a row), and nobody types in a timesheet
            out.push(...this.timesheetLines(model, scope, link));
        }
        while (out.at(-1) === "") out.pop();
        // A table or callout ends with a blank line, so the end marker can't read as a row or line of it
        if (/^[|>]/.test(out.at(-1))) out.push("");
        // Nothing between the markers may open a comment or look like a marker, or the next run can't find the block
        const body = out.slice(1).map((l) => this.defuse(l));
        return [TimeReport.START, ...body, TimeReport.END].join("\n");
    }

    // A report's Problems as a callout, then a blank line, so what follows isn't drawn inside it;
    // [] with nothing to say
    problemsCallout(lines) {
        return lines.length ? [TimeReport.PROBLEMS, ...lines.map((l) => `> ${l}`), ""] : [];
    }

    // ---------------------------------------------------------------- freezing tables (OBS-238)
    // Every table the system writes can come out frozen for the Selectable Tables plugin: a default from
    // Table Settings, and a freeze you set on one table yourself is kept through every rewrite. Before a
    // block or an invoice is written, each new table's header gets what its old one held (freezeHeader),
    // matched by the heading above it. A table of yours outside the block is never touched.

    // The default from Table Settings' properties: { rows, columns }, or null when both are 0 or blank.
    // Anything but a whole number (or one written as text) counts as 0. Selectable Tables freezes at most
    // 9 columns, a status column that comes along included.
    tableSettingsOf(props) {
        const whole = (key) => {
            const v = this.prop(props ?? {}, key);
            const n = typeof v === "number" || typeof v === "string" ? Number(v) : 0;
            return Number.isInteger(n) && n > 0 ? n : 0;
        };
        const rows = whole("freeze_rows"), columns = Math.min(whole("freeze_columns"), TimeReport.MAX_FROZEN_COLUMNS);
        return rows || columns ? { rows, columns } : null;
    }

    // The default as Table Settings says it now, or null with no note. Read from its text, since the
    // metadata cache can lag an edit made just before the run.
    async tableSettings() {
        const file = app.vault.getFileByPath(TimeReport.TABLE_SETTINGS);
        if (!file) return null;
        const { getFrontMatterInfo, parseYaml } = customJS.obsidian;
        const info = getFrontMatterInfo(await this.textOf(file));
        let props = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        try { if (info.exists) props = parseYaml(info.frontmatter) ?? {}; } catch (e) { /* the cache's, then */ }
        return this.tableSettingsOf(props);
    }

    // What a header row holds: { mark: { rows, columns } or null, label: { kind: "default", rows, columns },
    // { kind: "custom" } or null }. The first mark counts, as in Selectable Tables, and code shows its text.
    freezeOf(header) {
        const text = String(header ?? "").replace(/(`+)[^`]+\1/g, (code) => " ".repeat(code.length));
        const mark = text.match(TimeReport.FREEZE_MARK), label = text.match(TimeReport.FREEZE_LABEL);
        return {
            mark: mark ? { rows: Number(mark[1]), columns: Number(mark[2]) } : null,
            label: !label ? null : label[1] !== undefined ? { kind: "default", rows: Number(label[1]), columns: Number(label[2]) } : { kind: "custom" },
        };
    }

    // The default for a table headed `head` (its header cells): `columns` counts from the first named
    // column, so an unnamed status column at the left comes along without counting (Brian, 11/03). Null when off.
    freezeDefault(settings, head = []) {
        if (!settings) return null;
        const named = head.findIndex((h) => String(h ?? "").trim() !== "");
        const lead = settings.columns && named > 0 ? named : 0;
        return { rows: settings.rows, columns: Math.min(settings.columns + lead, TimeReport.MAX_FROZEN_COLUMNS) };
    }

    // The freeze comments a table's new header gets, from what its old header held (`old`, as freezeOf
    // reads it, or null for a new table), or "" for none:
    //   - nothing, or a freeze that still matches its default label: the default and its label, or nothing
    //     when the default is off, so it follows the setting;
    //   - a freeze that differs from its default label (changed with a command), one with no label (typed),
    //     or one labeled custom: that freeze, labeled custom;
    //   - a label with no freeze (Unfreeze table): `%%freeze 0 0%%`, labeled custom, so it stays unfrozen.
    freezeHeader(old, settings, head = []) {
        const mark = ({ rows, columns }) => `%%freeze ${rows} ${columns}%%`;
        const custom = (freeze) => `${mark(freeze)} %%custom%%`;
        const def = this.freezeDefault(settings, head);
        const byDefault = def ? `${mark(def)} %%default ${def.rows} ${def.columns}%%` : "";
        const { mark: now = null, label = null } = old ?? {};
        if (!now && !label) return byDefault;
        if (!now) return custom({ rows: 0, columns: 0 });
        if (label?.kind === "default" && now.rows === label.rows && now.columns === label.columns) return byDefault;
        return custom(now);
    }

    // A header cell without its freeze comments, each with the spaces after it
    withoutFreeze(text) {
        return String(text ?? "").replace(new RegExp(`${TimeReport.FREEZE_COMMENT.source}[ \\t]*`, "g"), "").trim();
    }

    // How a table's heading is known from run to run: its numbers don't count (a timesheet's carry its
    // totals), and a timesheet's summary line is one heading whatever kinds of time it names, so its table
    // keeps its freeze when its first 🆓 entry comes in (OBS-242)
    tableHeading(line) {
        const h = line.trim().replace(/\d[\d.,]*/g, "#").replace(/\s+/g, " ");
        return TimeReport.SHEET_HEADINGS.test(h) ? TimeReport.SHEET_HEADING : h;
    }

    // The tables in `lines`, each with the heading above it (tableHeading): [{ at (its first row), end (its
    // last), heading }].
    tablesIn(lines) {
        const out = [];
        const row = (j) => /^\s*\|/.test(lines[j] ?? "");
        let heading = "";
        for (let i = 0; i < lines.length; i++) {
            const t = lines[i].trim();
            if (/^#{1,6}\s/.test(t)) { heading = this.tableHeading(t); continue; }
            if (!row(i)) continue;
            let end = i;
            while (row(end + 1)) end++;
            out.push({ at: i, end, heading });
            i = end;
        }
        return out;
    }

    // What the tables in `lines` hold in their header rows: Map(heading → [freezeOf, …]), in order. A
    // timesheet from before OBS-242 has two tables, Billable time and 🆓 time, for the one it has now: a
    // freeze you set on either carries over, the Billable table's when both have one.
    freezesIn(lines) {
        const out = new Map();
        for (const { at, heading } of this.tablesIn(lines)) {
            if (!out.has(heading)) out.set(heading, []);
            out.get(heading).push(this.freezeOfRow(lines[at], heading));
        }
        const two = out.get(TimeReport.SHEET_HEADING);
        if (two?.length > 1) out.set(TimeReport.SHEET_HEADING, [two.find((f) => this.ownFreeze(f)) ?? two[0]]);
        return out;
    }

    // A header row's freeze (freezeOf). One you set on a timesheet from before OBS-242, whose Date and Time
    // were two columns, counts one column fewer once it reached Time, so it ends at the same column.
    freezeOfRow(header, heading) {
        const f = this.freezeOf(header);
        if (heading !== TimeReport.SHEET_HEADING || !f.mark || !this.ownFreeze(f)) return f;
        const time = this.tableCells(header).findIndex((c) => this.withoutFreeze(c) === "Time") + 1;
        return time > 0 && f.mark.columns >= time ? { ...f, mark: { ...f.mark, columns: f.mark.columns - 1 } } : f;
    }

    // Whether a header's freeze (freezeOf) is one you set, which freezeHeader keeps and labels custom,
    // rather than the default's or none
    ownFreeze({ mark, label }) {
        if (!mark) return !!label;
        return !(label?.kind === "default" && mark.rows === label.rows && mark.columns === label.columns);
    }

    // A row's cells as written, padding included: a `\` escapes the character after it
    tableCells(line) {
        const text = line.trimEnd(), out = [];
        let from = text.length - text.trimStart().length;
        if (text[from] === "|") from++;
        for (let i = from; i < text.length; i++) {
            if (text[i] === "\\") i++;
            else if (text[i] === "|") { out.push(text.slice(from, i)); from = i + 1; }
        }
        if (text.slice(from).trim()) out.push(text.slice(from));
        return out;
    }

    // `lines` with each table's header frozen as freezeHeader says, from `old` (freezesIn of what's there
    // now) and `settings` (tableSettingsOf). A table matches the old one under the same heading, the first
    // with the first. A table whose header changes is written again through `table`, so it stays padded.
    withFreezes(lines, old, settings) {
        const out = lines.slice();
        const seen = new Map();
        for (const { at, end, heading } of this.tablesIn(lines)) {
            const n = seen.get(heading) ?? 0;
            seen.set(heading, n + 1);
            const rows = out.slice(at, end + 1).map((l) => this.tableCells(l).map((c) => c.trim()));
            if (rows.length < 2 || !rows[1].every((c) => /^:?-+:?$/.test(c))) continue;
            // A row with more cells than the table has columns (a `\\|` typed in a description) is left as written
            if (rows.some((r) => r.length > rows[1].length)) continue;
            const head = rows[0].map((c) => this.withoutFreeze(c));
            const freeze = this.freezeHeader(old.get(heading)?.[n] ?? null, settings, head);
            if (!freeze && head.every((c, k) => c === rows[0][k])) continue;
            const align = rows[1].map((c) => (c.startsWith(":") ? (c.endsWith(":") ? "center" : "left") : c.endsWith(":") ? "right" : null));
            out.splice(at, end - at + 1, ...this.table(head, align, rows.slice(2), { freeze }));
        }
        return out;
    }

    // `block` with its tables frozen, from the block in `content` (the note as it is now) and `settings`.
    // With the default off and no freeze in the note, it's `block` as it is.
    freezeBlock(block, content, settings) {
        const text = String(content ?? "");
        if (!settings && !/%%\s*(?:freeze|default|custom)\b/.test(text)) return block;
        const lines = this.lines(text);
        const { blocks, starts, ends } = this.scan(lines);
        const now = starts.length === 1 && ends.length === 1 && blocks.length === 1 ? lines.slice(blocks[0].start, blocks[0].end + 1) : [];
        return this.withFreezes(this.lines(block), this.freezesIn(now), settings).join("\n");
    }

    // ---------------------------------------------------------------- writing the block

    // Where the block goes in `content`: { start, end, text, inserted } (character offsets to
    // replace), or { error }. An existing block is replaced. Otherwise it goes right under `heading`
    // if the note has it, else at the end under a new `heading` (with `heading` null, at the end on
    // its own, as in a timesheet). Never anywhere else.
    placeBlock(content, block, { heading = TimeReport.HEADING } = {}) {
        const nl = content.includes("\r\n") ? "\r\n" : "\n";
        const lines = content.split("\n");            // keeps any \r, so offsets stay exact
        const offset = (n) => lines.slice(0, n).reduce((sum, l) => sum + l.length + 1, 0);
        const endOf = (n) => offset(n) + lines[n].replace(/\r$/, "").length;
        const text = (s) => s.replace(/\r?\n/g, nl);
        const { hidden, starts, ends, unclosed } = this.scan(lines.map((l) => l.replace(/\r$/, "")));
        const blank = (j) => lines[j].trim() === "";

        if (starts.length || ends.length) {
            if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
                return { error: "The time:start / time:end markers are missing, repeated or out of order; fix them and run it again" };
            }
            return { start: offset(starts[0]), end: endOf(ends[0]), text: text(block), inserted: false };
        }

        // A new block would land inside it, and the next run couldn't find it
        if (unclosed.length) {
            return { error: `Line ${unclosed[0].line + 1} opens a ${unclosed[0].what} that never closes; close it and run it again` };
        }

        const h = heading ? lines.findIndex((l, j) => !hidden[j] && l.trim().toLowerCase() === heading.toLowerCase()) : -1;
        if (h !== -1) {
            const here = endOf(h);
            const tail = h + 1 < lines.length && !blank(h + 1) ? nl : "";
            return { start: here, end: here, text: nl + nl + text(block) + tail, inserted: true };
        }
        const trailing = content.match(/(\r?\n)*$/)[0].split("\n").length - 1;
        const lead = content.trim() ? nl.repeat(Math.max(0, 2 - trailing)) : "";
        return { start: content.length, end: content.length, text: `${lead}${heading ? heading + nl + nl : ""}${text(block)}${nl}`, inserted: true };
    }

    // The report's heading before OBS-133, "## Time tracking", or "## Time report" in another case,
    // renamed "## Time Report": the heading right above the block (only blank or hidden lines between
    // them), or, in a note with no block yet, the first one ("## Time report" before "## Time tracking"),
    // which the block then goes under instead of a second heading. Never when another heading in the
    // note already reads "## Time Report", in any case. Only the heading's text changes, so no line
    // moves. Returns the edit { start, end, text }, or null.
    renameHeading(content) {
        const lines = content.split("\n");
        const { hidden, starts, ends } = this.scan(lines.map((l) => l.replace(/\r$/, "")));
        const is = (j, heading) => !hidden[j] && lines[j].trim().toLowerCase() === heading.toLowerCase();
        const either = (j) => is(j, TimeReport.HEADING) || is(j, TimeReport.OLD_HEADING);
        let h = -1;
        if (starts.length) {
            let j = starts[0] - 1;
            while (j >= 0 && (hidden[j] || !lines[j].trim())) j--;
            if (j >= 0 && either(j)) h = j;
        } else if (!ends.length) {
            h = lines.findIndex((l, j) => is(j, TimeReport.HEADING));
            if (h === -1) h = lines.findIndex((l, j) => is(j, TimeReport.OLD_HEADING));
        }
        if (h === -1 || lines[h].trim() === TimeReport.HEADING) return null;
        if (lines.some((l, j) => j !== h && is(j, TimeReport.HEADING))) return null;
        const indent = lines[h].match(/^\s*/)[0].length;
        const start = lines.slice(0, h).reduce((sum, l) => sum + l.length + 1, 0) + indent;
        return { start, end: start + lines[h].trim().length, text: TimeReport.HEADING };
    }

    // What writing `block` does to `content`, as edits applied one after another, each against the
    // content the ones before it left: the old heading renamed, a blank line above the heading, then
    // the block placed (unless `onlyIfChanged` and it's the same apart from its Updated line). [] when
    // there's nothing to do, or { error }. writeBlock applies them; tests/demo/renderReports.mjs too.
    // With `heading` false (a timesheet), the heading above the block goes instead (dropHeading), a new
    // block gets none, and the note gets its class if it hasn't (sheetClass). `tables` is the default freeze (tableSettingsOf): the block's tables are
    // frozen from it and from the block that's there now (freezeBlock), before they're compared.
    blockEdits(content, block, { onlyIfChanged = true, heading = true, tables = null } = {}) {
        const apply = (c, edit) => c.slice(0, edit.start) + edit.text + c.slice(edit.end);
        const edits = [];
        let current = content;
        const steps = heading ? [(c) => this.renameHeading(c), (c) => this.blankLineAbove(c)] : [(c) => this.sheetClass(c), (c) => this.dropHeading(c)];
        for (const step of steps) {
            const edit = step(current);
            if (edit) { edits.push(edit); current = apply(current, edit); }
        }
        block = this.freezeBlock(block, current, tables);
        if (!(onlyIfChanged && this.sameBlock(current, block))) {
            const place = this.placeBlock(current, block, { heading: heading ? TimeReport.HEADING : null });
            if (place.error) return place;
            edits.push(place);
        }
        return edits;
    }

    // A timesheet's report has no heading (OBS-167): the "## Time Report" (or older) heading right
    // above its block, with only blank lines between them, goes, along with those blank lines.
    // Returns the edit { start, end, text }, or null.
    dropHeading(content) {
        const lines = content.split("\n");
        const { hidden, starts } = this.scan(lines.map((l) => l.replace(/\r$/, "")));
        if (starts.length !== 1) return null;
        let j = starts[0] - 1;
        while (j >= 0 && !hidden[j] && !lines[j].trim()) j--;
        const heading = j >= 0 && !hidden[j] && [TimeReport.HEADING, TimeReport.OLD_HEADING].some((h) => lines[j].trim().toLowerCase() === h.toLowerCase());
        if (!heading) return null;
        const offset = (n) => lines.slice(0, n).reduce((sum, l) => sum + l.length + 1, 0);
        return { start: offset(j), end: offset(starts[0]), text: "" };
    }

    // Room to add things above the report (tasks at the top of a weekly or monthly note): the
    // "## Time report" heading always has a blank line above it. Returns the insertion
    // { start, end, text } that adds one, or null when it's already there (or there's no heading).
    blankLineAbove(content, heading = TimeReport.HEADING) {
        const nl = content.includes("\r\n") ? "\r\n" : "\n";
        const lines = content.split("\n");
        const { hidden } = this.scan(lines.map((l) => l.replace(/\r$/, "")));
        const h = lines.findIndex((l, j) => !hidden[j] && l.trim().toLowerCase() === heading.toLowerCase());
        if (h === -1 || (h > 0 && lines[h - 1].trim() === "")) return null;
        if (h === 0) return { start: 0, end: 0, text: nl };
        const prev = lines[h - 1];
        const endOfPrev = lines.slice(0, h - 1).reduce((sum, l) => sum + l.length + 1, 0) + prev.replace(/\r$/, "").length;
        return { start: endOfPrev, end: endOfPrev, text: nl };
    }

    // Saved folds after replacing old[start, end) with `text`: folds after the change move with
    // it, folds around it stretch, folds that start inside a replaced block go
    shiftFolds(folds, content, start, end, text) {
        const newlines = (s) => (s.match(/\n/g) ?? []).length;
        const first = newlines(content.slice(0, start));
        const last = newlines(content.slice(0, end));
        // A change inside one line (a heading renamed) moves no line, so a fold on it stays
        if (first === last && !newlines(text)) return folds.slice();
        const delta = newlines(text) - newlines(content.slice(start, end));
        const moved = [];
        for (const f of folds) {
            if (f.from === 0 && f.to === 0) moved.push(f);                                   // collapsed frontmatter
            else if (f.to < first) moved.push(f);
            else if (f.from > last) moved.push({ from: f.from + delta, to: f.to + delta });
            else if (start === end) moved.push(f.to === first ? f : { from: f.from, to: f.to + delta }); // inserted after line `first`
            else if (f.from < first) moved.push(f.to >= last ? { from: f.from, to: f.to + delta } : f); // starts above the block
            // folds that start inside the old block go with it
        }
        return moved;
    }

    // Same block apart from the "Updated" line
    sameBlock(content, block) {
        const lines = this.lines(content);
        const { blocks, starts, ends } = this.scan(lines);
        if (starts.length !== 1 || ends.length !== 1 || blocks.length !== 1) return false;
        // Line 1 says when it was updated (after the timesheet link, on a project): that alone isn't a change
        const strip = (ls) => ls.map((l, i) => (i === 1 ? l.replace(/\*Updated [^*]*\*/, "*Updated*") : l)).join("\n");
        return strip(lines.slice(blocks[0].start, blocks[0].end + 1)) === strip(this.lines(block));
    }

    hasBlock(content) {
        return this.scan(this.lines(content)).starts.length > 0;
    }

    // ---------------------------------------------------------------- toggle hotkey
    // Used by the ToggleTimeEntry command (toggleTimeEntry.js).

    // The task or event (a checkbox line) the cursor is on or under, or -1
    // The task or event line `cursorLine` is on or under: the top of its nest (nestTop; rule 5, OBS-193), when
    // that's a checklist line or a meeting line in the form used before August 2025, else -1. A sub-task's
    // clock is its task's.
    anchorLine(lines, cursorLine) {
        const line = lines[cursorLine];
        if (line === undefined || line.trim() === "") return -1;
        const top = this.nestTop((n) => lines[n], cursorLine);
        const t = lines[top];
        return /^\s*[-*+]\s+\[.\]/.test(t) || this.classify(t).kind === "event" ? top : -1;
    }

    // Last line of a task's sub-bullets, across blank lines between them, and comment-only lines no deeper
    // than the task (one indented under it is part of it)
    subtreeEnd(lines, anchor) {
        const w = this.indentWidth(lines[anchor]);
        let k = anchor;
        for (let j = anchor + 1; j < lines.length; j++) {
            if (lines[j].trim() === "" || (this.commentOnly(lines[j]) && this.indentWidth(lines[j]) <= w)) continue;
            if (this.indentWidth(lines[j]) <= w) break;
            k = j;
        }
        return k;
    }

    // A line that shows nothing: only a %% %% or <!-- --> comment, or whitespace
    commentOnly(line) {
        return /^\s*(?:%%[^%]*%%|<!--[\s\S]*?-->)\s*$/.test(line);
    }

    // The top of the nest line `i` sits in (rule 5, OBS-193): the outermost checklist line that `i` is
    // nested under, an event included, and a meeting line in the form days used before August 2025 too
    // (rule 1: an event is told by its form), else `i`. Plain bullets and indented text between are
    // skipped, as parseNote skips them, and so are blank and comment-only lines; a paragraph or heading
    // at the left edge ends the walk. `lineAt(n)` gives line n, so an editor's lines are read one at a
    // time, never the whole note. Pure.
    nestTop(lineAt, i) {
        const isBox = (l) => /^\s*[-*+]\s+\[.\]/.test(l);
        let top = i, width = this.indentWidth(lineAt(i));
        for (let j = i - 1; j >= 0 && width > 0; j--) {
            const l = lineAt(j);
            if (l === undefined) break;
            if (!l.trim() || this.commentOnly(l)) continue;
            const w = this.indentWidth(l);
            if (w >= width) continue;
            width = w;
            if (isBox(l)) top = j;
            else if (w === 0) {
                if (this.classify(l).kind === "event") top = j;
                break;
            }
        }
        return top;
    }

    // Line `i` through nestTop, for every command (rule 5): { at, line, box, event }, the top's index and
    // text, its checkbox character (null for a line with none) and what kind of event it is (eventKind;
    // null for a task). `lines` is an array, or a function giving line n.
    topOf(lines, i) {
        const lineAt = typeof lines === "function" ? lines : (n) => lines[n];
        const at = this.nestTop(lineAt, i);
        const line = lineAt(at);
        return { at, line, box: line.match(/^\s*[-*+]\s+\[(.)\]/)?.[1] ?? null, event: this.eventKind(line) };
    }

    // What kind of event a line is, told by its form (rule 1), or null for a task or anything else:
    // "event" for a [<] line; "forwarded" for a [>] line the calendar sync wrote when the event moved,
    // its date in front and then the event's time and a tab; "canceled" for a [-] line it wrote, the
    // event's time and a tab first; "meeting" for a line in the form days used before August 2025, at
    // the left edge with no bullet and its time first (classify's "event").
    eventKind(line) {
        const m = line.match(/^\s*[-*+]\s+\[(.)\]\s*(.*)$/);
        if (!m) return this.classify(line).kind === "event" ? "meeting" : null;
        const [, box, body] = m;
        if (box === "<") return "event";
        if (box === ">" && /^\[\[\d{4}-\d{2}-\d{2}\|[^\]]*\]\]\s+(?:all day|\d{1,2}:\d{2}\s?[ap]m)\t/i.test(body)) return "forwarded";
        if (box === "-" && /^(?:all day|\d{1,2}:\d{2}\s?[ap]m)\t/i.test(body)) return "canceled";
        return null;
    }

    // A task's running entries: every one under it, a sub-task's included (rule 5, OBS-193)
    ownOpenLines(lines, anchor, all = this.openLines(lines)) {
        const last = this.subtreeEnd(lines, anchor);
        return all.filter((i) => i > anchor && i <= last && this.anchorLine(lines, i) === anchor);
    }

    openLines(lines, from = 0, to = lines.length - 1) {
        const { visible, hidden, blocks } = this.scan(lines);
        const out = [];
        for (let i = from; i <= to; i++) {
            if (hidden[i] || blocks.some((b) => i >= b.start && i <= b.end)) continue;
            if (this.classify(visible[i]).kind === "open") out.push(i);
        }
        return out;
    }

    // { from, to, text, cursor } to add "- 9:01am - " under the task, above its first sub-task or else
    // at the end of its sub-bullets (or on the empty bullet the cursor is on), or { error }
    startEntry(lines, cursorLine, now) {
        const anchor = this.anchorLine(lines, cursorLine);
        if (anchor === -1) return { error: "Put the cursor on a task or event" };
        const running = this.ownOpenLines(lines, anchor);
        if (running.length) return { error: `Already running since ${this.classify(this.scan(lines).visible[running[0]]).entry[1]}` };
        const last = this.subtreeEnd(lines, anchor);

        // An empty bullet you just typed directly under the task gets the entry; anywhere deeper
        // (under a plain bullet) the entry wouldn't count, so it goes at the task's own level
        const empty = lines[cursorLine].match(/^(\s*)[-*+]\s*$/);
        const parentOf = (j) => {
            const w = this.indentWidth(lines[j]);
            for (let k = j - 1; k >= 0; k--) if (lines[k].trim() && this.indentWidth(lines[k]) < w) return k;
            return -1;
        };
        if (cursorLine !== anchor && empty && parentOf(cursorLine) === anchor) {
            const entry = `${empty[1]}- ${now} - `;
            return { from: { line: cursorLine, ch: 0 }, to: { line: cursorLine, ch: lines[cursorLine].length }, text: entry, cursor: { line: cursorLine, ch: entry.length } };
        }
        const child = lines.slice(anchor + 1, last + 1).find((l) => l.trim() !== "" && !this.commentOnly(l));
        const indent = child ? child.match(/^\s*/)[0] : lines[anchor].match(/^\s*/)[0] + "\t";
        const entry = `${indent}- ${now} - `;
        // The task's own entries read best above its sub-tasks: the entry goes just before the
        // first sub-task, after any end time, entries and notes; with no sub-tasks, at the end
        let after = last;
        if (child) {
            const isBox = (l) => /^\s*[-*+]\s+\[.\]/.test(l);
            const sub = lines.findIndex((l, j) => j > anchor && j <= last && isBox(l) && this.indentWidth(l) === this.indentWidth(child));
            if (sub !== -1) after = sub - 1;
        }
        const pos = { line: after, ch: lines[after].length };
        return { from: pos, to: pos, text: "\n" + entry, cursor: { line: after + 1, ch: entry.length } };
    }

    // { line, text } replacing the running entry's line with its end time filled in, or { error }.
    // Picks the entry on the cursor line, else the one under the cursor's task, else the note's only one.
    stopEntry(lines, cursorLine, now) {
        const all = this.openLines(lines);
        let target = all.includes(cursorLine) ? cursorLine : null;
        if (target === null) {
            const anchor = this.anchorLine(lines, cursorLine);
            const under = anchor === -1 ? [] : all.filter((i) => i > anchor && i <= this.subtreeEnd(lines, anchor));
            if (under.length > 1) return { error: "More than one running entry here; put the cursor on one" };
            if (under.length === 1) target = under[0];
        }
        if (target === null) {
            if (!all.length) return { error: "No running time entry in this note" };
            if (all.length > 1) return { error: `${all.length} running entries in this note; put the cursor on one` };
            target = all[0];
        }
        const raw = lines[target];
        const m = raw.match(TimeReport.BULLET)?.[3].trim().match(TimeReport.ENTRY);
        if (m) {
            const [, lead, mark] = raw.match(TimeReport.BULLET);
            const note = (m[3] ?? "").trim();
            return { line: target, text: `${lead}${mark} ${m[1]} - ${now}${note ? ": " + note : ""}` };
        }
        // A comment on the line (`- 9:00am - %%billable%%`): the end time goes after the dash,
        // and the rest of the line stays as it is
        const start = raw.match(TimeReport.ENTRY_START);
        if (!start) return { error: "A comment on this entry is in the way; fill in its end time by hand" };
        const rest = raw.slice(start[0].length);
        return { line: target, text: `${start[1]}${start[2]} - ${now}${rest && !rest.startsWith(":") ? " " : ""}${rest}` };
    }

    // What the hotkey does with the task or event the cursor is on or under:
    //   { action: "start" | "stop", edit (startEntry's or stopEntry's), summary } — no entries or all
    //     stopped starts one; its one running entry stops (the entry on the cursor's line wins);
    //   { jump: { line, ch }, summary } — stopping now would make an entry of LONG_MINUTES or
    //     more, which is almost never right: go to the entry to type its end time instead;
    //   { choose: [{ line, label }] } — several running entries: toggle the line picked;
    //   { pick: true } — no task here: pick one from today's daily note (toggleChoices);
    //   { error }.
    // `daysAgo` is how many days before today the note's date is (0 for today, or a note that
    // isn't a daily note). With `canStart` false (a note other than today's daily note, where the
    // report wouldn't count the time), a start becomes { pick: true, elsewhere: true }: the dropdown
    // of today's note instead. Stops still work.
    toggleEntry(lines, cursorLine, now, daysAgo = 0, canStart = true) {
        const all = this.openLines(lines);
        if (all.includes(cursorLine)) return this.stopToggle(lines, cursorLine, now, daysAgo);
        const anchor = this.anchorLine(lines, cursorLine);
        if (anchor === -1) return { pick: true };
        const running = this.ownOpenLines(lines, anchor, all);
        if (running.length === 1) return this.stopToggle(lines, running[0], now, daysAgo);
        if (running.length > 1) {
            const { visible } = this.scan(lines);
            return { choose: running.map((i) => ({ line: i, label: `Stop ${this.timerLabel(lines, visible, i)}` })) };
        }
        if (!canStart) return { pick: true, elsewhere: true };
        const edit = this.startEntry(lines, cursorLine, now);
        if (edit.error) return edit;
        // An open task that gets a timer is started: [ ] becomes [/], which stays after it stops.
        // Events ([<]) and every other status are left alone.
        const open = lines[anchor].match(/^(\s*[-*+]\s+)\[ \](.*)$/);
        const status = open ? { line: anchor, text: `${open[1]}[/]${open[2]}` } : undefined;
        return { action: "start", edit, ...(status && { status }), summary: `Started ${now}: ${this.itemLabel(this.scan(lines).visible[anchor])}` };
    }

    stopToggle(lines, line, now, daysAgo) {
        const { visible } = this.scan(lines);
        const start = this.classify(visible[line]).entry[1];
        // Minutes it would run. In today's note an end before the start runs past midnight.
        let span = daysAgo * 1440 + this.minutes(now) - this.minutes(start);
        if (daysAgo === 0 && span < 0) span += 1440;
        if (span < 0 || span >= TimeReport.LONG_MINUTES) {
            const ago = daysAgo > 0 ? ` (${daysAgo} day${daysAgo === 1 ? "" : "s"} ago)` : "";
            return { jump: this.lineCursor(lines, line), summary: `Running since ${start}${ago}: type its end time` };
        }
        const edit = this.stopEntry(lines, line, now);
        if (edit.error) return edit;
        const anchor = this.anchorLine(lines, line);
        const task = anchor === -1 ? "" : `: ${this.itemLabel(visible[anchor])}`;
        return { action: "stop", edit, summary: `Stopped ${start} - ${now}${task}` };
    }

    // Where the cursor goes on a line you jump to: right after the dash on an entry, where its end
    // time is typed, else the end of the line
    lineCursor(lines, line) {
        const start = this.classify(lines[line]).kind !== "entry" ? lines[line].match(TimeReport.ENTRY_START) : null;
        return { line, ch: start ? start[0].length : lines[line].length };
    }

    // "10:30am: Charts" for a running entry: its start and the task or event it's under, which
    // (unlike an entry's note) is always there to say what the time is for
    timerLabel(lines, visible, line) {
        const anchor = this.anchorLine(lines, line);
        return `${this.classify(visible[line]).entry[1]}${anchor === -1 ? "" : ": " + this.itemLabel(visible[anchor])}`;
    }

    // A task or event line as dropdown text: no bullet or checkbox, links shown as their text, a sent
    // line's forward date and a task's ID left out
    itemLabel(line) {
        return line.trimEnd().replace(TimeReport.BLOCK_ID, "").replace(TimeReport.FORWARD_LINK, "").replace(TimeReport.BULLET, "$3").replace(/^\[.\]\s*/, "")
            .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1").replace(/\[\[([^\]]*)\]\]/g, "$1")
            .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
            .replace(/\s+/g, " ").trim();
    }

    // The dropdown when the cursor isn't on a task, for today's daily note: [{ line, label }] with
    // running entries first (picking one stops it), then open tasks and events that have none.
    toggleChoices(lines) {
        return [...this.runningChoices(lines), ...this.taskChoices(lines)];
    }

    // A note's running entries as dropdown items; `day` ("9/14") marks a note other than today's
    runningChoices(lines, day = "") {
        const { visible } = this.scan(lines);
        return this.openLines(lines).map((i) => ({ line: i, label: `⏱ Stop ${this.timerLabel(lines, visible, i)}${day ? " · " + day : ""}` }));
    }

    // Open tasks and events with no running entry, top lines only (rule 5, OBS-193): a sub-task's clock is
    // its task's, so a nested line isn't offered. Done [x], cancelled [-] and forwarded [>] items are left
    // out; [<] is an event, so it stays.
    taskChoices(lines) {
        const { visible, hidden, blocks } = this.scan(lines);
        const all = this.openLines(lines);
        const lineAt = (n) => lines[n];
        // Under an entry, a checkbox is a note about that entry, and time logged under it wouldn't count
        const underEntry = (i) => {
            let w = this.indentWidth(lines[i]);
            for (let k = i - 1; k >= 0 && w > 0; k--) {
                if (!visible[k].trim() || this.indentWidth(lines[k]) >= w) continue;
                if (["entry", "open", "rangeish"].includes(this.classify(visible[k]).kind)) return true;
                w = this.indentWidth(lines[k]);
            }
            return false;
        };
        const items = [];
        for (let i = 0; i < lines.length; i++) {
            if (hidden[i] || blocks.some((b) => i >= b.start && i <= b.end)) continue;
            const box = lines[i].match(/^\s*[-*+]\s+\[(.)\]/);
            if (!box || /[xX>-]/.test(box[1]) || this.nestTop(lineAt, i) !== i || underEntry(i)) continue;
            if (this.ownOpenLines(lines, i, all).length) continue;
            const label = this.itemLabel(visible[i]);
            if (label) items.push({ line: i, label });
        }
        return items;
    }

    // toggleEntry on a note's text, for a note that isn't open in an editor: its result plus
    // `content`, the note with the edit made (in the note's line endings), when there's something to write
    toggleText(text, line, now, daysAgo = 0, canStart = true) {
        const lines = this.lines(text);
        const r = this.toggleEntry(lines, line, now, daysAgo, canStart);
        if (!r.action) return r;
        const starts = [0, ...[...text.matchAll(/\n/g)].map((m) => m.index + 1)];
        const offset = (pos) => starts[pos.line] + pos.ch;
        const e = r.edit;
        const [start, end, insert] = e.from
            ? [offset(e.from), offset(e.to), e.text.replace(/\n/g, text.includes("\r\n") ? "\r\n" : "\n")]
            : [offset({ line: e.line, ch: 0 }), offset({ line: e.line, ch: lines[e.line].length }), e.text];
        let content = text.slice(0, start) + insert + text.slice(end);
        // The status change keeps the task line's length, so it doesn't move the edit above
        if (r.status) {
            const at = offset({ line: r.status.line, ch: 0 });
            content = content.slice(0, at) + r.status.text + content.slice(at + lines[r.status.line].length);
        }
        return { ...r, content };
    }

    // Saved folds after `inserted` goes in as a new line after line `after`: folds below move down,
    // and a fold that runs to that line from a line less indented than the new one (its task, and
    // what that's nested under) takes it in, so a folded task stays folded with its new entry
    foldsAfterInsert(folds, lines, after, inserted) {
        const w = this.indentWidth(inserted);
        return folds.map((f) => {
            if (f.from === 0 && f.to === 0) return f;                                        // collapsed frontmatter
            if (f.from > after) return { from: f.from + 1, to: f.to + 1 };
            if (f.to >= after && this.indentWidth(lines[f.from]) < w) return { from: f.from, to: f.to + 1 };
            return f;
        });
    }

    // ---------------------------------------------------------------- Obsidian

    // The command: always says what happened
    async invoke() {
        await this.refresh({ quiet: false });
    }

    // Rebuilds every report. `quiet` (the startup run) shows a notice only when something needs you.
    async refresh({ quiet }) {
        if (window.timeReportRunning) { if (!quiet) new Notice("The time report is already running"); return; }
        window.timeReportRunning = true;
        // A script saved while this runs makes CustomJS start `customJS` over and register the classes
        // again one file at a time, so keep the Schedule and Billing this run began with instead of
        // looking them up on the global part-way through (OBS-41)
        this.schedule = customJS.Schedule;
        const billing = customJS.Billing;
        const errorLog = customJS.ErrorLog;
        const working = quiet ? null : new Notice("Building the time report…", 0);

        try {
            // Billing reads the invoice notes for the timesheets (OBS-5); without it they'd show every
            // billed entry as unbilled, so nothing is written until CustomJS has it registered
            if (!billing) {
                console.warn("TimeReport: customJS.Billing isn't registered (CustomJS still reloading?); nothing written");
                if (!quiet) new Notice("Time report: the Billing script isn't loaded; try again in a moment");
                return;
            }
            const index = this.appIndex();
            // No project or area notes at all means the metadata cache isn't ready; writing now would
            // put every entry under Unassigned
            if (!app.vault.getMarkdownFiles().some((f) => this.counts(f.path, index))) {
                console.warn("TimeReport: no project notes found (vault still indexing?); nothing written");
                if (!quiet) new Notice("Time report: no project notes found yet; try again in a moment");
                return;
            }
            // Nothing is written while a daily note is still in the marks before OBS-208: currentModel
            // says so (oldMarksNotice) and throws
            const { model } = await this.currentModel({ index, schedule: this.schedule, billing });
            const stamp = window.moment().format("YYYY-MM-DD h:mma");
            // Project and area links by name (tables escape the | themselves)
            const link = (p) => {
                const f = app.vault.getFileByPath(p);
                return this.reportLink(f ? app.metadataCache.fileToLinktext(f, "", true) : this.basename(p), p);
            };
            const done = [], trouble = [];
            const linkTarget = this.periodLinkTarget(this.periodFolders());

            const { updated, broken, created: sheetsMade } = await this.writeProjectNotes(model, index, stamp, link, linkTarget);
            if (updated) done.push(`${updated} project note${updated === 1 ? "" : "s"}`);
            if (sheetsMade.length) {
                done.push(`${sheetsMade.length} timesheet note${sheetsMade.length === 1 ? "" : "s"} created`);
                // New notes are news even at startup
                if (quiet) new Notice(`Time report created ${sheetsMade.length} timesheet note${sheetsMade.length === 1 ? "" : "s"}: ${sheetsMade.join(", ")}`);
            }
            // Only the desktop creates missing periodic notes, so two devices never create the same one
            const periods = await this.writePeriodNotes(model, stamp, link, { create: customJS.obsidian.Platform.isDesktop });
            if (periods.created.length) {
                done.push(`${periods.created.length} periodic note${periods.created.length === 1 ? "" : "s"} created`);
                // New notes are news even at startup
                if (quiet) new Notice(`Time report created ${periods.created.length} note${periods.created.length === 1 ? "" : "s"}: ${periods.created.join(", ")}`);
            }
            if (periods.updated) done.push(`${periods.updated} periodic note${periods.updated === 1 ? "" : "s"}`);
            broken.push(...periods.broken);
            trouble.push(...periods.trouble);
            const markers = broken.filter((b) => typeof b === "string"), heldBack = broken.filter((b) => b?.heldBack).map((b) => b.heldBack);
            if (markers.length) trouble.push(`couldn't update ${markers.join(", ")} (check its time:start/end markers, or an unclosed code block or comment)`);
            // A plugin refused the change to the open note (OBS-238); the next run tries again
            if (heldBack.length) trouble.push(`couldn't update ${heldBack.join(", ")}: the open note didn't take the change; click outside its tables and run TimeReport again`);

            // The error log (OBS-218): this run's Problems, one line per kind per note, and a toast
            // for the new ones, at startup too
            if (errorLog) {
                try {
                    errorLog.toast("Time report", await errorLog.write("Time report", errorLog.fromModel(model, link), { create: customJS.obsidian.Platform.isDesktop }));
                } catch (e) {
                    console.error("TimeReport: couldn't update the error log", e);
                    trouble.push(`couldn't update ${errorLog.constructor.PATH} (${e.message})`);
                }
            } else console.warn("TimeReport: customJS.ErrorLog isn't registered (CustomJS still reloading?); the error log wasn't updated");

            if (trouble.length) new Notice(`Time report: ${trouble.join(" · ")}`, 0);
            else if (!quiet) new Notice(done.length ? `Time report updated: ${done.join(", ")}` : "Time report is already up to date");
        } catch (e) {
            if (!e?.oldMarks) {
                console.error("TimeReport failed", e);
                new Notice("Time report failed — check the console");
            }
        } finally {
            working?.hide();
            window.timeReportRunning = false;
        }
    }

    // Why a line may keep another project than the rest of its task (spec section 10): its time is on a
    // sent or paid invoice, or its project is finished. A function of (note, i) for TaskIds.check, with
    // the invoiced lines worked out once per report, the first time it's asked.
    keepsProject(model, index) {
        const b = model.billing;
        let billed = null;
        return (note, i) => {
            billed ??= new Set(b ? model.entries
                .filter((e) => ["sent", "paid"].includes(b.billing.standing(e, b.ledger).invoice?.status))
                .map((e) => `${e.path}:${e.context?.[0]?.line}`) : []);
            if (billed.has(`${note.path}:${i + 1}`)) return "invoiced";
            const p = this.lineProject(note, i, note.text.split("\n"), index, false);
            const f = p ? globalThis.app?.vault?.getFileByPath(p) : null;
            const helper = globalThis.customJS?.AddTaskNote;
            return f && helper?.isLiveHome && !helper.isLiveHome(f) ? "finished" : null;
        };
    }

    // Whether a task's line in `note` ({ path, kind }) is compared with its other lines for its project: one
    // in a periodic note, or a project's or area's own note. A line in a task note, log or plain note is
    // compared with nothing (rule 15), so a subtask's day line can go its own way.
    comparedNote(note, index) {
        return note.kind !== "other" || (this.counts(note.path, index) && this.basename(this.dirname(note.path)) === this.basename(note.path));
    }

    // The notes the report's checks read (OBS-181, OBS-196): the daily notes the report already read
    // (`daily`, [{ date, path, text }]), every other note holding a task ID, the periodic notes a task
    // line's forward date points at, which the cache may not have read again since a command wrote them,
    // and every note whose links in the cache include a ⭕, 🗃️, 🚩, ⋯ or ↗. Each is read once, as it is now
    // (textOf: from its editor when it's open in one), as the daily notes are.
    async taskNotes(daily) {
        const byPath = new Map(daily.map((n) => [n.path, { path: n.path, kind: "day", date: n.date, text: n.text }]));
        const tasks = globalThis.customJS?.TaskIds;
        if (!tasks?.allIds) return [...byPath.values()];
        const T = tasks.constructor;
        // The notes in the system, and Archive, whose Problems are listed too (Brian, 2026-10-28)
        const add = async (file) => {
            if (!byPath.has(file.path) && (!tasks.ignored(file) || file.path.startsWith(T.ARCHIVE ?? "Archive/"))) byPath.set(file.path, { path: file.path, kind: tasks.kindOf(file), text: await this.textOf(file) });
        };
        for (const lines of tasks.allIds().values()) for (const { file } of lines) await add(file);
        // A forward date is only checked on a line outside the periodic notes (TaskIds.check)
        for (const note of [...byPath.values()].filter((n) => n.kind === "other")) {
            for (const line of note.text.split("\n")) {
                const fwd = T.CHECKBOX.test(line) && T.idOf(line) ? T.forwardOf(line) : null;
                const to = fwd ? app.metadataCache.getFirstLinkpathDest(fwd.linkpath, note.path) : null;
                if (to && tasks.kindOf(to) !== "other") await add(to);
            }
        }
        for (const file of app.vault.getMarkdownFiles()) {
            if (app.metadataCache.getFileCache(file)?.links?.some((l) => /^\s*(?:⭕|🗃|🚩|⋯|↗)/u.test(l.displayText ?? ""))) await add(file);
        }
        return [...byPath.values()];
    }

    // A daily note's date, for one the report's list doesn't hold: its name read with the Daily notes
    // format, not taken from the name as it is. The name itself where Schedule or moment isn't loaded.
    dailyDate(path) {
        const name = this.basename(path);
        try {
            const format = globalThis.customJS?.Schedule?.dailyOpts?.().format;
            const m = format ? globalThis.window?.moment?.(name, format, true) : null;
            return m?.isValid() ? m.format("YYYY-MM-DD") : name;
        } catch {
            return name;
        }
    }

    // A task's lines that disagree (OBS-181), as Problems: TaskIds.check over `notes` (taskNotes); then
    // the marks on sub-tasks and the `parent`s that differ from their folders (rule 15). A line in a daily
    // note is a Problem on its day; a line in any other note, one on the task's project, or, when the task
    // counts toward none, a Problem on its note that the weekly, monthly and yearly notes list under a day
    // (problemDate).
    // Pure, so the demo's reports (renderReports.mjs) run it too, passing TaskIds as `T`.
    addTaskProblems(model, index, notes, T = globalThis.customJS?.TaskIds?.constructor) {
        if (!T?.check) return;
        const byPath = new Map(notes.map((n) => [n.path, n]));
        const violations = T.check(notes, {
            projectOf: (note, i, lines) => this.lineProject(note, i, lines, index, false),
            exempt: this.keepsProject(model, index),
            compared: (note) => this.comparedNote(note, index),
            resolve: (linkpath, from) => index.linkDest(linkpath.split("#")[0], from),
            ownNote: (text, from) => this.ownNote(this.lineLinks(this.classify(text).body), from, index),
        });
        // Where a Problem on line `l` of its note goes
        const place = (l, fields, projects) => {
            const note = byPath.get(l.path);
            const { kind, rule, message } = fields;
            const shared = { line: l.line + 1, path: l.path, kind, ...(rule ? { rule } : {}) };
            if (note.kind === "day") {
                model.problems.push({ date: note.date ?? this.dailyDate(l.path), ...shared, message, text: l.text, projects });
            } else if (projects.length) {
                for (const project of projects) model.projectProblems.push({ project, ...shared, message: `has a task line in [[${this.basename(l.path)}]] (line ${l.line + 1}) that ${message}` });
            } else {
                // On no day and no project: the periodic notes list it under a day, linking the note it's in
                model.problems.push({ date: this.problemDate(note, l, byPath, index, T), note: l.path, ...shared, message, text: l.text, projects });
            }
        };
        for (const v of violations) {
            const first = v.lines.find((l) => byPath.get(l.path)?.kind !== "other") ?? v.lines[0];
            const firstNote = byPath.get(first.path);
            const taskProject = this.lineProject(firstNote, first.line, firstNote.text.split("\n"), index, false);
            // A project disagreement changes what's billed, so it shows on every project the task's lines
            // count toward; any other rule, on the task's own project
            const projects = v.rule === "project" ? [...new Set(v.detail.projects.filter(Boolean))] : taskProject ? [taskProject] : [];
            for (const l of v.lines) place(l, { kind: "task", rule: v.rule, message: this.taskProblemText(v, l) }, projects);
        }
        for (const l of this.subTaskProblems(notes, T)) {
            const note = byPath.get(l.path);
            const project = this.lineProject(note, l.line, this.shown(note), index, false);
            place(l, { kind: "subtask", message: l.message }, project ? [project] : []);
        }
        model.projectProblems.push(...this.parentProblems(index));
        // In the order build sorts the rest
        model.problems.sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line);
    }

    // The day a task Problem on line `l` of `note`, a note that isn't a daily note, is listed under: a
    // week's, month's or year's first day; for any other note, the day its forward date points at (a week's, month's
    // or year's first), else today
    problemDate(note, l, byPath, index, T) {
        if (note.kind !== "other") return this.noteDate(note, note.kind);
        const fwd = T.forwardOf(l.text);
        const to = fwd ? index.linkDest(fwd.linkpath, l.path) : null;
        const target = to ? byPath.get(to) : null;
        const date = !to ? null : target?.kind === "day" ? target.date ?? this.dailyDate(to)
            : target && target.kind !== "other" ? this.periodStart(to, target.kind) : this.dailyDate(to);
        return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : this.today();
    }

    // The first day (YYYY-MM-DD) of a week, month or year note (`unit`), by the report's own names
    // (2026w38, 2026-09, 2026), else read with the vault's formats where DatePrompt and moment are
    // loaded; null when it can't be read
    periodStart(path, unit) {
        const name = this.basename(path);
        if (unit === "week" && TimeReport.PERIOD_NAME.week.test(name)) return this.weekRange(name)[0];
        if (unit === "month" && TimeReport.PERIOD_NAME.month.test(name)) return `${name}-01`;
        if (unit === "year" && TimeReport.PERIOD_NAME.year.test(name)) return `${name}-01-01`;
        try {
            const rules = globalThis.customJS?.DatePrompt?.weekRules?.();
            const m = rules ? globalThis.window?.moment?.(name, rules.format[unit], rules.locale, true) : null;
            return m?.isValid() ? m.format("YYYY-MM-DD") : null;
        } catch {
            return null;
        }
    }

    // Today, YYYY-MM-DD, by moment where it's loaded
    today() {
        return globalThis.window?.moment ? window.moment().format("YYYY-MM-DD") : new Date().toISOString().slice(0, 10);
    }

    // What a Problem says about line `l` of a task check's result `v`
    taskProblemText(v, l) {
        const name = (p) => (/^\d{4}-\d{2}-\d{2}$/.test(this.basename(p)) ? this.shortDate(this.basename(p)) : this.basename(p));
        const ref = (o) => `[[${this.basename(o.path)}|${name(o.path)}]] line ${o.line + 1}`;
        const others = v.lines.filter((o) => o !== l).map(ref).join(", ");
        switch (v.rule) {
            case "project": return `is the same task as ${others}, and they don't name the same project; give every line of the task the same one`;
            case "open": {
                // A sent line a click turned into [ ] keeps its ID: taking it off would lose the task's link
                const clicked = v.lines[v.detail.clicked ?? -1];
                if (!clicked) return `is open, and so is the same task at ${others}; a line copied by hand keeps its ID (^${v.id}): take it off the copy`;
                const fix = "set it back to `[>]`, or Schedule it, which moves the task and puts the `[>]` back";
                return l === clicked ? `is a sent line a click turned from \`[>]\` into \`[ ]\`, so its task is open here and at ${others}; ${fix}`
                    : `is open, and so is the same task at ${others}; ${ref(clicked)} is a sent line a click turned from \`[>]\` into \`[ ]\`: ${fix}`;
            }
            case "finished": return v.detail.open ? `is part of a task that's both done and open (${others})` : `is done, and the same task is done at ${others} too`;
            case "forward": {
                const on = v.detail.missing ? "has no forward date" : `has its forward date on ${v.detail.to ? name(v.detail.to) : "a note that isn't there"}`;
                // The source line, then the line where the task is
                return l === v.lines[0] ? `${on}, but the task is at ${others || "no open line"}` : `is where its task is, but the task's line at ${others} ${on}`;
            }
            case "twice": return `has the ID ^${v.id}, which another line in this note has too (${others})`;
            case "notes": return `is also at ${others}, with the same ID (^${v.id}). A task lives in one note, apart from the periodic notes. Delete the line that's in the wrong place, or, if they're really two tasks, take the ID off one`;
            case "ownNotes": return `is the same task as ${others}, and they link different notes with ⋯; take one ⋯ off`;
            default: return `has text after its ID ^${v.id}, so Obsidian no longer reads it; move the text before the ID`;
        }
    }

    // The model as a report run sees it now: every daily note read, entries that haven't ended left
    // out, and the invoice notes attached (OBS-5). The Invoice command builds on the same one, so an
    // invoice and the report never disagree about an entry. A caller that captured Schedule and Billing
    // when it started (refresh, OBS-41) passes them in.
    async currentModel({ index = this.appIndex(), schedule = customJS.Schedule, billing = customJS.Billing } = {}) {
        const clock = window.moment();
        const daily = await this.readDailyNotes(schedule);
        if (this.oldMarksNotice(daily)) throw Object.assign(new Error("TimeReport: daily notes still in the marks before OBS-208"), { oldMarks: true });
        const checked = await this.taskNotes(daily);
        const model = this.build(daily, index, { now: { date: clock.format("YYYY-MM-DD"), minutes: clock.hours() * 60 + clock.minutes() }, checked });
        this.attachBilling(model, await this.readInvoices(billing), index, billing);
        this.addTaskProblems(model, index, checked);
        // The default freeze for the tables written from it (OBS-238)
        model.tables = await this.tableSettings();
        return { model, index };
    }

    // Every invoice note, anywhere in the vault, Archive included: an archived project's invoices
    // still say what's been billed. An invoice is tagged `invoice` in its frontmatter, as the Invoice
    // command writes it; an inline #invoice (a daily note mentioning one) doesn't make a note one.
    // [{ path, props, text }]
    async readInvoices(billing = customJS.Billing) {
        // A note where invoices are filed (an invoices/ folder, or Invoice Settings' `folder`) that still
        // has its Billed entries counts too, flagged, so an invoice whose tag or frontmatter got lost
        // can't let its entries be billed again
        const folder = this.invoiceFolder(billing);
        const out = [];
        for (const f of app.vault.getMarkdownFiles()) {
            const cache = app.metadataCache.getFileCache(f);
            const tagged = !!cache?.frontmatter && this.tagsOf({ frontmatter: cache.frontmatter }).includes("invoice");
            if (!tagged && !billing.inInvoiceFolder(f.path, folder)) continue;
            // Its properties come from the same text as its Billed entries: the metadata cache can lag
            // a status just changed (Mark paid, then the refresh it runs)
            const text = await this.textOf(f);
            if (!tagged && !billing.hasBilled(text)) continue;
            const { getFrontMatterInfo, parseYaml } = customJS.obsidian;
            const info = getFrontMatterInfo(text);
            let props = cache?.frontmatter ?? {}, error = null;
            try { if (info.exists) props = parseYaml(info.frontmatter) ?? {}; } catch (e) { error = e.message; }
            out.push({ path: f.path, props, text, tagged: tagged && !error, error });
        }
        return out;
    }

    // Invoice Settings' `folder` (OBS-112), or "" when it isn't set or isn't a folder
    invoiceFolder(billing) {
        const settings = customJS.Invoice?.constructor.SETTINGS;
        const file = settings ? app.vault.getFileByPath(settings) : null;
        return billing.folderOf(file ? app.metadataCache.getFileCache(file)?.frontmatter?.folder : null).folder;
    }

    // A note's tags from its cache, frontmatter and inline, lowercased, without the #
    tagsOf(cache) {
        const raw = cache.frontmatter?.tags ?? cache.frontmatter?.tag ?? [];
        return (Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/))
            .filter(Boolean)
            .map((t) => String(t).replace(/^#/, ""))
            .concat((cache.tags ?? []).map((t) => t.tag.slice(1)))
            .map((t) => t.toLowerCase());
    }

    // weeks/months/years folders: Notebook Navigator's periodic notes folder plus the folder part of
    // its week/month/year pattern ("[weeks]/gggg[w]ww" → "Reference/Planner/weeks"); without
    // that, weeks/months/years beside the daily notes folder. JumpToDate calls it outside a report
    // run too, before `this.schedule` is set.
    periodFolders() {
        const nn = app.plugins?.plugins?.["notebook-navigator"]?.settings;
        const base = String(nn?.vaultProfiles?.[0]?.periodicNotesFolder ?? "").replace(/\/$/, "");
        const daily = (this.schedule ?? customJS.Schedule).dailyOpts().folder;
        const planner = daily.includes("/") ? daily.slice(0, daily.lastIndexOf("/")) : "";
        const folderOf = (pattern, fallback) => {
            const p = String(pattern ?? "");
            const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : null;
            if (base && dir && dir.replace(/\[[^\]]*\]/g, "").replace(/\//g, "") === "") return `${base}/${dir.replace(/\[([^\]]*)\]/g, "$1")}`;
            return `${planner ? planner + "/" : ""}${fallback}`;
        };
        return {
            week: folderOf(nn?.calendarCustomWeekPattern, "weeks"),
            month: folderOf(nn?.calendarCustomMonthPattern, "months"),
            year: folderOf(nn?.calendarCustomYearPattern, "years"),
        };
    }

    // Link text for a weekly or monthly note: just its name ("2026w37", "2026-05"), unless another note
    // in the vault has that name, then its full path so the link can't land on the wrong note. A link to
    // a note that doesn't exist yet creates it when clicked (its template moves it into its folder).
    periodLinkTarget(folders) {
        const count = new Map();
        for (const f of app.vault.getMarkdownFiles()) count.set(f.basename, (count.get(f.basename) ?? 0) + 1);
        return (unit, key) => {
            const own = app.vault.getFileByPath(`${folders[unit]}/${key}.md`) ? 1 : 0;
            return (count.get(key) ?? 0) - own > 0 ? `${folders[unit]}/${key}` : key;
        };
    }

    // Refreshes the report in the weekly, monthly and yearly notes: every period with entries, plus any
    // periodic note that already has a block. With `create`, a missing note is created from its
    // template first, unless this device created it before (you deleted it: it stays deleted).
    // Returns { updated (existing notes rewritten), created: [names], broken: [names], trouble: [messages] }.
    async writePeriodNotes(model, stamp, link, { create }) {
        const folders = this.periodFolders();
        const linkTarget = this.periodLinkTarget(folders);
        const scopeOf = (unit, key) => ({ kind: "period", unit, key, linkTarget });
        const wanted = this.periodsWithEntries(model);
        const remembered = new Set(app.loadLocalStorage(TimeReport.CREATED_KEY) ?? []);
        let updated = 0;
        const created = [], broken = [], trouble = [];
        let canCreate = create;

        // Weekly notes only while Obsidian names weeks the way weekKey does (Sunday-start weeks)
        const units = ["week", "month", "year"];
        const probe = ["2026-01-01", "2026-12-27", window.moment().format("YYYY-MM-DD")];
        if (probe.some((d) => window.moment(d, "YYYY-MM-DD").format("gggg[w]ww") !== this.weekKey(d))) {
            units.shift();
            trouble.push("weekly notes skipped: Obsidian's weeks no longer start on Sunday, so week names wouldn't match");
        }

        for (const unit of units) {
            const folder = folders[unit];
            const keys = new Set(wanted[unit]);
            for (const f of app.vault.getMarkdownFiles()) {
                if (f.parent?.path === folder && TimeReport.PERIOD_NAME[unit].test(f.basename) && this.hasBlock(await this.textOf(f))) keys.add(f.basename);
            }
            for (const key of [...keys].sort()) {
                const path = `${folder}/${key}.md`;
                let file = app.vault.getFileByPath(path);
                let isNew = false;
                try {
                    if (!file) {
                        if (!canCreate || remembered.has(path)) continue;
                        const made = await this.createPeriodNote(path, unit, key, this.freezeBlock(this.render(model, scopeOf(unit, key), stamp, link), "", model.tables));
                        if (made.error) {
                            trouble.push(made.error);
                            canCreate = false;      // whatever went wrong would go wrong for the rest too
                            continue;
                        }
                        file = made.file;
                        isNew = true;
                        created.push(key);
                        remembered.add(path);
                        app.saveLocalStorage(TimeReport.CREATED_KEY, [...remembered]);
                    }
                    const block = this.render(model, scopeOf(unit, key), stamp, link);
                    const r = await this.writeBlock(file, block, { onlyIfChanged: true, tables: model.tables });
                    if (r.error) broken.push(r.heldBack ? { heldBack: file.basename } : file.basename);
                    else if (r.wrote && !isNew) updated++;
                } catch (e) {
                    console.error(`TimeReport: couldn't update ${path}`, e);
                    broken.push(key);
                }
            }
        }
        return { updated, created, broken, trouble };
    }

    // Creates the note with its frontmatter and report in one write. A note that already has content
    // when it's created isn't templated again by Templater's file-creation rule, so nothing races the
    // write (running Get Template here let Templater's own handler template the note a second time,
    // overlapping the next note: wrong aliases, lost frontmatter). Returns { file } or { error }.
    async createPeriodNote(path, unit, key, block) {
        const folder = path.slice(0, path.lastIndexOf("/"));
        if (!app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder);
        const frontmatter = this.periodFrontmatter(unit, key);
        const file = await app.vault.create(path, `${frontmatter}${frontmatter ? "\n" : ""}${TimeReport.HEADING}\n\n${block}\n`);
        // Give any file-creation handler its moment, then make sure the note is still where it belongs
        await new Promise((r) => setTimeout(r, 1000));
        const here = app.vault.getFileByPath(path);
        if (!here) {
            return { error: `no more periodic notes created: something moved ${key} out of ${folder}` };
        }
        return { file: here };
    }

    appIndex() {
        const cacheOf = (path) => {
            const f = app.vault.getFileByPath(path);
            return f ? app.metadataCache.getFileCache(f) : null;
        };
        const tagged = (path, tag) => {
            const c = cacheOf(path);
            return !!c && this.tagsOf(c).includes(tag);
        };
        // What a note is, kept for this index's life, since the report asks about every line. Schedule's
        // own test, with what it reads off `customJS` taken now, as a run keeps its Schedule (OBS-41): a
        // note that couldn't be told would otherwise fail the run, and read as "other" its time is lost
        const schedule = this.schedule ?? customJS.Schedule, tasks = customJS.TaskIds;
        const rules = customJS.DatePrompt?.weekRules?.(), folders = schedule ? this.periodFolders() : undefined;
        const kinds = new Map();
        const kind = (path) => {
            if (!kinds.has(path)) {
                const f = app.vault.getFileByPath(path);
                kinds.set(path, !f ? "other" : schedule.isDailyNote(f) ? "day" : schedule.periodOf(f, rules, folders) ?? "other");
            }
            return kinds.get(path);
        };
        return {
            exists: (path) => !!app.vault.getFileByPath(path),
            // Exact #project or #area, in frontmatter or inline (same rule as pickParent and SyncArea)
            isProject: (path) => tagged(path, "project"),
            isArea: (path) => tagged(path, "area"),
            isInvoice: (path) => tagged(path, "invoice"),
            isTimesheet: (path) => tagged(path, "timesheet"),
            kind,
            // TaskIds.inSystem's test, through the `kind` above: it asks the global Schedule, which is gone
            // for a moment when CustomJS starts over
            inSystem: (path) => !tasks || kind(path) !== "other" || tasks.constructor.FOLDERS.some((f) => path.startsWith(`${f}/`)),
            inInbox: (path) => !!tasks && path.startsWith(`${tasks.constructor.INBOX}/`),
            paths: () => app.vault.getMarkdownFiles().map((f) => f.path),
            parentLink: (path) => this.parentValue(cacheOf(path)?.frontmatter ?? {}),
            props: (path) => cacheOf(path)?.frontmatter ?? {},
            linkDest: (linktext, fromPath) => app.metadataCache.getFirstLinkpathDest(linktext, fromPath)?.path ?? null,
        };
    }

    // An open note's editor can be ahead of the file on disk (Obsidian saves a moment after typing)
    textOf(file) {
        const view = app.workspace.getLeavesOfType("markdown").map((l) => l.view).find((v) => v?.file === file && v.editor);
        return view ? view.editor.getValue() : app.vault.cachedRead(file);
    }

    // A line the one-time conversion reads (TaskIds.linkBackPass): a list line, or a meeting line in the
    // form days used before August 2025
    convertible(line) {
        return /^\s*[-*+] /.test(line) || this.eventKind(line) === "meeting";
    }

    // How many lines of `daily` ([{ text }]) the one-time conversion would change (TaskIds.linkBackPass):
    // a convertible line whose run ends in a 🗒️ or 🔗 link, the marks before OBS-208
    oldMarkLines(daily) {
        const T = globalThis.customJS?.TaskIds?.constructor;
        const old = (l) => (T?.oldMarks ? T.oldMarks(l).length > 0 : /\|\s*(?:🗒|🔗)\uFE0F?\s*\]\]\s*(?:\^[\w-]+\s*)?$/u.test(l));
        let n = 0;
        for (const d of daily) {
            if (!/🗒|🔗/u.test(d.text)) continue;
            for (const l of d.text.split("\n")) if (this.convertible(l) && old(l)) n++;
        }
        return n;
    }

    // How many lines in all the daily notes, timed or not, the one-time conversion would still change:
    // the calendar sync and the Log template wait while there are any (OBS-208)
    async oldMarksLeft(schedule = customJS.Schedule) {
        let n = 0;
        for (const f of app.vault.getMarkdownFiles()) {
            if (!schedule.isDailyNote(f)) continue;
            const text = await this.textOf(f);
            if (/🗒|🔗/u.test(text)) n += this.oldMarkLines([{ text }]);
        }
        return n;
    }

    // Until the one-time conversion has run, a line with a 🗒️ reads wrong: the dead link hides the ⭕
    // before it, so its time would count toward nothing. A run that would write a report or an invoice
    // stops instead, with a notice that stays: true when it did.
    oldMarksNotice(daily) {
        const n = this.oldMarkLines(daily);
        if (!n) return false;
        console.warn(`TimeReport: ${n} line(s) still end in 🗒️ or 🔗; nothing written until TaskIds.linkBackPass runs`);
        new Notice(`${n} line${n === 1 ? " in the daily notes still ends" : "s in the daily notes still end"} in a 🗒️ or 🔗 link, so the time report, invoices and the calendar sync wait for the one-time conversion: see the manual's Links at the end of a line.`, 0);
        return true;
    }

    async readDailyNotes(schedule = this.schedule) {
        const { format } = schedule.dailyOpts();
        const notes = [];
        for (const f of app.vault.getMarkdownFiles()) {
            if (!schedule.isDailyNote(f)) continue;
            const text = await this.textOf(f);
            if (!/\d[:.]\d\d|\d\s*[ap]\.?m/i.test(text)) continue;
            notes.push({ date: window.moment(f.basename, format, true).format("YYYY-MM-DD"), path: f.path, text });
        }
        return notes;
    }

    // Refreshes the block in every project or area note that has entries or already has a block.
    // Returns { updated: how many were rewritten, broken: names of notes with broken markers }.
    // A link for a table cell: the `|` before its alias escaped, so it doesn't end the cell
    cell(text) {
        return String(text).replace(/\[\[[^\]]*\]\]/g, (l) => l.replace(/(?<!\\)\|/g, "\\|"));
    }

    // The project notes a report goes to: every project or area with time, counted or not, its parents, and
    // any project a project-level problem is about (a conflict can name a project with no time of its own)
    projectTargets(model) {
        const targets = new Set();
        for (const p of [...[...model.entries, ...(model.disputed ?? [])].map((e) => e.project), ...model.projectProblems.map((x) => x.project)]) {
            const seen = new Set();
            for (let up = p; up && !seen.has(up); up = model.parent.get(up)) { seen.add(up); targets.add(up); }
        }
        return targets;
    }

    async writeProjectNotes(model, index, stamp, link, linkTarget) {
        const targets = this.projectTargets(model);
        for (const f of app.vault.getMarkdownFiles()) {
            if (!targets.has(f.path) && this.counts(f.path, index) && this.hasBlock(await this.textOf(f))) targets.add(f.path);
        }
        let updated = 0;
        const broken = [];
        const sheets = this.timesheetNotes(index);
        const remembered = new Set(app.loadLocalStorage(TimeReport.CREATED_KEY) ?? []);
        const created = [];
        for (const path of targets) {
            const file = app.vault.getFileByPath(path);
            if (!file) continue;
            // An area's timesheet made before OBS-131 is left as it was, and no longer linked
            const sheet = this.takesTimesheet(path, index, model) ? await this.writeTimesheet(model, path, sheets, remembered, stamp, link, broken, created) : null;
            try {
                const block = this.render(model, { kind: "project", path, linkTarget, sheet }, stamp, link);
                const r = await this.writeBlock(file, block, { onlyIfChanged: true, tables: model.tables });
                if (r.error) broken.push(r.heldBack ? { heldBack: file.basename } : file.basename);
                else if (r.wrote) updated++;
            } catch (e) {
                console.error(`TimeReport: couldn't update ${path}`, e);
                broken.push(file.basename);
            }
        }
        return { updated, broken, created };
    }

    // Every timesheet note (tagged `timesheet`), by the project its `parent` links: Map(project → path).
    // Found this way, a timesheet stays its project's when either is renamed.
    timesheetNotes(index) {
        const out = new Map();
        for (const f of app.vault.getMarkdownFiles()) {
            const fm = app.metadataCache.getFileCache(f)?.frontmatter;
            if (!fm || !this.tagsOf({ frontmatter: fm }).includes("timesheet")) continue;
            const target = String(index.parentLink(f.path) ?? "").match(/\[\[([^\]|#]+)/)?.[1]?.trim();
            const project = target ? index.linkDest(target, f.path) : null;
            if (project && !out.has(project)) out.set(project, f.path);
        }
        return out;
    }

    // Writes a project's timesheet note (OBS-5): refreshed where it exists, and made on the desktop
    // when the project has entries and none yet (unless this device made one before: you deleted it,
    // so it stays deleted). Returns the link text for the project note to link it, or null.
    // A note of yours that happens to have the timesheet's name, and isn't tagged `timesheet`, is left
    // alone. `created` collects the names of notes made, for the notice.
    async writeTimesheet(model, project, sheets, remembered, stamp, link, broken, created) {
        const tagged = sheets.get(project);
        const path = tagged ?? this.sheetPath(project);
        let file = app.vault.getFileByPath(path);
        try {
            const block = this.render(model, { kind: "timesheet", path: project }, stamp, link);
            if (file && !tagged) {
                console.warn(`TimeReport: ${path} isn't tagged timesheet, so it's left alone and ${this.basename(project)} gets no timesheet`);
                return null;
            }
            if (!file) {
                if (!customJS.obsidian.Platform.isDesktop || remembered.has(path) || !this.sheetHasEntries(model, project)) return null;
                const projectFile = app.vault.getFileByPath(project);
                const alias = [].concat(app.metadataCache.getFileCache(projectFile)?.frontmatter?.aliases ?? [])[0] || projectFile.basename;
                file = await app.vault.create(path, this.sheetNote(window.moment().format("YYYYMMDDHHmmssSS"), `[[${projectFile.basename}|${alias}]]`, this.freezeBlock(block, "", model.tables)));
                remembered.add(path);
                app.saveLocalStorage(TimeReport.CREATED_KEY, [...remembered]);
                created.push(file.basename);
            } else {
                const r = await this.writeBlock(file, block, { onlyIfChanged: true, heading: false, tables: model.tables });
                if (r.error) broken.push(r.heldBack ? { heldBack: file.basename } : file.basename);
            }
            return app.metadataCache.fileToLinktext(file, project, true);
        } catch (e) {
            console.error(`TimeReport: couldn't write ${path}`, e);
            broken.push(this.basename(path));
            return file ? app.metadataCache.fileToLinktext(file, project, true) : null;
        }
    }

    // Makes `edits` ({ start, end, text }, in order, each placed in the text the ones before it leave) to a
    // note open in `editor`. False when the editor doesn't take one, so the caller can say so rather than
    // count the note as written. A plugin can refuse a change: Selectable Tables drops any change to a table
    // while one of its cells is selected (OBS-238). The selection is left alone; clicking outside the table
    // and running the command again gets the change in.
    applyInEditor(editor, edits) {
        for (const edit of edits) {
            const was = editor.getValue();
            if (was.slice(edit.start, edit.end) === edit.text) continue;
            editor.replaceRange(edit.text, editor.offsetToPos(edit.start), editor.offsetToPos(edit.end));
            if (editor.getValue() === was) return false;
        }
        return true;
    }

    // Writes through an open editor when there is one (the editor keeps its own folds), else
    // through the vault in one read-modify-write, moving the saved folds to match. `heading` and
    // `tables` as in blockEdits. { error, heldBack } when the open note didn't take the change.
    async writeBlock(file, block, { onlyIfChanged, heading = true, tables = null }) {
        const apply = (content, edit) => content.slice(0, edit.start) + edit.text + content.slice(edit.end);
        // What to do to `content`: [edits in order], or { error }. Nothing when it's already right.
        const plan = (content) => {
            const edits = this.blockEdits(content, block, { onlyIfChanged, heading, tables });
            return edits.error ? edits : { edits };
        };

        const view = app.workspace.getLeavesOfType("markdown").map((l) => l.view).find((v) => v?.file === file && v.editor);
        if (view) {
            const p = plan(view.editor.getValue());
            if (p.error) return p;
            if (!this.applyInEditor(view.editor, p.edits)) return { error: "the open note didn't take the change", heldBack: true };
            return { wrote: p.edits.length > 0, inserted: p.edits.some((e) => e.inserted) };
        }
        let result = { wrote: false };
        let steps = null;      // [{ before, edit }] for moving the saved folds
        await app.vault.process(file, (content) => {
            const p = plan(content);
            if (p.error) { result = p; return content; }
            if (!p.edits.length) return content;
            steps = [];
            let current = content;
            for (const edit of p.edits) {
                steps.push({ before: current, edit });
                current = apply(current, edit);
            }
            result = { wrote: true, inserted: p.edits.some((e) => e.inserted) };
            return current;
        });
        if (steps) {
            const saved = app.foldManager.load(file);
            if (saved && saved.lines === steps[0].before.split("\n").length) {
                let folds = saved.folds, after = steps[0].before;
                for (const { before, edit } of steps) {
                    folds = this.shiftFolds(folds, before, edit.start, edit.end, edit.text);
                    after = apply(before, edit);
                }
                await app.foldManager.save(file, { folds, lines: after.split("\n").length });
            }
        }
        return result;
    }
}
