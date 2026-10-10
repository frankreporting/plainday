class TimeReport {
    // Time reports built from the time entries in daily notes. Runs at startup on the desktop
    // (TimeReportOnStartup), and as the command "CustomJS: TimeReport". It writes only to these
    // notes, whatever note is open, under "## Time tracking":
    //   - each project note with entries (or with a block already): a summary row for the project and
    //     its sub-projects, then a week-by-week breakdown (total first, newest week next), a link to its
    //     timesheet note, and Problems (which also say what changed since an invoice, OBS-5);
    //   - each project's timesheet note, beside its note: every entry, as Billable time and 🆓 time,
    //     with the invoice that billed it (OBS-5), and Problems that say why an entry is ⚠️ (OBS-143);
    //   - each weekly and monthly note in 36 Planner (weeks/, months/, from Notebook Navigator's
    //     patterns) for a period with entries: that period's summary by project with a total, then
    //     hours by day (weekly) or by week (monthly), and its Problems;
    //   - each yearly note (years/): an Earned table and an Hours table, a row per project and a
    //     column per month (headers link to the monthly notes), and Problems.
    // On the desktop, missing periodic notes are created first. Weeks run Sunday to Saturday, the
    // same weeks Notebook Navigator names gggg[w]ww.
    // Each report sits between %% time:start %% and %% time:end %%; running it again replaces only
    // that block, and only when the numbers changed (the "Updated" line says when they last did). Summaries
    // only, except the timesheet notes, which hold entry-by-entry detail. Projects in 90 Archive are left out.
    //
    // A time entry is a bullet one level under a task or event: `- 9:01am - 9:40am`, optionally
    // `: note`. 🆓 at the start of the note doesn't bill it (`- 5:00pm - 5:30pm: 🆓 not billing`);
    // 🆓 as a word of its own on the task or event line, or a line it's nested under, doesn't bill
    // any entry under it, and an entry marked both ways is 🆓 and listed under Problems (OBS-24).
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
    // The project an entry belongs to, first match wins. Only the links that end a line count
    // (OBS-90): a link in the text is part of the title, even a link to a project. Looking at the
    // task line and then the lines it's nested under:
    //   1. a ⭕ link to a project note (`[[Orchard Lane Web 2026|⭕]]`);
    //   2. the note link's note (🗒️, or 🔗 before OBS-87: a task's note, an event's log): its nearest
    //      project folder note (Folder/Folder.md tagged #project), or its `area`. An event whose
    //      title is wrapped in a link, the way lines were written before OBS-57, has that note.
    // Otherwise it's Unassigned. A project folder note inside another project's folder is a
    // sub-project: its hours also count toward the parent. Entries of archived projects (in
    // 90 Archive) are left out of every report.
    // An area (a folder note tagged exactly #area) counts like a project in all three, as a row of
    // its own, but is never a parent and never has one: the projects inside it don't add up into it.
    // Its note gets a report the way a project's does, and with no `rate` or `rate_type` of its own
    // its time is non-billable (OBS-51).
    //
    // Money comes from project note properties: `rate` (hourly; a sub-project without one uses its
    // parent's), `rate_type` (anything but hourly means no Earned), and a cap from `max_hours`, or
    // `contract_max` ÷ rate. Earned is billable rounded hours × rate.
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
    // `node --test "00 Meta/02 Scripts/tests/*.test.mjs"`.
    static START = "%% time:start %%";
    static END = "%% time:end %%";
    static HEADING = "## Time tracking";
    static ARCHIVE = "90 Archive/";
    static QUOTE_MAX = 80;
    static CREATED_KEY = "time-report-created-notes";
    // A project's timesheet note sits beside it, named after it: "Kestrel Outfitters 2026 timesheet"
    static SHEET = " timesheet";
    // An invoice's status as the mark in its links, in the timesheets and on the project's note (OBS-117)
    static INVOICE_MARK = { draft: "✏️", sent: "🕒", paid: "✅", canceled: "❌" };
    static ROUND_TO = 15;
    static LONG_MINUTES = 12 * 60;

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
    // 🗒️ (or 🔗, before OBS-87), ⭕, 🗃️ and 🚩 links, which say nothing about what a line is
    static SYMBOL_LINK = /\[\[[^\]|]*\|\s*(?:🗒|🔗|⭕|🗃|🚩)[^\]]*\]\]/gu;
    // The alias of a line's link to its own note (a task's note, an event's log): 🗒️, or 🔗 from
    // before OBS-87, compared once U+FE0F and spaces are dropped
    static NOTE_ALIAS = /^(?:🗒|🔗)$/u;
    // One of the links that end a line (OBS-90), as TrailingLinks draws them: a due date's 🚩 M/D,
    // a note's 🗒️ (or 🔗), a project's ⭕ or an area's 🗃️, alone in its alias. A phone may add or
    // drop the U+FE0F.
    static TRAIL_LINK = /\[\[([^\]|]+)\|\s*(🚩️?\s*\d{1,2}\/\d{1,2}|🗒️?|🔗️?|⭕️?|🗃️?)\s*\]\]$/u;
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

    // Reads one daily note. Returns { entries, problems, events }; each carries `context`, the task
    // line and the lines it's nested under (nearest first), for working out its project later.
    // `events` are the timed event lines: { line, start, end (from the end-time line under it, or
    // null), endText, endNote, endFree (🆓 after the end line's colon), lineFree (🆓 on the event
    // line), free (ℹ️), ranges (time entries under it), minutes, text }. Once an event has ended,
    // build() counts a busy one with an end line as an entry (OBS-24).
    parseNote(text, date) {
        const lines = this.lines(text);
        const entries = [];
        const problems = [];
        const events = [];
        const { visible, hidden, starts, blocks, unclosed } = this.scan(lines);
        const problem = (i, kind, message, context = []) =>
            problems.push({ date, line: i + 1, kind, message, text: (visible[i].trim() || lines[i].trim()), context });
        const inBlock = new Array(lines.length).fill(false);
        for (const b of blocks) for (let j = b.start; j <= b.end; j++) inBlock[j] = true;
        for (const s of starts) {
            if (!blocks.some((b) => b.start === s)) problem(s, "markers", "has no matching `%% time:end %%`, so it's ignored; lines after it are still read");
        }
        for (const u of unclosed) problem(u.line, "unclosed", `opens a ${u.what} that never closes, so nothing after it is read`);

        const stack = [];        // open ancestors: { width, kind, body, line }
        const strayFlagged = new Set();   // lines with a 🆓 that isn't a word, said once each
        const stray = (c) => {
            if (strayFlagged.has(c.line)) return;
            strayFlagged.add(c.line);
            problem(c.line, "free", "has a 🆓 that isn't on its own, so it doesn't count; put a space before it", [{ body: c.body, line: c.line + 1 }]);
        };
        let oldEvent = null;     // an old-style meeting line still collecting bullets at its own level
        const timedKinds = ["entry", "open", "rangeish"];

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
                node.event = {
                    date, line: i + 1, start: this.minutes(head[1]), startText: head[1], end: null, endText: null, endBare: false,
                    endNote: "", endFree: false, endStray: false, lineFree: mark.free, lineStray: mark.stray,
                    free: this.freeEvent(node.body), ranges: false, minutes: 0, text: raw.trim().replace(/\t+/g, " "),
                    context: [node, ...ancestors.filter((a) => !(a.kind === "text" && a.width > 0))].map((c) => ({ body: c.body, line: c.line + 1 })),
                };
                if (node.event.start !== null) events.push(node.event);
            }
            // Entries directly under the event are its time; a sub-task's entries are the sub-task's
            const under = ancestors.find((a) => a.event)?.event;
            if (under && timed) {
                if (ancestors[0].event) under.ranges = true;
            } else if (under && ancestors[0].event && node.kind === "item" && !node.box) {
                const end = node.body.match(TimeReport.END_LINE);
                if (end && this.minutes(end[1]) === null) {
                    problem(i, "format", "isn't a real time, so it isn't the event's end", [...ancestors.filter((a) => !(a.kind === "text" && a.width > 0))].map((c) => ({ body: c.body, line: c.line + 1 })));
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
                        under.endNoteWritten = note;
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
            // a list of notes. Only a task or event (or no parent at all, flagged below) can hold time.
            const plainParent = context.length > 0 && context[0].kind === "item" && !context[0].box;

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
                        context.map((c) => ({ body: c.body, line: c.line + 1 })));
                }
                continue;
            }
            if (plainParent) {
                // Under a task or event further up, it was probably meant as time; say so
                if (context.some((c) => c.box || c.kind === "event")) {
                    problem(i, "plain", "is under a plain bullet, not directly under a task or event, so it isn't counted",
                        context.map((c) => ({ body: c.body, line: c.line + 1 })));
                }
                continue;
            }

            const anchored = context.length > 0 && (context[0].box || context[0].kind === "event");
            const ctx = context.map((c) => ({ body: c.body, line: c.line + 1 }));

            if (node.kind === "rangeish") {
                problem(i, "format", "doesn't match `h:mmam - h:mmpm`, so it isn't counted", ctx);
                continue;
            }
            if (node.kind === "open") {
                problem(i, "open", "clock still running (no end time), so it isn't counted", ctx);
                continue;
            }

            const [, startText, endText, noteRaw] = node.entry;
            const start = this.minutes(startText);
            let end = this.minutes(endText);
            if (start === null || end === null) {
                problem(i, "format", "isn't a real time, so it isn't counted", ctx);
                continue;
            }
            let crossesMidnight = false;
            if (end < start) {
                if (/pm$/i.test(startText) && /am$/i.test(endText)) {
                    end += 1440;
                    crossesMidnight = true;
                } else {
                    problem(i, "order", "ends before it starts, so it isn't counted", ctx);
                    continue;
                }
            }
            if (end === start) {
                problem(i, "zero", "starts and ends at the same time", ctx);
                continue;
            }

            const note = (noteRaw ?? "").trim();
            const own = /^🆓/u.test(note);
            // 🆓 on the task or event line, or a line above it, frees every entry under it
            const marks = context.map((c) => (c.freeLine ??= this.freeLine(c.body)));
            const above = marks.some((m) => m.free);
            const free = own || above;
            const entry = {
                date, line: i + 1, start, end, minutes: end - start, crossesMidnight, free,
                note: free ? note.replace(/^🆓\uFE0F?\s*/u, "") : note,
                task: anchored ? this.taskText(context[0].body) : "",
                // As written, 🆓 and all, for the timesheet's 🆓 time
                taskWritten: anchored ? this.taskText(context[0].body, { keepFree: true }) : "",
                noteWritten: note,
                context: ctx,
            };
            entries.push(entry);

            if (!anchored) problem(i, "anchor", "isn't under a task or event", ctx);
            if (!own && note.includes("🆓")) problem(i, "free", "has 🆓 after other text, so it doesn't count; put 🆓 right after the colon", ctx);
            if (own && above) problem(i, "free", "has 🆓 here and on the line above; one is enough", ctx);
            if (!above) context.filter((c, k) => marks[k].stray).forEach(stray);
            if (entry.minutes >= TimeReport.LONG_MINUTES) problem(i, "long", `is ${this.hours(entry.minutes)} hours long`, ctx);
        }
        // What each timed event is worth. A free one (ℹ️) is never counted and never a Problem.
        // Entries under a busy one are its time, so its end line is ignored, and a 🆓 left there is
        // said so. Otherwise its span runs from its start to its end line, past midnight when it
        // reads pm → am; a busy event with no usable end is a Problem like a running clock, except
        // that a zero-length one (a reminder) is quietly nothing.
        // Each carries the event's start, so build() can hold it back until the event has begun
        const eventProblem = (ev, kind, message) => problems.push({ date, line: ev.line, kind, message, text: ev.text, context: ev.context, start: ev.start });
        for (const ev of events) {
            if (ev.free) continue;
            if (ev.lineStray) stray({ line: ev.line - 1, body: ev.context[0].body });
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
            if (ev.lineFree && ev.endFree) eventProblem(ev, "free", "has 🆓 on the event line and on its end line; one is enough");
            if (ev.endStray) eventProblem(ev, "free", "has 🆓 after other text on its end line, so it doesn't count; put 🆓 right after the colon");
            if (ev.minutes >= TimeReport.LONG_MINUTES) eventProblem(ev, "long", `is ${this.hours(ev.minutes)} hours long`);
        }
        return { entries, problems, events };
    }

    // An ended busy event with its end line, as the entry the report counts: its span, the end
    // line's note, 🆓 from the end line or the event line, and the title as its task
    eventEntry(ev) {
        return {
            date: ev.date, line: ev.line, path: ev.path, project: ev.project, start: ev.start, end: ev.end, minutes: ev.minutes,
            crossesMidnight: !!ev.crossesMidnight, free: ev.endFree || ev.lineFree, note: ev.endNote,
            task: this.taskText(ev.context[0].body), context: ev.context, startText: ev.startText, endText: ev.endText, text: ev.text,
            taskWritten: this.taskText(ev.context[0].body, { keepFree: true }), noteWritten: ev.endNoteWritten ?? ev.endNote,
        };
    }

    // A task or event line as plain text for a table: no checkbox, event time, symbol links or
    // date breadcrumbs; other links show their alias. With `keepFree`, a 🆓 on the line stays, for the
    // timesheet's 🆓 time, where it says why the time isn't billed (OBS-5).
    taskText(body, { keepFree = false } = {}) {
        const text = body
            .replace(/^\[.\]\s*/, "")
            .replace(/^\[\[\d{4}-\d{2}-\d{2}\|[^\]]*\]\]\s*/, "")
            .replace(TimeReport.OLD_EVENT, "")
            .replace(/^all day\b/i, "")
            .replace(TimeReport.SYMBOL_LINK, "")
            .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
            .replace(/\[\[([^\]#]*)(?:#[^\]]*)?\]\]/g, "$1");
        return (keepFree ? text : text.replace(TimeReport.FREE_WORDS, "").replace(TimeReport.EMPTY_BRACKETS, ""))
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
    // isProject(path), isArea(path), area(path) → "[[link]]" | null, exists(path) }. makeIndex builds
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

    // The mark on a report's link to a project or area: ⭕, or 🗃️ for an area
    // A project or area's link in a report: [[Name]], or [[path/Name|Name]] when another note has its
    // name. An area keeps its 🗃️, so it reads apart from the projects around it (OBS-117).
    reportLink(target, path, index) {
        const name = this.basename(path);
        if (this.isAreaOnly(path, index)) return `[[${target}|🗃️ ${name}]]`;
        return target === name ? `[[${name}]]` : `[[${target}|${name}]]`;
    }

    linkMark(path, index) {
        return this.isAreaOnly(path, index) ? "🗃️" : "⭕";
    }

    dirname(path) {
        return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    }

    basename(path) {
        return path.split("/").pop().replace(/\.md$/, "");
    }

    // What a note's `area` points at, when `want` says yes to it
    areaProject(path, index, want = (p) => index.isProject(p)) {
        const area = index.area(path)?.match(/\[\[([^\]|#]+)/)?.[1]?.trim();
        const dest = area ? index.linkDest(area, path) : null;
        return dest && dest !== path && want(dest) ? dest : null;
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
    // folder note above it, else whatever its `area` points at if that's one
    projectOfNote(path, index) {
        const counts = (p) => this.counts(p, index);
        if (counts(path)) return path;
        return this.nearestProjectFolder(this.dirname(path), path, index, counts) ?? this.areaProject(path, index, counts);
    }

    // The project a project sits inside: the nearest project folder note above its own folder, else
    // its `area` if that's a project. Never an area, and an area has none: time doesn't roll up into
    // an area, and an area filed inside a project isn't a sub-project billed at its rate.
    parentProject(path, index) {
        if (this.isAreaOnly(path, index)) return null;
        let dir = this.dirname(path);
        if (this.basename(dir) === this.basename(path)) dir = this.dirname(dir);
        return this.nearestProjectFolder(dir, path, index) ?? this.areaProject(path, index);
    }

    // What a line's links say about where its time goes (OBS-90): { marks: its ⭕ and 🗃️ links,
    // notes: its 🗒️ (or 🔗) links, title: the link an old event's title is wrapped in, or null },
    // each { target, alias }. Only the run of links that ends the line counts, stepping over the
    // free mark and 🆓 among them, and a block ID after them; a link in the text is part of the title.
    lineLinks(body) {
        const marks = [], notes = [];
        let rest = body.trimEnd().replace(TimeReport.BLOCK_ID, "").trimEnd();
        for (;;) {
            const link = rest.match(TimeReport.TRAIL_LINK);
            if (link) {
                const target = link[1].split(/[#^]/)[0].trim();
                const symbol = link[2].replace(/[️\s]/g, "");
                if (/^(?:⭕|🗃)$/u.test(symbol)) marks.unshift({ target, alias: link[2] });
                else if (this.isNoteAlias(symbol)) notes.unshift({ target, alias: link[2] });
                rest = rest.slice(0, link.index).trimEnd();
                continue;
            }
            const mark = rest.match(TimeReport.TRAIL_MARK);
            if (mark && mark.index > 0) { rest = rest.slice(0, mark.index).trimEnd(); continue; }
            break;
        }
        const wrapped = notes.length ? null : rest.trim().match(TimeReport.WRAPPED_TITLE);
        const title = wrapped ? { target: wrapped[1].split(/[#^]/)[0].trim(), alias: "" } : null;
        return { marks: marks.filter((l) => l.target), notes: notes.filter((l) => l.target), title: title?.target ? title : null };
    }

    // The project for an entry's context lines, or null
    // With `live`, archived projects are passed over and the search goes on.
    resolve(context, fromPath, index, live = false) {
        const lines = context.map((c) => this.lineLinks(c.body));
        const dest = (l) => (TimeReport.DATE_LINK.test(l.target) ? null : index.linkDest(l.target, fromPath));
        const ok = (p) => p && !(live && this.isArchived(p));
        // A ⭕ (or 🗃️) says where the line's time goes, on the line or on one it's nested under
        for (const { marks } of lines) {
            for (const l of marks) {
                const d = dest(l);
                if (d && this.counts(d, index) && ok(d)) return d;
            }
        }
        // Then the line's own note: where it's filed
        for (const { notes, title } of lines) {
            for (const l of title ? [...notes, title] : notes) {
                const d = dest(l);
                const project = d ? this.projectOfNote(d, index) : null;
                if (ok(project)) return project;
            }
        }
        return null;
    }

    // Whether a link's alias marks a line's own note (NOTE_ALIAS)
    isNoteAlias(alias) {
        return TimeReport.NOTE_ALIAS.test(alias.replace(/[️\s]/g, ""));
    }

    // A task line that ends in a ⭕ for a project and also a 🗒️ task note filed under a different
    // live project, or an event line whose 🗒️ log is (OBS-57). The line's ⭕ decides where its time
    // counts (see resolve), so the note's project never sees that time: a note moved by hand, say,
    // until OBS-93 updates its lines. Checks the first context line with a live ⭕, the one resolve
    // uses. { lineProject, note, noteProject, event } or null.
    conflict(context, fromPath, index) {
        for (const c of context) {
            const { marks, notes } = this.lineLinks(c.body);
            const withDest = (l) => ({ ...l, dest: TimeReport.DATE_LINK.test(l.target) ? null : index.linkDest(l.target, fromPath) });
            const direct = marks.map(withDest).find((l) => l.dest && this.counts(l.dest, index) && !this.isArchived(l.dest));
            if (!direct) continue;
            for (const l of notes.map(withDest)) {
                if (!l.dest) continue;
                const noteProject = this.projectOfNote(l.dest, index);
                if (noteProject && noteProject !== direct.dest && !this.isArchived(noteProject)) {
                    return { lineProject: direct.dest, note: l.dest, noteProject, event: /^\[<\]/.test(c.body) };
                }
            }
            return null;
        }
        return null;
    }

    // Same answers as appIndex, from [{ path, tags, area, props }] (tags as Obsidian collects them,
    // frontmatter and inline; props is the frontmatter, for rate and caps)
    makeIndex(notes) {
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
            area: (path) => {
                const value = [].concat(byPath.get(path)?.area ?? [])[0];
                return typeof value === "string" ? value : null;
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
    build(notes, index, { now = null } = {}) {
        const entries = [];
        const archived = [];     // entries whose only project is archived: out of the report, but still checked for overlaps
        const events = [];       // every timed event line
        const problems = [];
        const day = (date) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 864e5;
        const ended = (e) => !now || day(e.date) * 1440 + e.end <= day(now.date) * 1440 + now.minutes;
        // The first live project wins; an entry that only resolves to archived projects is archived work
        const place = (context, path) => {
            const live = context.length ? this.resolve(context, path, index, true) : null;
            if (live) return { project: live, archived: false };
            return { project: null, archived: context.length > 0 && this.isArchived(this.resolve(context, path, index)) };
        };
        for (const n of notes) {
            const parsed = this.parseNote(n.text, n.date);
            for (const e of parsed.entries) {
                e.path = n.path;
                const where = place(e.context, n.path);
                e.project = where.project;
                (where.archived ? archived : entries).push(e);
            }
            for (const p of parsed.problems) {
                // The sync writes events months ahead: what's wrong with one waits until it has started
                if (p.start !== undefined && now && day(p.date) * 1440 + p.start > day(now.date) * 1440 + now.minutes) continue;
                p.path = n.path;
                const where = place(p.context, n.path);
                p.projects = [where.project];
                if (!where.archived) problems.push(p);
            }
            // A busy event with an end line and no entries of its own counts once it has ended: its
            // span is an entry like any other, on the project its line resolves to, else Unassigned
            for (const ev of parsed.events) {
                ev.path = n.path;
                const where = place(ev.context, n.path);
                ev.project = where.project;
                ev.archived = where.archived;
                events.push(ev);
                if (ev.end !== null && !ev.free && !ev.ranges && ended(ev)) (ev.archived ? archived : entries).push(this.eventEntry(ev));
            }
        }

        // Overlaps, across every project and across midnight; an event's span overlaps like an entry's
        const liveSet = new Set(entries);
        const timeline = [...entries, ...archived].map((e) => ({ e, from: day(e.date) * 1440 + e.start, to: day(e.date) * 1440 + e.end }))
            .sort((a, b) => a.from - b.from || a.to - b.to);
        let latest = null;
        for (const t of timeline) {
            if (latest && t.from < latest.to && (liveSet.has(t.e) || liveSet.has(latest.e))) {
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

        // Parent projects. A loop (A inside B inside A, through `area`) is cut where it closes.
        const parent = new Map();
        const projectProblems = [];
        const addChain = (p) => {
            const path = [];
            while (p && !parent.has(p)) {
                let up = this.parentProject(p, index);
                if (this.isArchived(up)) up = null;
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
        for (const e of entries) addChain(e.project);
        for (const p of problems) p.projects.forEach(addChain);

        // Time on a task line whose ⭕ project and 🗒️ task note disagree, or an event line whose ⭕
        // and log do: said on both project notes, once per note and pair of projects (OBS-34)
        const conflicts = new Map();
        for (const e of entries) {
            if (!e.project) continue;
            const c = this.conflict(e.context, e.path, index);
            if (!c || c.lineProject !== e.project) continue;
            const key = `${c.note}\n${c.lineProject}\n${c.noteProject}`;
            const had = conflicts.get(key)?.entries ?? [];
            conflicts.set(key, { ...c, count: had.length + 1, entries: [...had, e] });
        }
        for (const { lineProject, note, noteProject, event, count, entries: those } of conflicts.values()) {
            addChain(noteProject);
            projectProblems.push({ project: lineProject, conflict: { side: "line", note, other: noteProject, event, count, entries: those } });
            projectProblems.push({ project: noteProject, conflict: { side: "note", note, other: lineProject, event, count } });
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

        // Per project: `rate` and `rate_type`, each from the project or else its nearest parent that has
        // one (archived parents count here), the hourly rate that Earned uses, a Rate label and the cap
        const money = new Map();
        const set = (v) => v !== undefined && v !== null && String(v).trim() !== "";
        for (const p of parent.keys()) {
            let rateRaw, typeRaw, rateFrom = null;
            const seen = new Set();
            for (let up = p; up && !seen.has(up); up = this.parentProject(up, index)) {
                seen.add(up);
                const props = index.props?.(up) ?? {};
                if (rateRaw === undefined && set(this.prop(props, "rate"))) { rateRaw = this.prop(props, "rate"); rateFrom = up; }
                if (typeRaw === undefined && set(this.prop(props, "rate_type"))) typeRaw = this.prop(props, "rate_type");
                if (rateRaw !== undefined && typeRaw !== undefined) break;
            }
            const amount = rateRaw === undefined ? null : this.number(rateRaw);
            let type = typeRaw === undefined ? null : String(typeRaw).trim().toLowerCase();
            if (!type && amount !== null) type = "hourly";
            // An area is someone's own time unless it says otherwise: with neither `rate` nor
            // `rate_type` it's non-billable, and isn't asked for one (OBS-51)
            if (!type && amount === null && this.isAreaOnly(p, index)) type = "non-billable";
            const rate = type === "hourly" ? amount : null;
            if (rateRaw !== undefined && amount === null && rateFrom === p) {
                projectProblems.push({ project: p, message: `has a \`rate\` that isn't a positive number (${String(rateRaw).slice(0, 20)}), so it has no Earned` });
            } else if (type === "hourly" && amount === null && rateRaw === undefined) {
                projectProblems.push({ project: p, message: "is hourly but has no `rate`, so it has no Earned" });
            }
            const dollars = amount === null ? "" : this.money(Math.round(amount * 100)).replace(/\.00$/, "");
            const label = !type ? "" : type === "hourly" ? (dollars ? `${dollars}/hr` : "hourly")
                : type === "flat" ? (dollars ? `${dollars} flat` : "flat") : type;
            const props = index.props?.(p) ?? {};
            const maxHours = this.number(this.prop(props, "max_hours"));
            const contract = this.number(this.prop(props, "contract_max"));
            const cap = maxHours ?? (contract !== null && rate ? contract / rate : null);
            money.set(p, { rate, type, label, capMinutes: cap === null ? null : Math.round(cap * 60) });
        }

        // Entries that haven't ended yet aren't work yet: out of hours and Earned alike
        const counted = now ? entries.filter((e) => day(e.date) * 1440 + e.end <= day(now.date) * 1440 + now.minutes) : entries;

        // Billable or not, decided once here rather than in `totals`, which is also called without a
        // `money` map. `free` stays exactly what it always was: the 🆓 typed on the entry.
        for (const e of counted) e.billable = !e.free && !!e.project && money.get(e.project)?.type !== "non-billable";

        // A project with time on it and no `rate_type` anywhere up its chain bills by default, since
        // the alternative is invoicing nothing and never noticing. Say so, so it's set rather than assumed.
        const worked = new Set(counted.map((e) => e.project).filter(Boolean));
        for (const p of [...worked].sort()) {
            const m = money.get(p) ?? {};
            if (!m.type) projectProblems.push({ project: p, message: "has no `rate_type`, so its time counts as billable; set one (`hourly`, `flat`, `non-billable`)" });
            // An own `rate` under a non-billable parent earns nothing and now bills nothing either
            else if (m.type === "non-billable" && this.number(this.prop(index.props?.(p) ?? {}, "rate")) !== null) {
                projectProblems.push({ project: p, message: "has its own `rate` but inherits `non-billable`, so its time counts as 🆓; give it a `rate_type` of its own" });
            }
        }

        problems.sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line);
        return { entries: counted, problems, parent, projectProblems, money, events };
    }

    // Invoice notes (OBS-5): read them, keep what they billed on the model for the timesheets, and
    // list on the project's own note (never on weekly, monthly or yearly notes) an invoice whose billed
    // entries changed since it was made (a draft's too, which says to rebuild it, OBS-143), an entry on
    // two invoices, and a billed_through that isn't a date. `notes` are [{ path, props, text }]; `billing` is a Billing.
    attachBilling(model, notes, index, billing) {
        // In number order, then path, so the first invoice to bill an entry is always the same one,
        // whatever order the vault lists its files in
        const invoices = notes.map((n) => billing.readInvoice(n, this, index))
            .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }) || a.path.localeCompare(b.path));
        const ledger = billing.ledger(invoices);
        // Billed entries moved or retimed since, which look unbilled: the timesheets mark them ⚠️, as the
        // Invoice command holds them back
        const { held, byInvoice } = billing.holds(model, this, index, ledger);
        model.billing = { billing, invoices, ledger, index, held, byInvoice };
        for (const invoice of invoices) {
            if (invoice.status === "canceled" || !invoice.project || this.isArchived(invoice.path) || this.isArchived(invoice.project)) continue;
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
        for (const p of model.parent.keys()) {
            const b = billing.billedThrough(p, this, index);
            if (b.bad && b.from === p) {
                model.projectProblems.push({ project: p, only: "project", message: `has a \`billed_through\` that isn't a date (${b.bad.slice(0, 20)}), so it can't be invoiced until it's fixed` });
            }
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
        const mine = new Set(entries);
        const projectProblems = [];
        for (const p of model.projectProblems) {
            // An invoice's changes, and billing settings, are for the project's own note (OBS-5)
            if (p.only === "project") continue;
            if (p.conflict) {
                // Said once, by the project the time counts on, with the period's own entries
                const count = p.conflict.side === "line" ? p.conflict.entries.filter((e) => mine.has(e)).length : 0;
                if (count) projectProblems.push({ ...p, conflict: { ...p.conflict, count } });
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

    // Every week, month and year that has at least one entry: { week: [...], month: [...], year: [...] }
    periodsWithEntries(model) {
        const out = {};
        for (const unit of ["week", "month", "year"]) {
            out[unit] = [...new Set(model.entries.map((e) => this.periodOf(e.date, unit)))].sort();
        }
        return out;
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

    // The whole of a new timesheet note: an id, the timesheet tag and its project as `area`, then its report
    sheetNote(id, area, block) {
        return `---\nid: ${id}\ntags:\n  - timesheet\narea: ${JSON.stringify(area)}\n---\n\n${TimeReport.HEADING}\n\n${block}\n`;
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

    // Text quoted from notes can't open a comment in the report and hide its end marker, or run as Templater
    defuse(text) {
        return String(text ?? "").replace(/%%/g, "%\u200B%").replace(/<!--/g, "<\u200B!--").replace(/-->/g, "--\u200B>")
            .replace(/<%/g, "<\u200B%");   // Templater syntax, which a device could run when the note syncs in
    }

    // Totals in minutes, plus Earned in cents for entries whose project has an hourly rate.
    // Billable or not was decided in `build`; `money` is only needed for Earned.
    totals(entries, money = new Map()) {
        const t = { count: 0, exact: 0, billable: 0, free: 0, cents: 0, rated: false };
        const minutesByRate = new Map();    // "date cents" (a day and an hourly rate in cents) → billable minutes
        for (const e of entries) {
            t.count++;
            t.exact += e.minutes;
            const minutes = this.rounded(e.minutes);
            t[e.billable ? "billable" : "free"] += minutes;
            const rate = money.get(e.project)?.rate;
            if (rate && e.billable) {
                t.rated = true;
                const key = `${e.date} ${Math.round(rate * 100)}`;
                minutesByRate.set(key, (minutesByRate.get(key) ?? 0) + minutes);
            }
        }
        // Hours × rate per day and rate, as an invoice bills them (a row per date and rate, OBS-5): at a
        // whole-dollar rate every quarter hour is whole cents, and Earned, a timesheet and its invoices agree
        for (const [key, minutes] of minutesByRate) t.cents += Math.round(minutes * Number(key.split(" ")[1]) / 60);
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

    // Earned for a row, or "" when the row's own project isn't hourly or nothing had a rate
    earnedFor(t, project, model) {
        const m = project ? model.money.get(project) ?? {} : {};
        return t.rated && !(m.type && m.type !== "hourly") ? t.cents : null;
    }

    // Summary table lines for `entries`: a row per project (its own entries only), Unassigned, and All
    summaryTable(model, entries, link, { total = false } = {}) {
        if (!entries.length) return ["No time entries."];
        const b = (bold) => (s) => (bold && s !== "" ? `**${s}**` : s);
        const row = (name, t, project, bold = false) => {
            const m = project ? model.money.get(project) ?? {} : {};
            const f = b(bold);
            return `| ${f(this.cell(name))} | ${f(t.count)} | ${f(this.hoursCell(t.billable))} | ${f(this.hoursCell(t.free))} | ${f(this.hoursCell(t.billable + t.free))} | ${f(this.hoursCell(t.exact))} | `
                + `${m.capMinutes ? this.hours(m.capMinutes) : ""} | ${m.label ?? ""} | ${t.rated && !(m.type && m.type !== "hourly") ? f(this.moneyCell(t.cents)) : ""} |`;
        };
        const projects = this.ownProjects(entries);
        const rows = projects.map((p) => row(link(p), this.totals(entries.filter((e) => e.project === p), model.money), p));

        const out = [];
        out.push("| Project | Entries | Billable | 🆓 | Total | Exact | Max Hrs | Rate | Earned |",
            "| ------- | ------: | -------: | -: | ----: | ----: | ------: | ---: | -----: |", ...rows);
        const unassigned = entries.filter((e) => !e.project);
        if (unassigned.length) out.push(row("Unassigned", this.totals(unassigned, model.money), null));
        if (total || projects.length + (unassigned.length ? 1 : 0) > 1) out.push(row("All", this.totals(entries, model.money), null, true));
        return out;
    }

    // A project note. The summary: one row without a Project column when nothing was logged to a
    // sub-project; otherwise a row per project (this one's own time, then each sub-project's), each with
    // its own Max Hrs, Rate and Earned, and a Total row for the whole project carrying this project's
    // cap. Then a week-by-week table of only the time logged to this project directly: its total first,
    // then each week newest first, linking to the weekly note.
    projectTables(model, entries, scope, link) {
        if (!entries.length) return ["No time entries."];
        const own = entries.filter((e) => e.project === scope.path);
        const subs = this.ownProjects(entries).filter((p) => p !== scope.path);
        const m = model.money.get(scope.path) ?? {};
        const cap = (x) => (x.capMinutes ? this.hours(x.capMinutes) : "");
        const earned = (x, project) => { const c = this.earnedFor(x, project, model); return c === null ? "" : this.moneyCell(c); };
        const nums = (x) => [x.count, this.hoursCell(x.billable), this.hoursCell(x.free), this.hoursCell(x.billable + x.free), this.hoursCell(x.exact)];
        const out = [];

        if (!subs.length) {
            const t = this.totals(entries, model.money);
            out.push("| Entries | Billable | 🆓 | Total | Exact | Max Hrs | Rate | Earned |",
                "| ------: | -------: | -: | ----: | ----: | ------: | ---: | -----: |",
                `| ${[...nums(t), cap(m), m.label ?? "", earned(t, scope.path)].join(" | ")} |`);
        } else {
            out.push("| Project | Entries | Billable | 🆓 | Total | Exact | Max Hrs | Rate | Earned |",
                "| ------- | ------: | -------: | -: | ----: | ----: | ------: | ---: | -----: |");
            const row = (p, list) => {
                const x = this.totals(list, model.money), pm = model.money.get(p) ?? {};
                // The project's cap goes on the Total row, since it covers its sub-projects too
                return `| ${[this.cell(link(p)), ...nums(x), p === scope.path ? "" : cap(pm), pm.label ?? "", earned(x, p)].join(" | ")} |`;
            };
            if (own.length) out.push(row(scope.path, own));
            for (const p of subs) out.push(row(p, entries.filter((e) => e.project === p)));
            const t = this.totals(entries, model.money);
            const b = (v) => (v === "" ? "" : `**${v}**`);
            out.push(`| ${["Total", ...nums(t), cap(m), "", earned(t, null)].map(b).join(" | ")} |`);
        }
        out.push("");

        if (!own.length) {
            out.push("No time logged to this project directly; see its sub-projects' notes for their weeks.");
            return out;
        }
        out.push("| Week | Entries | Billable | 🆓 | Total | Exact | Earned |", "| ---- | ------: | -------: | -: | ----: | ----: | -----: |");
        const line = (name, x, bold) => {
            const cells = [name, ...nums(x), earned(x, scope.path)];
            return `| ${(bold ? cells.map((v) => (v === "" ? "" : `**${v}**`)) : cells).join(" | ")} |`;
        };
        out.push(line("Total", this.totals(own, model.money), true));
        const md = (date) => `${+date.slice(5, 7)}/${+date.slice(8, 10)}`;
        for (const key of [...new Set(own.map((e) => this.weekKey(e.date)))].sort().reverse()) {
            const [from, to] = this.weekRange(key);
            const target = scope.linkTarget ? scope.linkTarget("week", key) : key;
            out.push(line(`[[${target}\\|${md(from)}-${md(to)}]]`, this.totals(own.filter((e) => this.weekKey(e.date) === key), model.money), false));
        }
        return out;
    }

    // A yearly note: a row per project (its own entries only), then Unassigned and All; a
    // column per month, headed with a link to that monthly note, then the year. `measure` is
    // "earned" (dollars) or "hours" (billable + 🆓).
    yearTable(model, entries, scope, link, measure) {
        if (!entries.length) return ["No time entries."];
        const months = TimeReport.SHORT_MONTHS.map((name, i) => ({ name, key: `${scope.key}-${String(i + 1).padStart(2, "0")}` }));
        const head = months.map(({ name, key }) => `[[${scope.linkTarget ? scope.linkTarget("month", key) : key}\\|${name}]]`);
        const out = [`| Project | ${head.join(" | ")} | ${scope.key} |`, `| ------- | ${months.map(() => "--:").join(" | ")} | --: |`];
        const value = (list, project) => {
            if (!list.length) return "";
            const t = this.totals(list, model.money);
            if (measure === "hours") return this.hoursCell(t.billable + t.free);
            const c = this.earnedFor(t, project, model);
            return c ? this.money(c).replace(/\.00$/, "") : "";
        };
        const row = (name, list, project, bold = false) => {
            const b = (v) => (bold && v ? `**${v}**` : v);
            const cells = months.map(({ key }) => b(value(list.filter((e) => e.date.startsWith(key + "-")), project)));
            return `| ${bold ? `**${name}**` : name} | ${cells.join(" | ")} | ${b(value(list, project))} |`;
        };
        for (const project of this.ownProjects(entries)) {
            out.push(row(this.cell(link(project)), entries.filter((e) => e.project === project), project));
        }
        const unassigned = entries.filter((e) => !e.project);
        if (unassigned.length) out.push(row("Unassigned", unassigned, null));
        out.push(row("All", entries, null, true));
        return out;
    }

    // Hours by column: a row per project (its own entries), Unassigned and All; `columns` are
    // [{ head, match(entry) }], followed by a total column headed `totalHead`. Cells are hours
    // (billable + 🆓, rounded per entry), blank when none.
    hoursGrid(model, entries, columns, totalHead, link) {
        const out = [`| Project | ${columns.map((c) => c.head).join(" | ")} | ${totalHead} |`, `| ------- | ${columns.map(() => "--:").join(" | ")} | --: |`];
        const hours = (list) => {
            if (!list.length) return "";
            const t = this.totals(list, model.money);
            return this.hoursCell(t.billable + t.free);
        };
        const row = (name, list, bold = false) => {
            const b = (v) => (bold && v ? `**${v}**` : v);
            return `| ${bold ? `**${name}**` : name} | ${columns.map((c) => b(hours(list.filter(c.match)))).join(" | ")} | ${b(hours(list))} |`;
        };
        for (const project of this.ownProjects(entries)) out.push(row(this.cell(link(project)), entries.filter((e) => e.project === project)));
        const unassigned = entries.filter((e) => !e.project);
        if (unassigned.length) out.push(row("Unassigned", unassigned));
        out.push(row("All", entries, true));
        return out;
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
            out.push(`- [[${p.date}|${this.shortDate(p.date)}]] line ${p.line}: \`${quote(p.text)}\` ${p.message}`);
        }
        for (const p of projectProblems) {
            if (p.invoice || p.twice) {
                out.push(this.invoiceProblem(p, link));
                continue;
            }
            if (p.conflict) {
                const { side, note, other, event, count } = p.conflict;
                const n = `${count} ${count === 1 ? "entry" : "entries"}`;
                const noteLink = `[[${note.replace(/\.md$/, "")}|${this.basename(note)}]]`;
                const [line, kind, it] = event ? ["event line", "log", "log"] : ["task line", "task note", "note"];
                out.push(side === "line"
                    ? `- ${link(p.project)} has time (${n}) from ${event ? "an" : "a"} ${line} whose ${kind} ${noteLink} is filed under ${link(other)}; move the ${it} here, or change the line's project link`
                    : `- ${link(p.project)} has a ${kind}, ${noteLink}, whose ${line} links ${link(other)}, so its time (${n}) counts there; move the ${it}, or change the line's project link`);
                continue;
            }
            out.push(p.message ? `- ${link(p.project)} ${p.message}`
                : `- ${link(p.project)} and ${link(p.parent)} are each inside the other (check their folders and \`area\`); ${link(p.project)} is counted as top-level`);
        }
        const noProject = entries.filter((e) => !e.project).length;
        if (noProject) out.push(`- ${noProject} ${noProject === 1 ? "entry has" : "entries have"} no project (see Unassigned)`);
        return out.length ? out : ["None."];
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
        const { invoice, change: c } = p;
        // A sent invoice's date is the day it was sent
        const on = invoice.status === "paid" ? invoice.paid : invoice.status === "sent" ? invoice.invoiceDate : null;
        const now = c.kind === "times" ? `now ${this.formatTime(c.entry.start)} - ${this.formatTime(c.entry.end)}`
            : c.kind === "moved" ? `now on [[${c.entry.date}|${this.shortDate(c.entry.date)}]]`
            : c.kind === "free" ? "now 🆓"
            : c.kind === "unassigned" ? "now on no project"
            : c.kind === "project" ? `now on ${link(c.entry.project)}`
            : c.kind === "overlap" ? `and ${c.entry.date === c.row.date ? "" : `[[${c.entry.date}|${this.shortDate(c.entry.date)}]] `}${this.formatTime(c.entry.start)} - ${this.formatTime(c.entry.end)} overlaps it`
            : "gone from its daily note";
        const fix = invoice.status === "draft" && c.kind !== "overlap" ? "; rebuild it" : "";
        return `- [[${invoice.name}]] (${invoice.status}${on ? ` ${md(on)}` : ""}): ${when(c.row)} was billed, ${now}${fix}`;
    }

    // Text for a table cell: one line, every | escaped, and a #tag or an HTML tag quoted from a task
    // or note shown as text, so it can't tag the note the table is in (a #project would make it a
    // project) or draw anything. Billing.tableText does the same for invoices.
    tableText(text) {
        return String(text ?? "").replace(/\s+/g, " ").trim().replace(/(?<!\\)\|/g, "\\|")
            .replace(/(^|\s)#(?=[^\s#])/g, "$1\\#").replace(/</g, "&lt;");
    }

    // A project note's timesheets (OBS-5): every entry of the project, and of the projects below it
    // when its include_subprojects checkbox is on, split into Billable time and 🆓 time. Each heading
    // carries its table's total (`### Billable time: 20.50 hrs`); the table has a bold row per day,
    // newest first, adding up the day's hours, then the day's entries in time order. 🆓 time shows the
    // 🆓 as written (on the task line, or at the start of the note), so each row says why it isn't billed.
    // Then Problems, when there's anything to say: its entries' (see sheetEntryProblems), then its
    // invoices' (see sheetProblems). Each part ends with a blank line.
    timesheetLines(model, scope, link) {
        const b = model.billing;
        const on = b ? b.billing.scope(scope.path, model, this, b.index) : new Set([scope.path]);
        const entries = model.entries.filter((e) => on.has(e.project));
        const project = new Set(entries.map((e) => e.project)).size > 1;
        const billable = entries.filter((e) => e.billable), free = entries.filter((e) => !e.billable);
        const total = (list) => `${this.hours(list.reduce((m, e) => m + this.rounded(e.minutes), 0))} hrs`;
        const own = this.sheetEntryProblems(model, on, scope.path, entries, link);
        const out = [];
        if (billable.length) out.push(`### Billable time: ${total(billable)}`, "", ...this.sheet(model, billable, { project, link, flagged: own.flagged }), "");
        if (free.length) out.push(`### 🆓 time: ${total(free)}`, "", ...this.sheet(model, free, { project, link, written: true, flagged: own.flagged }), "");
        if (!entries.length) out.push("No time entries.", "");
        const problems = [...own.lines, ...this.sheetProblems(model, on, entries, link)];
        if (problems.length) out.push("### Problems", "", ...problems, "");
        return out;
    }

    // A timesheet's own Problems (OBS-132): the lines its project's note has about the projects the
    // timesheet covers (overlaps, 🆓 twice, entries of 12 hours or more, a ⭕ and 🗒️ that disagree, a
    // project's settings), but not its invoices', which sheetProblems says. { lines, flagged }: flagged
    // holds every entry a line is about, for its row's ⚠️: the entry on the line, both sides of an
    // overlap, the entries under a task or event line a Problem is on (a stray 🆓 there, say), and a
    // ⭕ and 🗒️ disagreement's entries. Running clocks and malformed lines aren't counted, so they
    // have no row; only their line says so.
    sheetEntryProblems(model, on, root, entries, link) {
        const problems = model.problems.filter((p) => p.projects.some((x) => on.has(x)));
        const projectProblems = model.projectProblems.filter((p) => !p.invoice && !p.twice && (on.has(p.project) || (p.parent && p.parent === root)));
        const at = (path, line) => `${path}\n${line}`;
        const named = new Set(problems.flatMap((p) => [at(p.path, p.line), ...(p.other ? [at(p.other.path, p.other.line)] : [])]));
        const conflicted = new Set(projectProblems.flatMap((p) => (p.conflict?.side === "line" ? p.conflict.entries : [])));
        const about = (e) => named.has(at(e.path, e.line)) || (e.context ?? []).some((c) => named.has(at(e.path, c.line))) || conflicted.has(e);
        return {
            lines: problems.length || projectProblems.length ? this.problemLines(model, problems, projectProblems, entries, link) : [],
            flagged: new Set(entries.filter(about)),
        };
    }

    // A timesheet's Problems (OBS-143), so every ⚠️ in it says why: what changed since an invoice billed
    // time in it, and an entry on two invoices. The lines are the project note's, from the same changes
    // (Billing.holds). An entry that's ⚠️ for no change of its own, such as one that overlaps a billed
    // row whose entry is still there, gets a line of its own. Empty when there's nothing to say.
    sheetProblems(model, on, entries, link) {
        const b = model.billing;
        if (!b) return [];
        const mine = (p) => !!p && on.has(p);
        const out = [], explained = new Set();
        for (const invoice of b.invoices) {
            if (invoice.status === "canceled" || this.isArchived(invoice.path) || (invoice.project && this.isArchived(invoice.project))) continue;
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

    // How a timesheet's entries stand with the invoices: (entry) → Billing.standing, with a billed entry
    // that moved or was retimed since (`held`) as changed. Only an hourly project's entries are invoiced.
    sheetStanding(model) {
        const b = model.billing;
        const through = new Map();
        return (e) => {
            if (!b || this.hourlyCents(model, e) === null) return { kind: "open" };
            if (!through.has(e.project)) through.set(e.project, b.billing.billedThrough(e.project, this, b.index).date);
            const s = b.billing.standing(e, b.ledger, through.get(e.project));
            const h = s.kind === "open" && b.held?.get(e);
            return h ? { kind: "changed", ...h } : s;
        };
    }

    // Whether an entry is ⚠️: changed since it was billed, or billed and now 🆓
    warned(e, s) {
        return s.kind === "changed" || (s.kind === "billed" && !e.billable);
    }

    // One timesheet table. Where anything in it bills by the hour, it starts with an unnamed column for
    // the status of the invoice that billed the entry (✏️ draft, 🕒 sent, ✅ paid, ⚠️ changed since it
    // was billed) and ends with that invoice, or `through 9/2` where billed_through covers it; an entry
    // with neither isn't invoiced yet (OBS-117). 🆓 time has the same columns: a 🆓 entry on an invoice
    // was billed before it was made 🆓, so it's ⚠️ (until OBS-110 puts 🆓 time on invoices at no charge).
    // An entry in `flagged` (one a Problem names, OBS-132) is ⚠️ too, and a table that bills nothing
    // gets the first column for it. It's about time, so it has no amounts.
    sheet(model, entries, { project, link, written = false, flagged = new Set() }) {
        const billing = entries.some((e) => this.hourlyCents(model, e) !== null);
        const marks = billing || entries.some((e) => flagged.has(e));
        const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
        const standing = this.sheetStanding(model);
        const cells = (e) => {
            const s = billing ? standing(e) : { kind: "open" };
            const warn = (mark) => (flagged.has(e) ? "⚠️" : mark);
            if (s.kind === "before") return [warn(""), e.billable ? `through ${md(s.through)}` : ""];
            if (s.kind === "open") return [warn(""), ""];
            return [warn(this.warned(e, s) ? "⚠️" : this.invoiceMark(s.invoice)), `[[${s.invoice.name}]]`];
        };
        const head = [...(marks ? [""] : []), "Date", "Time", ...(project ? ["Project"] : []), "Hours", "Task", "Notes", ...(billing ? ["Invoice"] : [])];
        const row = (c) => `| ${c.join(" | ")} |`;
        const bold = (v) => (v === "" ? "" : `**${v}**`);
        const sum = (label, minutes) => row([...(marks ? [""] : []), bold(label), "", ...(project ? [""] : []), bold(this.hours(minutes)), "", "", ...(billing ? [""] : [])]);
        const days = [...new Set(entries.map((e) => e.date))].sort().reverse().map((d) => {
            const list = entries.filter((e) => e.date === d).sort((x, y) => x.start - y.start || x.end - y.end);
            return { d, list, minutes: list.reduce((m, e) => m + this.rounded(e.minutes), 0) };
        });
        const out = [row(head), row(head.map((h, i) => (h === "Hours" ? "--:" : marks && i === 0 ? ":-:" : "---")))];
        for (const { d, list, minutes } of days) {
            out.push(sum(`[[${d}\\|${this.dayName(d).slice(0, 3)} ${md(d)}]]`, minutes));
            for (const e of list) {
                const [mark, invoice] = cells(e);
                out.push(row([...(marks ? [mark] : []), "", `${this.formatTime(e.start)} - ${this.formatTime(e.end)}`, ...(project ? [this.cell(link(e.project))] : []),
                    this.hours(this.rounded(e.minutes)),
                    this.tableText(written ? e.taskWritten ?? e.task : e.task), this.tableText(written ? e.noteWritten ?? e.note : e.note),
                    ...(billing ? [invoice] : [])]));
            }
        }
        return out;
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
        const row = (cells) => `| ${cells.join(" | ")} |`;
        return [
            row(head), row(head.map((h, k) => (h === "Hours" || h === "Total" ? "--:" : k === 0 ? ":-:" : "---"))),
            ...list.map((i) => row([
                this.invoiceMark(i), `[[${i.name}]]`, ...(project ? [this.cell(link(i.project))] : []),
                i.invoiceDate ? this.shortDate(i.invoiceDate) : "",
                i.periodStart && i.periodEnd ? `${md(i.periodStart)} – ${this.shortDate(i.periodEnd)}` : "",
                minutes(i) === null ? "" : this.hours(minutes(i)), cents(i) === null ? "" : this.money(cents(i)),
            ])),
            row(["", "**Total**", ...(project ? [""] : []), "", "", `**${this.hours(live.reduce((s, i) => s + (minutes(i) ?? 0), 0))}**`,
                `**${this.money(live.reduce((s, i) => s + (cents(i) ?? 0), 0))}**`]),
        ];
    }

    // The block, markers included, for { kind: "project", path } or { kind: "period", unit, key };
    // either can carry `linkTarget(unit, key)`, the link text for a weekly or monthly note (its name,
    // or its full path when another note has the same name).
    // `link(path)` makes a project link, aliased with ⭕ and the project's name (defaults to
    // [[basename|⭕ basename]]); inside a table its `|` is escaped (see cell).
    render(model, scope, stamp, link = (p) => `[[${this.basename(p)}]]`) {
        // A project's timesheet link opens the block, beside when it was updated
        const top = scope.kind === "project" && scope.sheet ? `[[${scope.sheet}|View Timesheet]] | *Updated ${stamp}*` : `*Updated ${stamp}*`;
        const out = [TimeReport.START, top, ""];

        if (scope.kind === "period" && scope.unit === "year") {
            const mine = this.inScope(model, scope);
            out.push("### Earned", "", ...this.yearTable(model, mine.entries, scope, link, "earned"), "");
            out.push("### Hours", "", ...this.yearTable(model, mine.entries, scope, link, "hours"), "");
            out.push("### Problems", "", ...this.problemLines(model, mine.problems, mine.projectProblems, mine.entries, link));
        } else if (scope.kind === "period") {
            const mine = this.inScope(model, scope);
            out.push("### Totals", "", ...this.summaryTable(model, mine.entries, link, { total: true }), "");
            if (scope.unit === "week" && mine.entries.length) out.push("### By Day", "", ...this.weekDaysTable(model, mine.entries, scope, link), "");
            if (scope.unit === "month" && mine.entries.length) out.push("### By Week", "", ...this.monthWeeksTable(model, mine.entries, scope, link), "");
            out.push("### Problems", "", ...this.problemLines(model, mine.problems, mine.projectProblems, mine.entries, link));
        } else if (scope.kind !== "timesheet") {
            const mine = this.inScope(model, scope);
            out.push(...this.projectTables(model, mine.entries, scope, link), "");
            const invoices = this.invoiceLines(model, scope, link);
            if (invoices.length) out.push("### Invoices", "", ...invoices, "");
            out.push("### Problems", "", ...this.problemLines(model, mine.problems, mine.projectProblems, mine.entries, link));
        } else {
            // Its own note, not the project's: a long table in a note costs every keystroke typed in it
            // (OBS-5 measured about 0.05 ms a row), and nobody types in a timesheet
            out.push(`Every entry of ${link(scope.path)}, newest day first.`, "", ...this.timesheetLines(model, scope, link).slice(0, -1));
        }
        // Nothing between the markers may open a comment or look like a marker, or the next run can't find the block
        const body = out.slice(1).map((l) => this.defuse(l));
        return [TimeReport.START, ...body, TimeReport.END].join("\n");
    }

    // ---------------------------------------------------------------- writing the block

    // Where the block goes in `content`: { start, end, text, inserted } (character offsets to
    // replace), or { error }. An existing block is replaced. Otherwise it goes right under `heading`
    // if the note has it, else at the end under a new `heading`. Never anywhere else.
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

        const h = lines.findIndex((l, j) => !hidden[j] && l.trim().toLowerCase() === heading.toLowerCase());
        if (h !== -1) {
            const here = endOf(h);
            const tail = h + 1 < lines.length && !blank(h + 1) ? nl : "";
            return { start: here, end: here, text: nl + nl + text(block) + tail, inserted: true };
        }
        const trailing = content.match(/(\r?\n)*$/)[0].split("\n").length - 1;
        const lead = content.trim() ? nl.repeat(Math.max(0, 2 - trailing)) : "";
        return { start: content.length, end: content.length, text: `${lead}${heading}${nl}${nl}${text(block)}${nl}`, inserted: true };
    }

    // Room to add things above the report (tasks at the top of a weekly or monthly note): the
    // "## Time tracking" heading always has a blank line above it. Returns the insertion
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
    anchorLine(lines, cursorLine) {
        const isBox = (l) => /^\s*[-*+]\s+\[.\]/.test(l);
        if (lines[cursorLine] === undefined) return -1;
        if (isBox(lines[cursorLine])) return cursorLine;
        if (lines[cursorLine].trim() === "") return -1;
        let limit = this.indentWidth(lines[cursorLine]);
        for (let j = cursorLine - 1; j >= 0 && limit > 0; j--) {
            if (lines[j].trim() === "") continue;
            const w = this.indentWidth(lines[j]);
            if (w >= limit) continue;
            if (isBox(lines[j])) return j;
            limit = w;
        }
        return -1;
    }

    // Last line of a task's sub-bullets, across blank lines between them
    subtreeEnd(lines, anchor) {
        const w = this.indentWidth(lines[anchor]);
        let k = anchor;
        for (let j = anchor + 1; j < lines.length; j++) {
            if (lines[j].trim() === "") continue;
            if (this.indentWidth(lines[j]) <= w) break;
            k = j;
        }
        return k;
    }

    // A task's own running entries: under it, but not under one of its sub-tasks
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
        const child = lines.slice(anchor + 1, last + 1).find((l) => l.trim() !== "");
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

    // A task or event line as dropdown text: no bullet or checkbox, links shown as their text
    itemLabel(line) {
        return line.replace(TimeReport.BULLET, "$3").replace(/^\[.\]\s*/, "")
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

    // Open tasks and events with no running entry. Done [x], cancelled [-] and forwarded [>] items
    // are left out; [<] is an event, so it stays.
    taskChoices(lines) {
        const { visible, hidden, blocks } = this.scan(lines);
        const all = this.openLines(lines);
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
            if (!box || /[xX>-]/.test(box[1]) || underEntry(i)) continue;
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
            const { model } = await this.currentModel({ index, schedule: this.schedule, billing });
            const stamp = window.moment().format("YYYY-MM-DD h:mma");
            // Project links by name, area links "🗃️ Name" (tables escape the | themselves)
            const link = (p) => {
                const f = app.vault.getFileByPath(p);
                return this.reportLink(f ? app.metadataCache.fileToLinktext(f, "", true) : this.basename(p), p, index);
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
            if (broken.length) trouble.push(`couldn't update ${broken.join(", ")} (check its time:start/end markers, or an unclosed code block or comment)`);

            if (trouble.length) new Notice(`Time report: ${trouble.join(" · ")}`, 0);
            else if (!quiet) new Notice(done.length ? `Time report updated: ${done.join(", ")}` : "Time report is already up to date");
        } catch (e) {
            console.error("TimeReport failed", e);
            new Notice("Time report failed — check the console");
        } finally {
            working?.hide();
            window.timeReportRunning = false;
        }
    }

    // The model as a report run sees it now: every daily note read, entries that haven't ended left
    // out, and the invoice notes attached (OBS-5). The Invoice command builds on the same one, so an
    // invoice and the report never disagree about an entry. A caller that captured Schedule and Billing
    // when it started (refresh, OBS-41) passes them in.
    async currentModel({ index = this.appIndex(), schedule = customJS.Schedule, billing = customJS.Billing } = {}) {
        const clock = window.moment();
        const model = this.build(await this.readDailyNotes(schedule), index, { now: { date: clock.format("YYYY-MM-DD"), minutes: clock.hours() * 60 + clock.minutes() } });
        this.attachBilling(model, await this.readInvoices(billing), index, billing);
        return { model, index };
    }

    // Every invoice note, anywhere in the vault, 90 Archive included: an archived project's invoices
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
    // its week/month/year pattern ("[weeks]/gggg[w]ww" → "30 Reference/36 Planner/weeks"); without
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
                        const made = await this.createPeriodNote(path, unit, key, this.render(model, scopeOf(unit, key), stamp, link));
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
                    const r = await this.writeBlock(file, block, { onlyIfChanged: true });
                    if (r.error) broken.push(file.basename);
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
        return {
            exists: (path) => !!app.vault.getFileByPath(path),
            // Exact #project or #area, in frontmatter or inline (same rule as pickParent and SyncArea)
            isProject: (path) => tagged(path, "project"),
            isArea: (path) => tagged(path, "area"),
            isInvoice: (path) => tagged(path, "invoice"),
            area: (path) => {
                const fm = cacheOf(path)?.frontmatter ?? {};
                const key = Object.keys(fm).find((k) => k.toLowerCase() === "area");
                const value = [].concat(key ? fm[key] ?? [] : [])[0];
                return typeof value === "string" ? value : null;
            },
            props: (path) => cacheOf(path)?.frontmatter ?? {},
            linkDest: (linktext, fromPath) => app.metadataCache.getFirstLinkpathDest(linktext, fromPath)?.path ?? null,
        };
    }

    // An open note's editor can be ahead of the file on disk (Obsidian saves a moment after typing)
    textOf(file) {
        const view = app.workspace.getLeavesOfType("markdown").map((l) => l.view).find((v) => v?.file === file && v.editor);
        return view ? view.editor.getValue() : app.vault.cachedRead(file);
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

    // The project notes a report goes to: every project or area with time, its parents, and any project a
    // project-level problem is about (a conflict can name a project with no time of its own)
    projectTargets(model) {
        const targets = new Set();
        for (const p of [...model.entries.map((e) => e.project), ...model.projectProblems.map((x) => x.project)]) {
            const seen = new Set();
            for (let up = p; up && !seen.has(up); up = model.parent.get(up)) { seen.add(up); targets.add(up); }
        }
        return targets;
    }

    async writeProjectNotes(model, index, stamp, link, linkTarget) {
        const targets = this.projectTargets(model);
        for (const f of app.vault.getMarkdownFiles()) {
            if (!targets.has(f.path) && !this.isArchived(f.path) && this.counts(f.path, index) && this.hasBlock(await this.textOf(f))) targets.add(f.path);
        }
        let updated = 0;
        const broken = [];
        const sheets = this.timesheetNotes(index);
        const remembered = new Set(app.loadLocalStorage(TimeReport.CREATED_KEY) ?? []);
        const created = [];
        for (const path of targets) {
            const file = app.vault.getFileByPath(path);
            if (!file || this.isArchived(path)) continue;
            // An area's timesheet made before OBS-131 is left as it was, and no longer linked
            const sheet = this.takesTimesheet(path, index, model) ? await this.writeTimesheet(model, path, sheets, remembered, stamp, link, broken, created) : null;
            try {
                const block = this.render(model, { kind: "project", path, linkTarget, sheet }, stamp, link);
                const r = await this.writeBlock(file, block, { onlyIfChanged: true });
                if (r.error) broken.push(file.basename);
                else if (r.wrote) updated++;
            } catch (e) {
                console.error(`TimeReport: couldn't update ${path}`, e);
                broken.push(file.basename);
            }
        }
        return { updated, broken, created };
    }

    // Every timesheet note (tagged `timesheet`), by the project its `area` links: Map(project → path).
    // Found this way, a timesheet stays its project's when either is renamed.
    timesheetNotes(index) {
        const out = new Map();
        for (const f of app.vault.getMarkdownFiles()) {
            const fm = app.metadataCache.getFileCache(f)?.frontmatter;
            if (!fm || !this.tagsOf({ frontmatter: fm }).includes("timesheet")) continue;
            const target = String(index.area(f.path) ?? "").match(/\[\[([^\]|#]+)/)?.[1]?.trim();
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
                file = await app.vault.create(path, this.sheetNote(window.moment().format("YYYYMMDDHHmmssSS"), `[[${projectFile.basename}|${alias}]]`, block));
                remembered.add(path);
                app.saveLocalStorage(TimeReport.CREATED_KEY, [...remembered]);
                created.push(file.basename);
            } else {
                const r = await this.writeBlock(file, block, { onlyIfChanged: true });
                if (r.error) broken.push(file.basename);
            }
            return app.metadataCache.fileToLinktext(file, project, true);
        } catch (e) {
            console.error(`TimeReport: couldn't write ${path}`, e);
            broken.push(this.basename(path));
            return file ? app.metadataCache.fileToLinktext(file, project, true) : null;
        }
    }

    // Writes through an open editor when there is one (the editor keeps its own folds), else
    // through the vault in one read-modify-write, moving the saved folds to match
    async writeBlock(file, block, { onlyIfChanged }) {
        const apply = (content, edit) => content.slice(0, edit.start) + edit.text + content.slice(edit.end);
        // What to do to `content`: [edits in order], or { error }. Nothing when it's already right.
        const plan = (content) => {
            const edits = [];
            const blank = this.blankLineAbove(content);
            const fixed = blank ? apply(content, blank) : content;
            if (blank) edits.push(blank);
            if (!(onlyIfChanged && this.sameBlock(fixed, block))) {
                const place = this.placeBlock(fixed, block);
                if (place.error) return place;
                edits.push(place);
            }
            return { edits };
        };

        const view = app.workspace.getLeavesOfType("markdown").map((l) => l.view).find((v) => v?.file === file && v.editor);
        if (view) {
            const p = plan(view.editor.getValue());
            if (p.error) return p;
            for (const edit of p.edits) {
                view.editor.replaceRange(edit.text, view.editor.offsetToPos(edit.start), view.editor.offsetToPos(edit.end));
            }
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
