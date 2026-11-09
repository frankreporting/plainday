class CalendarSync {
    // Writes calendar events into daily notes and keeps them current: an event that moves, is
    // renamed or is canceled updates the line the sync wrote (a canceled one is marked [-], kept as
    // a record of what was planned, and back to [<] if the event returns). A line you've touched is yours,
    // except for what you add on top of an event: ⭕ project links, a 🆓 and a link to its log after
    // the title, a note after the end time's colon, and time entries under it. Those are kept
    // through every update, and a moved event takes its links and 🆓 (not its time entries or the
    // end line's note) to the new day. A ⭕ put after a recurring
    // series in the Calendar Sync note reaches every upcoming line of that series. An event the
    // calendar shows as free gets ℹ️ after its title (see FREE_MARK), kept current the same way.
    // A log's line with no time, `- [<] Title [[log|⋯]]` (the Log template writes one when the
    // calendar has no event for a meeting, OBS-10), is adopted when the event arrives and given
    // its time, and a log a line links takes the line's times whenever the sync writes the line.
    // An event links its log at the end, `Title [[log|⋯]]`, as a task links its note (OBS-57),
    // after its ⭕ links, so the note link ends the line (OBS-90). Lines from before put the log
    // link ahead of the ⭕, or wrap the title in it, `[[log|Title]]`; they're still read, and
    // written the new way whenever the sync rewrites them.
    //
    // Three files, all in Config:
    // - `calendar-events.json`   every calendar and event, written by the fetcher
    //   (`Scripts/Calendar/fetchCalendar.swift` on this Mac; a Google fetcher could replace it)
    // - `Calendar Sync.md`       the calendars you've ticked, and the last run's report
    // - `calendar-sync.json`     which line the sync wrote for which event
    // The two JSON files live beside the fetcher in `Scripts/Calendar`. They're deliberately
    // not hidden: Obsidian Sync skips dotfiles, and the phone needs the events file.
    //
    // Run it after fetching: `obsidian command id=plainday:sync-calendars` (under CustomJS,
    // `customjs:invoke-CalendarSync`).
    // Notes are changed through app.vault.process, which reads and writes in one step, so this
    // can't overwrite what you're typing. The ledger only ever claims a line the sync has seen
    // in the note afterwards, so a write that doesn't land is retried rather than forgotten.
    static EVENTS = "Config/Scripts/Calendar/calendar-events.json";
    static LEDGER = "Config/Scripts/Calendar/calendar-sync.json";
    static NOTE = "Config/Calendar Sync.md";
    static MAX_REMOVALS = 10;   // a run that would remove or forward more than this does neither
    static FETCHER = "Config/Scripts/Calendar/fetchCalendar.swift";
    static FETCH_TIMEOUT_MS = 120000;
    // How far ahead to sync. The Calendar Sync note holds the choice: edit the line by hand, or
    // under CustomJS, CalendarSyncRange sets it from a dropdown.
    static RANGES = [["1 week", 7], ["2 weeks", 14], ["3 weeks", 21], ["1 month", 31], ["2 months", 62], ["3 months", 92], ["6 months", 183]];
    static DEFAULT_RANGE = "6 months";
    // A time entry under an event, the way TimeReport reads one: `4:00pm - 4:30pm: note`, or a
    // running `4:00pm - `
    static ENTRY = /^\d{1,2}:\d{2}\s?[ap]m\s*[-–—]\s*(?:\d{1,2}:\d{2}\s?[ap]m)?\s*(?::.*)?$/i;
    // A ⭕ project link, or a 🗃️ area link (OBS-36), at the end of a title (a phone may add or
    // drop the U+FE0F)
    static PROJECT_LINK = /\s*\[\[[^[\]|]+\|\s*(?:⭕|🗃)\uFE0F?\s*\]\]$/u;
    // A title wrapped in a link to its log, the way lines were written before OBS-57:
    // `[[2026-09-16 Planning|Planning]]`. CalNav reads titles with this too. Only a link to a
    // log's name (its date first, LOG_NAME) is the event's log: a title wrapped in a link to
    // anything else (a person, say) is a hand edit, which makes the line yours.
    static LOG_LINK = /^\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]$/;
    static LOG_NAME = /^\[\[(?:[^[\]|#]*\/)?\d{4}-\d{2}-\d{2} /;
    // A note link at the end of a line: an event's log, the way a task links its note (OBS-57).
    // ⋯ is written, and a ↗ is read alike (OBS-208); a phone may add or drop the U+FE0F after ↗. It
    // needs a space before it, so a title that is only a link keeps it.
    static NOTE_MARK = "⋯";
    static NOTE_LINK = /\s+\[\[[^[\]|]+\|\s*(?:⋯|↗\uFE0F?)\s*\]\]$/u;
    // ℹ️ after the title marks an event the calendar says you're free during (Show As: Free): not
    // your time, so TimeReport never counts it or checks it for overlaps (OBS-47). The sync writes
    // it on timed events, before any ⭕ links, and keeps it current with the calendar; an all-day
    // event has no time to count, so it gets none. Tentative and unknown count as busy. A phone
    // may leave out the U+FE0F. Whitespace before it, as TimeReport reads it, so a title that
    // simply ends in the character isn't one.
    static FREE_MARK = "ℹ️";
    static FREE = /\s+ℹ️?$/u;
    // 🆓 after the title is yours: TimeReport reads it as "don't bill this event's time" (OBS-24).
    // Kept through updates like a ⭕ link, and carried when the event moves. A phone may add U+FE0F.
    static NONBILLABLE_MARK = "🆓";
    static NONBILLABLE = /\s+🆓\uFE0F?$/u;
    // The sync's end-time line under an event, and any note you've put after it with a colon
    // (`\t- 4:30pm: 🆓 not billing this`), which is kept when the end time changes
    static END_LINE = /^(\s*[-*+]\s+\d{1,2}:\d{2}\s?[ap]m)(\s*:.*)?$/i;

    async invoke() {
        try {
            new Notice(await this.run());
        } catch (e) {
            console.error("CalendarSync:", e);
            new Notice(`Calendar sync failed: ${e.message}`);
        }
    }

    async run() {
        // Until the one-time conversion has run, an event's 🗒️ log link isn't read (OBS-208): the sync
        // would take the line for one you'd changed, or drop its ⭕ and log when the event moves. It
        // waits, changing nothing, and the next run after the conversion picks everything up.
        const old = await customJS.TimeReport?.oldMarksLeft?.();
        if (old) return `${old} line${old === 1 ? " in the daily notes still ends" : "s in the daily notes still end"} in a 🗒️ or 🔗 link, so the calendar sync waits for the one-time conversion: see the manual's Links at the end of a line`;
        const fetchFailed = await this.fetchNow();
        const feed = await this.readJson(CalendarSync.EVENTS);
        if (!feed) return fetchFailed ? `Couldn't read your calendar: ${fetchFailed}` : "No calendar data yet — run the fetcher, then try again";
        if (feed.error) return `The fetcher reported: ${feed.error}`;
        if (!Array.isArray(feed.events) || !Array.isArray(feed.calendars)) return `${CalendarSync.EVENTS} isn't in the expected format`;

        const ledger = (await this.readJson(CalendarSync.LEDGER)) ?? { version: 1, updatedAt: null, events: {}, dismissed: {} };
        ledger.canceled ??= {};   // added later: a ledger from before has none
        // On a device that only receives the file through Sync, older data must not undo newer work
        // Compared as instants: the stamps carry local offsets, and across a DST change or a
        // change of timezone, string order calls newer data older
        if (ledger.updatedAt && feed.generatedAt && Date.parse(feed.generatedAt) <= Date.parse(ledger.updatedAt)) {
            return "Calendar data is older than the last sync — nothing to do";
        }
        if (!feed.calendars.length) return "The fetch returned no calendars — nothing to do";

        const selected = await this.selection(feed.calendars);
        if (selected === null) return `Tick the calendars to sync in ${CalendarSync.NOTE}`;
        if (!selected.size) return `No calendars ticked in ${CalendarSync.NOTE}`;
        const series = await this.seriesProjects(feed, selected, ledger);

        const report = await this.apply(feed, ledger, selected, series);
        ledger.version = 1;
        ledger.updatedAt = feed.generatedAt ?? new Date().toISOString();
        await this.writeJson(CalendarSync.LEDGER, ledger);
        await this.writeReport(report, feed);
        await this.logProblems(report);
        const summary = this.summary(report);
        return fetchFailed ? `${summary} — from the last fetch (${fetchFailed})` : summary;
    }

    // On the Mac this runs the fetcher itself, so the one command does the whole job and neither
    // Raycast nor a shell script is needed. The phone has neither Node nor EventKit, so there the
    // events file is whatever Sync last carried over. Returns null, or why the fetch failed.
    async fetchNow() {
        if (app.isMobile) return null;
        let execFile;
        try {
            ({ execFile } = require("child_process"));
        } catch (e) {
            return "no way to run the fetcher on this device";
        }
        const root = app.vault.adapter.getBasePath?.() ?? app.vault.adapter.basePath;
        if (!root) return "couldn't work out where the vault is";
        const args = [`${root}/${CalendarSync.FETCHER}`, "--days", String(await this.rangeDays()), "--out", `${root}/${CalendarSync.EVENTS}`];
        return new Promise((resolve) => {
            execFile("/usr/bin/swift", args, { timeout: CalendarSync.FETCH_TIMEOUT_MS }, (err, stdout, stderr) => {
                if (!err) return resolve(null);
                console.error("CalendarSync: the fetcher failed", err, stderr);
                const said = String(stderr || err.message).trim().split("\n").pop() || "the fetcher failed";
                resolve(said.slice(0, 200));
            });
        });
    }

    ranges() {
        return CalendarSync.RANGES;
    }

    // The range written in the note, or the default when it says nothing sensible
    async rangeLabel() {
        const file = app.vault.getFileByPath(CalendarSync.NOTE);
        const text = file ? await app.vault.read(file) : "";
        const said = text.match(/^Sync range:\s*(.+?)\s*$/m)?.[1]?.toLowerCase();
        return CalendarSync.RANGES.find(([label]) => label === said)?.[0] ?? CalendarSync.DEFAULT_RANGE;
    }

    async rangeDays() {
        const label = await this.rangeLabel();
        return CalendarSync.RANGES.find(([l]) => l === label)[1];
    }

    async setRange(label) {
        if (!CalendarSync.RANGES.some(([l]) => l === label)) return;
        await this.updateNote(CalendarSync.NOTE, (text) =>
            text === null ? this.newNote(this.rangeSection(label)) : this.replaceSection(text, "## Range", this.rangeSection(label)));
    }

    rangeSection(label) {
        return [
            "## Range",
            "",
            `Sync range: ${label}`,
            "",
            `How far ahead to sync: ${CalendarSync.RANGES.map(([l]) => l).join(", ")}. *Calendar sync (range)* sets this from a dropdown; editing this line works just as well.`,
        ].join("\n") + "\n";
    }

    // MARK: the calendars you've ticked

    // Refreshes the Calendar Sync note from the fetched calendar list, keeping your ticks, and
    // returns the ticked calendar ids. Returns null the first time, when nothing is ticked yet.
    async selection(calendars) {
        const file = app.vault.getFileByPath(CalendarSync.NOTE);
        const before = file ? await app.vault.read(file) : null;
        const rangeNow = await this.rangeLabel();
        const ticked = this.tickedTitles(before ?? "");

        const body = this.calendarSection(calendars, ticked);
        const withRange = (text) => (/^## Range$/m.test(text) ? text : this.replaceSection(text, "## Range", this.rangeSection(rangeNow)));
        const expected = before === null
            ? withRange(this.newNote(body))
            : withRange(this.replaceSection(before, "## Calendars", body));
        let current = ticked;
        if (expected !== before) {
            // Re-read the ticks inside the write, so a tick you make while this runs isn't lost
            await this.updateNote(CalendarSync.NOTE, (text) => {
                if (text === null) return withRange(this.newNote(body));
                current = this.tickedTitles(text);
                return withRange(this.replaceSection(text, "## Calendars", this.calendarSection(calendars, current)));
            });
        }
        if (before === null) return null;

        const wanted = new Set();
        for (const calendar of calendars) {
            if (current.has(this.calendarKey(calendar))) wanted.add(calendar.id);
        }
        return wanted;
    }

    // "- [x] Home" under "### Personal" reads as account/title. Only the Calendars section counts.
    tickedTitles(text) {
        const ticked = new Set();
        let account = null;
        let inside = false;
        for (const line of text.split("\n")) {
            if (/^##\s/.test(line)) { inside = line.trim() === "## Calendars"; account = null; continue; }
            if (!inside) continue;
            const heading = line.match(/^###\s+(.*\S)\s*$/);
            if (heading) { account = heading[1].trim(); continue; }
            const box = line.match(/^\s*-\s+\[([ xX])\]\s+(.*\S)\s*$/);
            if (box && account && box[1].toLowerCase() === "x") ticked.add(`${account}/${box[2].trim()}`);
        }
        return ticked;
    }

    // A calendar's title can carry stray spaces, and a ticked line in the note can't
    calendarKey(calendar) {
        return `${calendar.account.trim()}/${calendar.title.trim()}`;
    }

    calendarSection(calendars, ticked) {
        const byAccount = new Map();
        const push = (account, calendar) => {
            if (!byAccount.has(account)) byAccount.set(account, []);
            byAccount.get(account).push(calendar);
        };
        for (const calendar of calendars) push(calendar.account.trim(), calendar);
        // A calendar missing from this fetch keeps its line, so a partial fetch can't quietly
        // undo what you've ticked
        const present = new Set(calendars.map((c) => this.calendarKey(c)));
        for (const key of ticked) {
            if (present.has(key)) continue;
            const cut = key.indexOf("/");
            push(key.slice(0, cut), { account: key.slice(0, cut), title: key.slice(cut + 1), id: null });
        }
        const lines = [
            "## Calendars",
            "",
            "Tick a calendar to sync it into daily notes. New calendars appear here unticked. Unticking one leaves the lines it already wrote alone.",
            "",
        ];
        for (const [account, list] of [...byAccount].sort((a, b) => a[0].localeCompare(b[0]))) {
            lines.push(`### ${account}`);
            for (const calendar of list.sort((a, b) => a.title.localeCompare(b.title))) {
                lines.push(`- [${ticked.has(this.calendarKey(calendar)) ? "x" : " "}] ${calendar.title.trim()}`);
            }
            lines.push("");
        }
        return lines.join("\n").trimEnd() + "\n";
    }

    newNote(body) {
        return `---\nid: ${window.moment().format("YYYYMMDDHHmmssSS")}\ntags: \n---\n\n${body}\n`;
    }

    // Replaces one "## Heading" section, keeping everything around it. A section that isn't there
    // yet goes above the `before` heading, or at the end.
    replaceSection(text, heading, body, before = null) {
        const lines = text.split("\n");
        const start = lines.findIndex((l) => l.trim() === heading);
        const next = before === null ? -1 : lines.findIndex((l) => l.trim() === before);
        if (start === -1 && next !== -1) return [...lines.slice(0, next), ...body.replace(/\n$/, "").split("\n"), "", ...lines.slice(next)].join("\n");
        if (start === -1) return `${text.replace(/\s*$/, "")}\n\n${body}`;
        let end = lines.length;
        for (let i = start + 1; i < lines.length; i++) {
            if (/^##\s+/.test(lines[i])) { end = i; break; }
        }
        return [...lines.slice(0, start), ...body.replace(/\n$/, "").split("\n"), "", ...lines.slice(end)].join("\n");
    }

    // MARK: projects for recurring series

    // Refreshes the note's list of recurring series, keeping the ⭕ links you've put after them,
    // and returns series ID -> { links, key } for the series that have one. The note lists a series
    // by the title of its next occurrence; the ledger remembers that title by ID, so a series whose
    // title changes (a birthday with an age in it, say) has its line renamed and keeps its project.
    // Two series with the same title share a line.
    async seriesProjects(feed, selected, ledger) {
        const named = new Map();   // series ID -> title; the fetcher sorts events by start
        for (const event of feed.events) {
            if (event.recurring && selected.has(event.calendarId) && event.status !== "canceled" && !named.has(event.id)) {
                named.set(event.id, this.title(event));
            }
        }
        const file = app.vault.getFileByPath(CalendarSync.NOTE);
        if (!file) return new Map();
        const known = ledger.seriesTitles ?? {};
        const titles = new Set(named.values());
        const renames = [];
        for (const [id, title] of named) {
            // A title another series still has stays listed; the renamed series gets a copy of its line
            if (!known[id] || known[id] === title) continue;
            // Shared when another series still goes by the old title: one that had it already (or
            // is new), not one that has just been renamed to it; or one missing from this fetch
            const shared = [...named].some(([other, t]) => other !== id && t === known[id] && (known[other] ?? t) === t)
                || Object.entries(known).some(([other, t]) => other !== id && !named.has(other) && t === known[id]);
            renames.push({ from: known[id], to: title, copy: shared });
        }
        // A series split in two: the new part takes the old part's line, copied while the old
        // part still has occurrences
        const live = new Map();
        for (const event of feed.events) {
            if (selected.has(event.calendarId) && event.status !== "canceled" && !live.has(event.key)) live.set(event.key, event);
        }
        const split = new Set();
        for (const { entry, event } of this.seriesSplits(ledger.events ?? {}, live)) {
            const from = known[entry.id] ?? entry.title;
            const to = named.get(event.id);
            if (known[event.id] || split.has(event.id) || !to || from === to) continue;
            split.add(event.id);
            renames.push({ from, to, copy: named.has(entry.id) });
        }
        let mapping = new Map();
        const refresh = (text) => {
            const renamed = this.renameSeries(text, renames);
            mapping = this.seriesMapping(renamed);
            return this.replaceSection(renamed, "## Recurring events", this.seriesSection(renamed, titles), "## Last run");
        };
        const before = await app.vault.read(file);
        // Re-read inside the write, so a link you add while this runs isn't lost
        if (refresh(before) !== before) await this.updateNote(CalendarSync.NOTE, refresh);

        const byId = new Map();
        for (const [id, title] of named) if (mapping.has(title)) byId.set(id, mapping.get(title));
        // A series missing from this fetch is remembered while its line has a project
        const remembered = {};
        for (const [id, title] of Object.entries(known)) if (!named.has(id) && mapping.has(title)) remembered[id] = title;
        ledger.seriesTitles = { ...remembered, ...Object.fromEntries(named) };
        return byId;
    }

    // Calendar's "this and future events" edit gives the rest of a series a new ID: occurrences of
    // the old series vanish and a new series appears on the same days. An occurrence the ledger has
    // that's gone from `events`, and an occurrence of a repeating event the ledger doesn't know, on
    // the same calendar, day, start and end, are the same event. Returns [{ key, entry, event }]
    // for the ones that pair up one to one.
    seriesSplits(ledgerEvents, events) {
        const slot = (calendarId, date, lines) => `${calendarId}|${date}|${lines[0].split("\t")[0]}|${lines[1] ?? ""}`;
        const gone = new Map();
        const fresh = new Map();
        for (const [key, entry] of Object.entries(ledgerEvents)) {
            if (key === entry.id || events.has(key)) continue;   // not an occurrence, or still there
            const at = slot(entry.calendarId, entry.date, entry.lines);
            gone.set(at, gone.has(at) ? null : { key, entry });
        }
        for (const event of events.values()) {
            if (!event.recurring || ledgerEvents[event.key]) continue;
            const at = slot(event.calendarId, event.date, this.lines(event));
            fresh.set(at, fresh.has(at) ? null : event);
        }
        const pairs = [];
        for (const [at, old] of gone) {
            const event = fresh.get(at);
            if (old && event && event.id !== old.entry.id) pairs.push({ ...old, event });
        }
        return pairs;
    }

    // Renames lines in the Recurring events section. Each { from, to, copy } gives `to` the links
    // `from` had before any rename this run (so chains and swaps come out right), and takes the
    // `from` line away unless `copy` (another series still has that title) or another rename
    // gives it a new project. A `to` line with links of its own keeps them, unless its series has
    // been renamed away too.
    renameSeries(text, renames) {
        if (!renames.length) return text;
        const lines = text.split("\n");
        const start = lines.findIndex((l) => l.trim() === "## Recurring events");
        if (start === -1) return text;
        let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
        if (end === -1) end = lines.length;
        const items = new Map();   // title -> { at, prefix, projects }, the first line for it
        for (let i = start + 1; i < end; i++) {
            const m = lines[i].match(/^(\s*[-*+]\s+)(.*\S)\s*$/);
            if (!m) continue;
            const { rest, projects } = this.splitProjects(m[2]);
            if (!items.has(rest)) items.set(rest, { at: i, prefix: m[1], projects });
        }
        const vacated = new Set(renames.filter((r) => !r.copy).map((r) => r.from));
        const assign = new Map();   // title -> links it ends up with
        const dropped = new Set();  // old lines whose links went to a new title
        for (const { from, to, copy } of renames) {
            const source = items.get(from);
            if (!source || assign.has(to)) continue;
            const own = items.get(to);
            if (own?.projects.length && !vacated.has(to)) continue;
            assign.set(to, source.projects);
            if (!copy) dropped.add(from);
        }
        const out = [];
        const placed = new Set();
        const line = (prefix, title) => `${prefix}${[title, ...assign.get(title)].join(" ")}`;
        for (let i = 0; i < lines.length; i++) {
            if (i <= start || i >= end) { out.push(lines[i]); continue; }
            const m = lines[i].match(/^(\s*[-*+]\s+)(.*\S)\s*$/);
            const rest = m && this.splitProjects(m[2]).rest;
            if (!m || items.get(rest)?.at !== i) { out.push(lines[i]); continue; }
            if (assign.has(rest)) { out.push(line(m[1], rest)); placed.add(rest); }
            else if (!dropped.has(rest)) out.push(lines[i]);
            // A renamed series' new line goes where its old one was
            for (const { from, to } of renames) {
                if (from !== rest || placed.has(to) || !assign.has(to) || items.has(to)) continue;
                out.push(line(m[1], to));
                placed.add(to);
            }
        }
        return out.join("\n");
    }

    // "- Weekly sync [[Pinecone Studio|⭕]]" under "## Recurring events"
    seriesMapping(text) {
        const mapping = new Map();
        let inside = false;
        for (const line of text.split("\n")) {
            if (/^##\s/.test(line)) { inside = line.trim() === "## Recurring events"; continue; }
            const item = inside && line.match(/^\s*[-*+]\s+(.*\S)\s*$/);
            if (!item) continue;
            const { rest, projects } = this.splitProjects(item[1]);
            if (!projects.length || !rest) continue;
            const links = [...new Set([...(mapping.get(rest)?.links ?? []), ...projects])];
            mapping.set(rest, { links, key: links.join(" ") });
        }
        return mapping;
    }

    // The section as you left it, with a line for each new series. Only a plain title whose series
    // has left your calendars is taken out; anything with a link or a comment stays.
    seriesSection(text, titles) {
        const lines = text.split("\n");
        const start = lines.findIndex((l) => l.trim() === "## Recurring events");
        let kept = [
            "",
            "Put a project link after a series, like `[[Project|⭕]]`, and every upcoming line of it gets that link, unless the line has time entries, a log link or a ⭕ of its own. Take the link away and lines keep what they have.",
        ];
        if (start !== -1) {
            let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
            if (end === -1) end = lines.length;
            kept = lines.slice(start + 1, end);
        }
        const listed = new Set();
        kept = kept.filter((line) => {
            const item = line.match(/^\s*[-*+]\s+(.*\S)\s*$/);
            if (!item) return true;
            const { rest, projects } = this.splitProjects(item[1]);
            listed.add(rest);
            return projects.length > 0 || titles.has(rest) || /\[\[|%%|<!--/.test(item[1]);
        });
        while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
        const added = [...titles].filter((t) => !listed.has(t)).sort((a, b) => a.localeCompare(b));
        if (added.length && kept.length && !/^\s*[-*+]\s/.test(kept[kept.length - 1])) kept.push("");
        return ["## Recurring events", ...kept, ...added.map((t) => `- ${t}`)].join("\n") + "\n";
    }

    // MARK: working out what each note needs

    async apply(feed, ledger, selected, series = new Map()) {
        const report = { added: [], adopted: [], updated: [], linked: [], restored: [], removed: [], canceled: [], forwarded: [], yours: [], held: [], skipped: [] };
        const today = window.moment().startOf("day");
        const upcoming = (date) => !window.moment(date, "YYYY-MM-DD", true).isBefore(today);
        // Only days this fetch actually covered can say anything about their events: with a
        // one-week range, everything past next week is simply unknown, not canceled
        const covered = (date) => (!feed.windowStart || date >= feed.windowStart) && (!feed.windowEnd || date <= feed.windowEnd);

        const events = new Map();
        for (const event of feed.events) {
            if (!selected.has(event.calendarId) || event.status === "canceled" || !upcoming(event.date)) continue;
            if (!events.has(event.key)) events.set(event.key, event);
        }

        // Days gone by are none of the sync's business any more
        for (const [key, entry] of Object.entries(ledger.events)) if (!upcoming(entry.date)) delete ledger.events[key];
        for (const [key, date] of Object.entries(ledger.dismissed)) if (!upcoming(date)) delete ledger.dismissed[key];
        for (const [key, entry] of Object.entries(ledger.canceled)) if (!upcoming(entry.date)) delete ledger.canceled[key];

        const plan = new Map();   // date -> operations
        const add = (date, op) => { if (!plan.has(date)) plan.set(date, []); plan.get(date).push(op); };
        const removals = [];

        // The rest of a series split off in Calendar keeps its lines: renamed, not canceled and added
        const splits = this.seriesSplits(ledger.events, events);
        const handedOver = new Set(splits.map((s) => s.key));

        for (const [key, entry] of Object.entries(ledger.events)) {
            if (handedOver.has(key)) continue;
            const event = events.get(key);
            if (event) events.delete(key);   // handled here; whatever is left over is new
            if (!event) {
                // Only call it canceled when this run could have seen it: a calendar that was
                // unticked, or missing from the fetch, tells us nothing about its events
                if (!covered(entry.date) || !selected.has(entry.calendarId) || !feed.calendars.some((c) => c.id === entry.calendarId)) {
                    add(entry.date, { kind: "verify", key, entry });
                    continue;
                }
                removals.push({ kind: "cancel", key, entry });
                continue;
            }
            const lines = this.lines(event);
            // Even an unchanged event is checked, so a line you deleted is noticed and one whose
            // write never landed is written again
            if (event.date === entry.date && this.same(lines, entry.lines)) add(entry.date, { kind: "verify", key, entry, event, lines });
            else if (event.date !== entry.date) removals.push({ kind: "moveOut", key, entry, event, lines });
            else add(entry.date, { kind: "replace", key, entry, event, lines });
        }

        for (const { key, entry, event } of splits) {
            events.delete(event.key);
            add(entry.date, { kind: "replace", key: event.key, entry: { ...entry, id: event.id }, event, lines: this.lines(event), handover: key });
        }

        // An event marked canceled that's back in the calendar (restored, or a fetch that missed
        // it) gets its [<] back; the next run brings its line up to date
        // (not in a held run, whose fetch isn't trusted)
        const returning = [];
        for (const [key, entry] of Object.entries(ledger.canceled)) {
            const event = events.get(key);
            if (!event || ledger.events[key]) continue;
            events.delete(key);
            returning.push({ kind: "restore", key, entry, event });
        }

        // One bad fetch shouldn't be able to strip a month of events out of the notes. Past the
        // limit nothing is applied but the checks: a fetch that wants that many removals is
        // exactly the one whose new events shouldn't be trusted either.
        const holding = removals.length > CalendarSync.MAX_REMOVALS;
        if (!holding) for (const op of returning) add(op.entry.date, op);
        if (holding) {
            report.held = removals.map((r) => `${r.entry.date} ${r.entry.title}`);
            for (const event of events.values()) report.held.push(`${event.date} ${event.title} (not added)`);
        } else {
            for (const removal of removals) {
                add(removal.entry.date, removal);
                if (removal.kind === "moveOut") {
                    removal.carry = await this.carryFor(removal.entry);
                    add(removal.event.date, { kind: "insert", key: removal.key, event: removal.event, lines: removal.lines, move: true, carry: removal.carry });
                }
            }
            for (const [key, event] of events) {
                if (ledger.dismissed[key]) continue;
                add(event.date, { kind: "insert", key, event, lines: this.lines(event) });
            }
        }
        // Series links go only on events this fetch has, and wait with everything else in a held run.
        // An insert may find a line the sync marked canceled: an event deleted and made again.
        for (const [date, ops] of plan) {
            const canceled = Object.entries(ledger.canceled).filter(([key, entry]) => entry.date === date && !events.has(key));
            for (const op of ops) {
                op.series = !holding && op.event?.recurring ? series.get(op.event.id) ?? null : null;
                if (op.kind === "insert") op.canceled = canceled;
            }
        }

        // Inserts run first, so a move writes the new line before the old one goes. If the new
        // line can't be written, the move's removal waits for the next run; if it landed without
        // the old line's links, the old line is forwarded rather than removed.
        const landed = new Map();
        // Lines events took in the first pass, by date, so a cancel in the second can't take the
        // line an event whose ID changed has just adopted
        const taken = new Map();
        const pass = async (wanted, first) => {
            for (const [date] of [...plan].sort()) {
                let ops = plan.get(date).filter(wanted);
                if (!ops.length) continue;
                // Inserts mustn't adopt a line another event still has
                // (one whose event this fetch has: a line whose calendar went missing may be the one
                // a new copy of its event should adopt)
                if (first) ops = [...plan.get(date).filter((op) => ["verify", "replace", "restore"].includes(op.kind) && op.event).map((op) => ({ kind: "reserve", key: op.key, entry: op.entry })), ...ops];
                try {
                    await this.applyToNote(date, ops, ledger, report, landed, taken);
                } catch (e) {
                    console.error(`CalendarSync: ${date}`, e);
                    report.skipped.push(`${date}: ${e.message}`);
                }
            }
        };
        await pass((op) => op.kind === "insert", true);
        for (const ops of plan.values()) for (const op of ops) if (op.kind === "moveOut") op.landed = landed.get(op.key);
        await pass((op) => op.kind !== "insert" && !(op.kind === "moveOut" && !landed.has(op.key)), false);
        return report;
    }

    // What a moved event's new line takes from the old one: its ⭕ links, and its log link if the
    // old line will go (one with time entries stays behind, forwarded, and keeps the log link).
    // Read from the note as it is now; the ledger's copy only when the note can't be read.
    async carryFor(entry) {
        let text;
        try {
            const file = app.vault.getFileByPath(this.dailyPath(entry.date));
            if (!file) return { projects: [], log: null, nonbillable: false, series: entry.series };
            text = await app.vault.read(file);
        } catch (e) {
            // A ledger from before OBS-57 may hold the log link in its old form
            return { projects: entry.projects ?? [], log: this.noteLink(entry.log), nonbillable: entry.nonbillable ?? false, series: entry.series };
        }
        const lines = text.split("\n");
        const block = this.findBlock(lines, entry);
        if (!block) return { projects: [], log: null, nonbillable: false, series: entry.series };
        const own = lines.slice(block.from, block.to + 1);
        const ann = this.detached(lines, block) ? null : this.annotations(own, entry.lines);
        if (ann) return { projects: ann.projects, log: ann.entries ? null : ann.log, nonbillable: ann.nonbillable, series: entry.series };
        // A line that's yours stays behind, but its ⭕ links and 🆓 still say what the event is for
        const head = this.eventHead(own[0]);
        return { projects: head?.projects ?? [], log: null, nonbillable: head?.nonbillable ?? false, series: entry.series };
    }

    async applyToNote(date, operations, ledger, report, landed, taken = new Map()) {
        const path = this.dailyPath(date);
        const wantsInsert = operations.some((op) => op.kind === "insert");
        const file = app.vault.getFileByPath(path) ?? (wantsInsert ? await this.createDaily(date, path) : null);
        if (!file) {
            // The whole note is gone, so every line the sync wrote in it went with it
            for (const op of operations) if (op.kind !== "reserve") await this.record({ op, outcome: "missing" }, [], ledger, report, landed);
            return;
        }

        const before = await app.vault.read(file);
        // A pass over what's on disk decides whether anything needs writing at all, so a note
        // that's already right isn't rewritten (which would churn through Sync every run)
        const seed = taken.get(date);
        const dry = this.runOps(before, operations, seed);
        let outcomes = dry.outcomes;
        let after = before;

        if (dry.text !== before) {
            // Keep the folds you have: snapshot first, and let RefoldDailyNotes sort out the rest
            customJS.RefoldDailyNotes?.remember(file, before, this.currentFolds(file, before));
            let written;
            await app.vault.process(file, (text) => { written = this.runOps(text, operations, seed); return written.text; });
            outcomes = written.outcomes;
            after = await app.vault.read(file);   // read back what actually landed
            await customJS.RefoldDailyNotes?.refold(file, "open");
        }

        const afterLines = after.split("\n");
        for (const result of outcomes) {
            if (result.took) {
                if (!taken.has(date)) taken.set(date, new Map());
                this.claim(taken.get(date), result.took);
            }
            await this.record(result, afterLines, ledger, report, landed);
        }
    }

    // Applies the operations to `text` in order, each seeing the one before it
    runOps(text, operations, seed = new Map()) {
        const outcomes = [];
        const claimed = new Map(seed);
        for (const op of operations) {
            const result = this.applyOne(text, op, claimed, seed);
            text = result.text;
            const { text: _, ...rest } = result;
            outcomes.push({ op, ...rest });
        }
        return { text, outcomes };
    }

    // Returns { text, outcome, lines?, written?, ... }. `lines` is what the sync itself would write
    // (what the ledger keeps); `written` is that with your additions put back. Outcomes: inserted,
    // adopted, reinserted, replaced, linked (a series ⭕ added), present, removed, forwarded,
    // canceled (marked [-]), restored, taken (another event has the line now), reserved, missing
    // (the sync's line isn't there), yours (you changed it).
    applyOne(text, op, claimed, seed = new Map()) {
        const lines = text.split("\n");
        if (op.kind === "reserve") {
            const block = this.findBlock(lines, op.entry, claimed);
            if (block) this.claim(claimed, lines[block.from]);
            return { text, outcome: "reserved" };
        }
        if (op.kind === "insert") {
            // A moved event brings the old line's links; a series may add its ⭕
            const carry = op.carry ?? { projects: [], log: null, nonbillable: false, series: undefined };
            const links = carry.log ? null : this.seriesLinks(carry.projects, carry.series, op.series);
            const written = this.decorate(op.lines, { projects: links ?? carry.projects, log: carry.log, nonbillable: carry.nonbillable });
            const series = this.seriesApplied(carry.projects, carry.series, links, op.series);
            const existing = this.findBlock(lines, { lines: op.lines }, claimed, true);
            // A log's line with no time (the Log template wrote it before the sync had the event):
            // written in the sync's shape with its log link, its 🆓, its ⭕ links and any a moved
            // event or a series brings, and whatever sits under it kept below the end time. A line holds one
            // log, so a moved event's other log link can't come along, and its old line stays.
            const timeless = existing && this.logLine(lines[existing.from]);
            if (timeless) {
                const projects = [...new Set([...timeless.projects, ...(links ?? carry.projects)])];
                const head = this.decorate(op.lines, { projects, log: timeless.log, nonbillable: timeless.nonbillable || carry.nonbillable });
                const block = [...head, ...lines.slice(existing.from + 1, existing.to + 1)];
                this.claim(claimed, block[0]);
                return {
                    text: [...lines.slice(0, existing.from), ...block, ...lines.slice(existing.to + 1)].join("\n"),
                    outcome: "adopted", lines: op.lines, written: head, took: block[0], changed: ["time added"],
                    series, droppedLog: !!carry.log && this.noteLink(carry.log) !== timeless.log,
                };
            }
            if (!existing) {
                this.claim(claimed, written[0]);
                return { text: this.insert(lines, written), outcome: "inserted", lines: op.lines, written, series, took: written[0] };
            }
            // A line for this event is already there: adopt it rather than duplicate it.
            // (A second event that would match the same line finds it claimed and inserts its own.)
            // What's recorded is what the sync would write, so a block that differs from that by
            // more than your additions counts as yours from then on.
            // A line the sync marked canceled for an event that's been made again gets its [<] back
            const revived = /^\s*[-*+]\s+\[-\]/.test(lines[existing.from])
                && (op.canceled ?? []).find(([, entry]) => this.findBlock(lines, entry)?.from === existing.from);
            let adopted = [...lines];
            if (revived) adopted[existing.from] = lines[existing.from].replace(/^(\s*[-*+]\s+)\[-\]/, "$1[<]");
            // A line in the sync's own shape (say, left by an event deleted and made again, or written
            // before the sync knew free from busy) takes the event's end time and its free mark.
            // Start and title already match, or it wouldn't have been found; a line with anything
            // more than your additions stays as it is.
            const changed = [];
            const own = adopted.slice(existing.from, existing.to + 1);
            // The end line as the sync wrote it, whatever note you've put after it
            const end = own.findIndex((l, i) => i > 0 && this.indentWidth(l) === 4 && CalendarSync.END_LINE.test(l));
            const bareEnd = end > 0 ? own[end].match(CalendarSync.END_LINE)[1] : null;
            const free = this.eventHead(own[0])?.free ?? false;
            if (op.lines.length > 1 && end > 0 && bareEnd !== op.lines[1]) changed.push("end time updated");
            if (op.lines.length === 1 && end > 0) changed.push("end time removed");
            if (op.lines.length > 1 && free !== this.isFree(op.lines[0])) changed.push(`now ${free ? "busy" : "free"}`);
            if (changed.length && !this.detached(adopted, existing)) {
                // The head as the sync would have written it with the line's own mark, so only the
                // end time and the mark are what's updated. With no end line in the block (a time
                // entry replaced it), the new one is still expected, so it isn't written back.
                const ann = this.annotations(own, [this.markLine(op.lines[0], free), end > 0 ? bareEnd : op.lines[1]]);
                const updated = ann && this.decorate(op.lines, ann);
                if (updated) adopted = [...adopted.slice(0, existing.from), ...updated, ...adopted.slice(existing.to + 1)];
                else changed.length = 0;
            } else changed.length = 0;
            const line = adopted[existing.from];
            this.claim(claimed, line);
            return {
                text: revived || changed.length ? adopted.join("\n") : text,
                outcome: "adopted", lines: op.lines, written, took: line, revived: revived?.[0], changed,
            };
        }

        const block = this.findBlock(lines, op.entry, claimed);
        if (!block) {
            // A line a run has seen in place and that's now gone was deleted by you. One that was
            // never seen means the sync's own write didn't land, so write it again.
            // A line a new event took over earlier this run (its ID changed, say) is that event's now
            const any = (op.kind === "cancel" || (op.kind === "verify" && !op.event)) && this.findBlock(lines, op.entry);
            if (any && seed.get(lines[any.from])) return { text, outcome: "taken" };
            if (op.entry.confirmed || op.kind === "cancel" || op.kind === "restore") return { text, outcome: "missing" };
            const fresh = op.lines ?? op.entry.lines;
            const written = this.decorate(fresh, { projects: op.entry.projects ?? [], log: op.entry.log ?? null, nonbillable: op.entry.nonbillable ?? false }) ?? fresh;
            this.claim(claimed, written[0]);
            return { text: this.insert(lines, written), outcome: "reinserted", lines: fresh, written };
        }
        const own = lines.slice(block.from, block.to + 1);
        // Lines of yours past a blank line under it would be left under some other event
        const detached = this.detached(lines, block);
        const untouched = !detached && this.same(own, op.entry.lines);
        const ann = detached ? null : this.annotations(own, op.entry.lines);
        const without = [...lines.slice(0, block.from), ...lines.slice(block.to + 1)];
        const keep = () => { this.claim(claimed, lines[block.from]); };

        if (op.kind === "verify") {
            const links = ann && !ann.entries && !ann.log ? this.seriesLinks(ann.projects, op.entry.series, op.series) : null;
            const written = links && this.decorate(op.entry.lines, { ...ann, projects: links });
            if (written) {
                this.claim(claimed, written[0]);
                return {
                    text: [...lines.slice(0, block.from), ...written, ...lines.slice(block.to + 1)].join("\n"),
                    outcome: "linked", lines: op.entry.lines, written, series: op.series.key,
                };
            }
            keep();
            const series = ann ? this.seriesApplied(ann.projects, op.entry.series, null, op.series) : undefined;
            return { text, outcome: "present", lines: own, found: this.eventHead(own[0]), series };
        }
        const remark = (from, to) => {
            const line = lines[block.from].replace(new RegExp(`^(\\s*[-*+]\\s+)\\[${from}\\]`), `$1[${to}]`);
            this.claim(claimed, line);
            return { line, text: [...lines.slice(0, block.from), line, ...lines.slice(block.from + 1)].join("\n") };
        };
        if (op.kind === "cancel") {
            // Kept as a record of what was planned, whatever you'd added to it; a line you've
            // already marked some other way is left as it is
            const { line, text: marked } = remark("<", "-");
            // Already [-] (a run whose ledger write was lost): canceled all the same
            if (line === lines[block.from] && !/^\s*[-*+]\s+\[-\]/.test(line)) return { text, outcome: "yours" };
            return { text: marked, outcome: "canceled", marked: line };
        }
        if (op.kind === "restore") {
            const { line, text: unmarked } = remark("-", "<");
            // A line you've marked some other way is kept current again, but left as it is
            return { text: unmarked, outcome: "restored", quiet: line === lines[block.from] };
        }
        if (op.kind === "moveOut") {
            keep();
            if (untouched) return { text: without.join("\n"), outcome: "removed" };
            // A line with only links and a 🆓 goes, once the new day's line has those same ones.
            // Anything more (time entries, a note on the end line), or links that didn't make it
            // across, and it's forwarded.
            const carried = op.carry && op.landed?.asIntended && ann && !ann.entries && !ann.endNote
                && this.same(ann.projects, op.carry.projects) && this.noteLink(ann.log) === this.noteLink(op.carry.log)
                && !!ann.nonbillable === !!op.carry.nonbillable;
            return carried
                ? { text: without.join("\n"), outcome: "removed" }
                : { text: this.forward(lines, block, op.event.date), outcome: "forwarded" };
        }
        // replace: same day, new time or title
        if (!untouched && !ann) { keep(); return { text, outcome: "yours" }; }
        const base = ann ?? { projects: [], log: null };
        const links = !base.entries && !base.log ? this.seriesLinks(base.projects, op.entry.series, op.series) : null;
        const written = ann ? this.decorate(op.lines, { ...ann, projects: links ?? ann.projects }) : op.lines;
        if (!written) { keep(); return { text, outcome: "yours" }; }
        this.claim(claimed, written[0]);
        const changed = [];
        // Time entries stay as you wrote them, so a new time is worth a look
        if (ann?.entries && (op.lines[0].split("\t")[0] !== op.entry.lines[0].split("\t")[0] || op.lines[1] !== op.entry.lines[1])) changed.push("time changed; check its time entries");
        const free = this.isFree(op.lines[0]);
        if (free !== this.isFree(op.entry.lines[0])) changed.push(`now ${free ? "free" : "busy"}`);
        return {
            text: this.insert(without, written), outcome: "replaced", lines: op.lines, written, changed,
            series: this.seriesApplied(base.projects, op.entry.series, links, op.series),
        };
    }

    async record(result, after, ledger, report, landed) {
        const { op, outcome, lines } = result;
        if (op.kind === "reserve") return;
        const entry = op.entry;
        const event = op.event;
        const where = (date, title) => `${date} ${title}`;

        switch (outcome) {
            case "inserted":
            case "adopted":
            case "replaced":
            case "reinserted":
            case "linked": {
                const date = event?.date ?? entry.date;
                const title = event?.title ?? entry.title;
                const block = this.findBlock(after, { lines });
                const wrote = block !== null;
                if (!wrote && op.move) {
                    report.skipped.push(`${where(date, title)}: couldn't write the moved line, so it stays where it is`);
                    return;
                }
                const found = wrote ? this.eventHead(after[block.from]) : null;
                if (wrote) {
                    const intended = this.eventHead((result.written ?? lines)[0]);
                    const asIntended = !result.droppedLog && !!found && !!intended
                        && this.same(found.projects, intended.projects) && found.log === intended.log
                        && !!found.nonbillable === !!intended.nonbillable;
                    landed?.set(op.key, { asIntended });
                }
                // Carry forward what the ledger knew (a series ⭕ you took off stays off), then
                // what the line says now
                const prev = ledger.events[op.key] ?? entry ?? {};
                const next = {
                    id: event?.id ?? entry.id,
                    calendarId: event?.calendarId ?? entry.calendarId,
                    title, date, lines, confirmed: wrote,
                };
                const series = result.series ?? prev.series ?? op.carry?.series;
                if (series !== undefined) next.series = series;
                this.remember(next, found ?? { projects: prev.projects ?? [], log: prev.log ?? null, nonbillable: prev.nonbillable ?? false });
                ledger.events[op.key] = next;
                if (op.handover) delete ledger.events[op.handover];
                if (wrote && result.revived) delete ledger.canceled[result.revived];
                const changed = [...(result.changed ?? [])];
                if (wrote && found?.log && await this.fillLog(found.log, lines, date)) changed.push("log times updated");
                const said = changed.length ? `${where(date, title)} (${changed.join("; ")})` : where(date, title);
                if (!wrote) report.skipped.push(`${where(date, title)}: the line didn't land, will try again next run`);
                else if (outcome === "adopted") report.adopted.push(said);
                else if (outcome === "replaced") report.updated.push(said);
                else if (outcome === "linked") report.linked.push(where(date, title));
                else if (outcome === "reinserted") report.added.push(`${where(date, title)} (written again)`);
                else report.added.push(said);
                return;
            }
            case "present": {
                const current = ledger.events[op.key];
                if (!current) return;
                if (!entry.confirmed) current.confirmed = true;
                if (result.found) this.remember(current, result.found);
                if (result.series !== undefined) current.series = result.series;
                return;
            }
            case "canceled":
                // Remembered, so the [-] can come off if the event returns; retried if the mark didn't land
                if (!after.includes(result.marked)) {
                    report.skipped.push(`${where(entry.date, entry.title)}: couldn't mark it canceled, will try again next run`);
                    return;
                }
                report.canceled.push(where(entry.date, entry.title));
                ledger.canceled[op.key] = entry;
                delete ledger.events[op.key];
                return;
            case "restored":
                if (!result.quiet) report.restored.push(where(entry.date, entry.title));
                ledger.events[op.key] = { ...entry, confirmed: true };
                delete ledger.canceled[op.key];
                return;
            case "taken":
                delete ledger.events[op.key];
                return;
            case "missing":
                // Only a line the sync had seen in place counts as one you deleted; a moved or
                // retimed event writes itself afresh instead
                if (entry.confirmed && (op.kind === "verify" || op.kind === "cancel")) {
                    ledger.dismissed[op.key] = entry.date;
                    report.yours.push(`${where(entry.date, entry.title)} — you deleted this one, so it won't come back`);
                }
                // A moved event's new line has already been recorded under the same key
                if (ledger.events[op.key]?.date === entry.date) delete ledger.events[op.key];
                if (op.handover) delete ledger.events[op.handover];
                // A canceled line you deleted: the returning event is written afresh next run
                if (op.kind === "restore") delete ledger.canceled[op.key];
                return;
            case "yours":
                report.yours.push(op.kind === "cancel"
                    ? `${where(entry.date, entry.title)} — canceled in your calendar; your line is marked otherwise, so it's left as it is`
                    : `${where(entry.date, entry.title)} — changed in your calendar, but this line is yours`);
                if (op.kind === "cancel") delete ledger.events[op.key];
                // A split series' line that's yours: the new part's event owns it now
                if (op.handover) { ledger.events[op.key] = { ...entry }; delete ledger.events[op.handover]; }
                return;
            case "removed":
                report.removed.push(where(entry.date, entry.title));
                return;
            case "forwarded":
                report.forwarded.push(`${entry.date} → ${event.date} ${entry.title}`);
                return;
        }
    }

    // MARK: editing a note's first checklist

    // The checklist the note opens with: after the frontmatter, before any heading, and starting
    // at the first thing in the note. A list under `## Notes`, or a second group below a label,
    // is not it.
    checklist(lines) {
        const start = this.afterFrontmatter(lines);
        let limit = lines.length;
        for (let i = start; i < lines.length; i++) {
            if (/^#{1,6}\s/.test(lines[i])) { limit = i; break; }
        }
        let first = start;
        while (first < limit && lines[first].trim() === "") first++;
        if (first >= limit || !/^[-*+]\s+\[.\]/.test(lines[first])) return null;
        let end = first;
        while (end + 1 < limit) {
            const next = lines[end + 1];
            if (next.trim() === "" || !(/^\s*[-*+]\s/.test(next) || /^\s/.test(next))) break;
            end++;
        }
        return { first, end };
    }

    // Where an event line sorts: all-day events first by title, then timed ones by time, then
    // event lines with no time (a log's line, see `timeless`), which nothing can order
    rank(line) {
        const match = line.match(/^\s*[-*+]\s+\[[<-]\]\s+(?:(all day)|(\d{1,2}):(\d{2})\s?([ap]m))\t(.*)$/i);
        if (!match) return this.timeless(line) ? [2, 0, ""] : null;
        if (match[1]) return [0, 0, match[5].toLowerCase()];
        let hour = Number(match[2]) % 12;
        if (match[4].toLowerCase() === "pm") hour += 12;
        return [1, hour * 60 + Number(match[3]), ""];
    }

    sortsBefore(a, b) {
        for (let i = 0; i < a.length; i++) {
            if (a[i] < b[i]) return true;
            if (a[i] > b[i]) return false;
        }
        return false;
    }

    insert(lines, block) {
        const rank = this.rank(block[0]);
        const list = this.checklist(lines);
        if (!list) {
            // No checklist yet: the events go straight after the frontmatter
            const start = this.afterFrontmatter(lines);
            const tail = lines.slice(start);
            const spacer = tail.some((l) => l.trim() !== "") && tail[0].trim() !== "" ? [""] : [];
            return [...lines.slice(0, start), ...block, ...spacer, ...tail].join("\n");
        }
        let at = list.first;
        for (let i = list.first; i <= list.end; i++) {
            const other = this.rank(lines[i]);
            if (other === null) {
                if (/^[-*+]\s/.test(lines[i])) break;   // a task at the top level: events go above it
                continue;
            }
            if (rank && this.sortsBefore(rank, other)) return [...lines.slice(0, i), ...block, ...lines.slice(i)].join("\n");
            let last = i;
            while (last + 1 <= list.end && /^\s/.test(lines[last + 1])) last++;
            at = last + 1;
            i = last;
        }
        return [...lines.slice(0, at), ...block, ...lines.slice(at)].join("\n");
    }

    // Marks the block forwarded, links it to the day the event moved to, and drops it below the
    // day's other events (the one place a daily note carries a date link at the front of a line)
    forward(lines, block, date) {
        const alias = window.moment(date, "YYYY-MM-DD", true).format("M/D");
        const moved = lines.slice(block.from, block.to + 1);
        moved[0] = moved[0].replace(/^(\s*[-*+]\s+)\[<\]\s+/, `$1[>] [[${date}|${alias}]] `);
        const without = [...lines.slice(0, block.from), ...lines.slice(block.to + 1)];
        const list = this.checklist(without);
        let at = list ? list.first : this.afterFrontmatter(without);
        if (list) {
            for (let i = list.first; i <= list.end; i++) {
                if (this.rank(without[i]) === null) continue;
                let last = i;
                while (last + 1 <= list.end && /^\s/.test(without[last + 1])) last++;
                at = last + 1;
            }
        }
        return [...without.slice(0, at), ...moved, ...without.slice(at)].join("\n");
    }

    // An entry's block: its exact first line, else an event line with the same start whose title
    // reads the same (so a line with its log linked, either way, still matches), else, for an insert
    // only (`timeless`), a log's line with no time and the same title. Never a claimed line.
    findBlock(lines, entry, claimed = new Map(), timeless = false) {
        const wanted = this.head(entry.lines[0]);
        // Claims count how many lines of that exact text are already taken, so two events that
        // render the same line each get their own
        const pick = (test) => {
            const skip = new Map(claimed);
            for (let i = 0; i < lines.length; i++) {
                if (!test(lines[i])) continue;
                const left = skip.get(lines[i]) ?? 0;
                if (left > 0) { skip.set(lines[i], left - 1); continue; }
                return i;
            }
            return -1;
        };
        let from = pick((l) => l === entry.lines[0]);
        if (from === -1 && wanted) {
            const sameStart = (l) => this.head(l)?.start === wanted.start;
            from = pick((l) => sameStart(l) && this.head(l).title === wanted.title);
            if (from === -1) {
                // A prefix match only when one line could possibly be meant, so "Standup"
                // never adopts "Standup - Design review"
                const near = lines.filter((l) => sameStart(l) && this.head(l).title.startsWith(wanted.title));
                if (new Set(near).size === 1) from = pick((l) => l === near[0]);
            }
            // Only a line at the top level: one nested under a task belongs to that task
            if (from === -1 && timeless) from = pick((l) => /^[-*+]/.test(l) && this.logLine(l)?.shown === wanted.title);
        }
        if (from === -1) return null;
        let to = from;
        while (to + 1 < lines.length && /^\s/.test(lines[to + 1]) && lines[to + 1].trim() !== "") to++;
        return { from, to };
    }

    // Whether indented lines follow a block after a blank line: the block would end at the blank,
    // and whatever is below it would stay behind under the line above
    detached(lines, block) {
        let next = block.to + 1;
        while (next < lines.length && lines[next].trim() === "") next++;
        return next > block.to + 1 && next < lines.length && /^\s/.test(lines[next]);
    }

    // The start and displayed title of an event line, or null if it isn't one. Any checkbox
    // marker counts: marking a line [!] or [x] annotates it, it doesn't delete it. ⭕ links, the
    // free mark and the log link after the title aren't part of it.
    head(line) {
        const match = line.match(/^\s*[-*+]\s+\[.\]\s+((?:all day|\d{1,2}:\d{2}\s?[ap]m))\t(.*)$/i);
        if (!match) return null;
        return { start: match[1].toLowerCase(), title: this.display(this.splitTail(match[2], true).rest) };
    }

    // An event line with no time: `- [<] Title [[log|⋯]]`, which the Log template writes for a
    // meeting the calendar doesn't have (OBS-10). Sorts after the timed events.
    timeless(line) {
        return /^\s*[-*+]\s+\[<\]\s+(?!(?:all day|\d{1,2}:\d{2}\s?[ap]m)\t)\S/i.test(line);
    }

    // A timeless line that links a log, at the end or (from before OBS-57) around its title, taken
    // apart like eventHead: { log, shown, projects, free, nonbillable }. Null for any other line.
    logLine(line) {
        if (!this.timeless(line)) return null;
        const { rest, projects, free, nonbillable, log } = this.splitTail(line.replace(/^\s*[-*+]\s+\[<\]\s+/, ""), true);
        if (log) return { log: this.noteLink(log), shown: rest, projects, free, nonbillable };
        const wrapped = CalendarSync.LOG_NAME.test(rest) && rest.match(CalendarSync.LOG_LINK);
        return wrapped ? { log: this.noteLink(rest), shown: (wrapped[2] ?? wrapped[1]).trim(), projects, free, nonbillable } : null;
    }

    // MARK: what you add to an event line

    // "Title [[A|⭕]] [[B|⭕]]" -> { rest: "Title", projects: ["[[A|⭕]]", "[[B|⭕]]"] }
    splitProjects(text) {
        let rest = text.trimEnd();
        const projects = [];
        let link;
        while ((link = rest.match(CalendarSync.PROJECT_LINK))) {
            projects.unshift(link[0].trim());
            rest = rest.slice(0, link.index);
        }
        return { rest: rest.trim(), projects };
    }

    // "Title ℹ️ 🆓 [[A|⭕]]" -> { rest: "Title", projects: ["[[A|⭕]]"], free: true, nonbillable: true, log: null }:
    // the ⭕ links, the free mark and your 🆓 come off the end, in any order. A title that is only
    // a mark keeps it. With `note`, a note link at the end comes off too, as `log` (the link as
    // written); without it, it stays in `rest`, which is how CalNav reads a line.
    splitTail(text, note = false) {
        let rest = text.trimEnd();
        const projects = [];
        let free = false, nonbillable = false, log = null;
        for (;;) {
            const link = rest.match(CalendarSync.PROJECT_LINK);
            if (link) { projects.unshift(link[0].trim()); rest = rest.slice(0, link.index); continue; }
            const own = note && !log && rest.match(CalendarSync.NOTE_LINK);
            if (own) { log = own[0].trim(); rest = rest.slice(0, own.index); continue; }
            const mark = !free && rest.match(CalendarSync.FREE);
            if (mark) { free = true; rest = rest.slice(0, mark.index); continue; }
            const yours = !nonbillable && rest.match(CalendarSync.NONBILLABLE);
            if (yours) { nonbillable = true; rest = rest.slice(0, yours.index); continue; }
            break;
        }
        return { rest: rest.trim(), projects, free, nonbillable, log };
    }

    // An event's log link as the sync writes it, `[[target|⋯]]`, from either form (the note link
    // at the end, or a title wrapped in the link), whatever its alias; null for no link
    noteLink(link) {
        const target = link?.match(/^\[\[([^[\]|]+)/)?.[1];
        return target ? `[[${target}|${CalendarSync.NOTE_MARK}]]` : null;
    }

    // Whether one of the sync's own lines carries the free mark
    isFree(line) {
        return this.splitTail(line.slice(line.indexOf("\t") + 1)).free;
    }

    // One of the sync's own lines, with the free mark or without it
    markLine(line, free) {
        const bare = line.replace(CalendarSync.FREE, "");
        return free ? `${bare} ${CalendarSync.FREE_MARK}` : bare;
    }

    // An event line in the sync's own shape, taken apart: `- [<] <start>⇥<title> <ℹ️> <🆓> <⭕ links> <log link>`,
    // with the log link before the ⭕ links as it was written before OBS-90, or from before OBS-57
    // with the title wrapped in the log link. `shown` is the title as it
    // reads, `log` the log link as the sync writes it (`[[log|⋯]]`, whichever form the line has),
    // `free` whether it carries the mark, `nonbillable` whether you've put 🆓 on it, `trail` any
    // whitespace at the end of the line. Null otherwise.
    eventHead(line) {
        const match = line.match(/^- \[<\] ([^\t]+)\t(.*?)(\s*)$/);
        if (!match) return null;
        const { rest, projects, free, nonbillable, log } = this.splitTail(match[2], true);
        const wrapped = !log && CalendarSync.LOG_NAME.test(rest) && rest.match(CalendarSync.LOG_LINK);
        return {
            start: match[1], shown: wrapped ? (wrapped[2] ?? wrapped[1]).trim() : rest,
            log: this.noteLink(log ?? (wrapped ? rest : null)), projects, free, nonbillable, trail: match[3],
        };
    }

    // What you've added to a block the sync wrote as `synced`, if that's all you've changed: ⭕
    // links, a 🆓, a link to its log (at the end, or around the title from before OBS-57), a note
    // after the end time's colon, time entries
    // (and the lines under them) beside or in place of the end time. `children` keeps the order
    // under the event line. Null if the block has any other change, which makes it yours (the free
    // mark is the sync's: taking it off, or adding it, counts as a change).
    annotations(block, synced) {
        const head = this.eventHead(block[0]);
        if (!head || this.markLine(`- [<] ${head.start}\t${head.shown}`, head.free) !== synced[0]) return null;
        const children = [];
        let hasEnd = false, endNote = false;
        let entryWidth = null;   // the indent of the time entry the next lines may sit under
        for (const line of block.slice(1)) {
            const width = this.indentWidth(line);
            if (entryWidth !== null && width > entryWidth) { children[children.length - 1].lines.push(line); continue; }
            entryWidth = null;
            const end = synced.length > 1 && !hasEnd && line.match(CalendarSync.END_LINE);
            if (end && end[1] === synced[1]) {
                hasEnd = true;
                endNote = !!end[2];
                children.push({ kind: "end", suffix: end[2] ?? "" });
                continue;
            }
            const bullet = line.match(/^\s+[-*+]\s+(.*)$/);
            if (!bullet || !CalendarSync.ENTRY.test(bullet[1].trim())) return null;
            entryWidth = width;
            children.push({ kind: "entry", lines: [line] });
        }
        return { ...head, children, hasEnd, endNote, endExpected: synced.length > 1, entries: children.some((c) => c.kind === "entry") };
    }

    // The sync's lines for an event with your additions put back: the new start and title, the
    // free mark as the sync's lines have it, your 🆓, the ⭕ links, the log link (`[[log|⋯]]`,
    // whichever form it was in) last, as every note link ends its line (OBS-90), and the children in
    // their order with the end time updated and its note kept. A rename changes only the title; the log keeps its name. Given only { projects,
    // log, nonbillable } (a moved event, or a series), the links go on the sync's lines as they
    // are. Null if the event has no end line any more (all day now) for a noted one to move to.
    decorate(lines, ann) {
        const lead = lines[0].slice(0, lines[0].indexOf("\t"));
        const { rest: title, free } = this.splitTail(lines[0].slice(lines[0].indexOf("\t") + 1));
        const marks = [...(free ? [CalendarSync.FREE_MARK] : []), ...(ann.nonbillable ? [CalendarSync.NONBILLABLE_MARK] : [])];
        const log = ann.log ? [this.noteLink(ann.log)] : [];
        const first = `${lead}\t${[title, ...marks, ...ann.projects, ...log].join(" ")}${ann.trail ?? ""}`;
        const end = lines.slice(1);
        if (!ann.children) return [first, ...end];
        const out = [first];
        if (!ann.endExpected) out.push(...end);   // it was an all-day event, with no end time to replace
        for (const child of ann.children) {
            if (child.kind !== "end") { out.push(...child.lines); continue; }
            if (child.suffix && !end.length) return null;
            out.push(...end.map((l, i) => (i === 0 ? l + child.suffix : l)));
        }
        return out;
    }

    // The ⭕ links a series mapping gives a line that has `projects` now, or null to leave them.
    // `applied` is the mapping the line last got. A line gets a mapping once, so a ⭕ you take off
    // stays off, and a changed mapping swaps only a link the sync put there.
    seriesLinks(projects, applied, series) {
        if (!series || applied === series.key) return null;
        if (applied === undefined) return projects.length ? null : series.links;
        return projects.join(" ") === applied ? series.links : null;
    }

    // What to remember about a series mapping for a line, or undefined to leave the ledger as is:
    // its key when the sync just wrote `links`, or "!" + key when the line already had those links
    // from you, which the sync then never adds back or swaps
    seriesApplied(projects, applied, links, series) {
        if (!series) return undefined;
        if (links) return series.key;
        return applied === undefined && projects.join(" ") === series.key ? `!${series.key}` : undefined;
    }

    // The links a ledger entry keeps, so a moved event can take them along
    remember(entry, found) {
        if (found.projects?.length) entry.projects = found.projects; else delete entry.projects;
        if (found.log) entry.log = found.log; else delete entry.log;
        if (found.nonbillable) entry.nonbillable = true; else delete entry.nonbillable;
    }

    // Tabs count as four spaces
    indentWidth(line) {
        let width = 0;
        for (const ch of line.match(/^\s*/)[0]) width += ch === "\t" ? 4 : 1;
        return width;
    }

    // A line as it reads: [[note|alias]] becomes alias, [[note]] becomes note
    display(text) {
        return text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1").trim();
    }

    // A newline or tab in a title would break the line format, and nothing would match it again
    // A title ending in ℹ️ or 🆓 would read as the marks, and the line would never match again
    title(event) {
        return (event.title || "").replace(/\s+/g, " ").replace(/(?:\s+(?:🆓|ℹ)\uFE0F?)+$/u, "").trim() || "(untitled)";
    }

    // A timed event the calendar shows as free gets the mark; an events file from before the
    // fetcher wrote `availability` marks nothing, as before. A timed event that ends on another day
    // gets no end line, unless it only runs past midnight (pm to am, under a day), which TimeReport
    // reads as one span: otherwise its end's clock time would read as a span on the first day
    // (OBS-24), so it's listed as an event with no end time instead.
    lines(event) {
        const title = this.title(event);
        if (event.allDay) return [`- [<] All day\t${title}`];
        const mark = event.availability === "free" ? ` ${CalendarSync.FREE_MARK}` : "";
        const head = `- [<] ${this.time(event.start)}\t${title}${mark}`;
        const start = this.time(event.start), end = this.time(event.end);
        const overnight = start.endsWith("pm") && end.endsWith("am") && Date.parse(event.end) - Date.parse(event.start) < 24 * 3600 * 1000;
        return event.endsSameDay === false && !overnight ? [head] : [head, `\t- ${end}`];
    }

    time(iso) {
        return window.moment(iso).format("h:mma");
    }

    claim(claimed, line) {
        claimed.set(line, (claimed.get(line) ?? 0) + 1);
    }

    same(a, b) {
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((line, i) => line === b[i]);
    }

    afterFrontmatter(lines) {
        if (lines[0]?.trim() !== "---") return 0;
        const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
        return close === -1 ? 0 : close + 1;
    }

    // A linked log follows its line (OBS-10): once the sync has written a line that links a log,
    // the log's `time` and `endTime` are the line's start and end, so a log made before
    // its event reached the calendar, or whose event was retimed or moved, says when the meeting
    // is. An all-day event says nothing about time, and an event with no end line (it ends on
    // another day) leaves `endTime` alone. `lines` are the sync's own for the event. Only a log
    // is changed (see isLog): a ⋯ on an event line can point at any note. Returns whether the
    // log changed; checking the cached frontmatter first keeps an unchanged log unread.
    async fillLog(log, lines, date) {
        const target = log.match(/^\[\[([^[\]|#]+)/)?.[1]?.trim();
        const start = this.head(lines[0])?.start;
        if (!target || !start || start === "all day") return false;
        const file = app.metadataCache?.getFirstLinkpathDest?.(target, this.dailyPath(date));
        if (!file || !app.fileManager?.processFrontMatter) return false;
        const cache = app.metadataCache.getFileCache?.(file) ?? {};
        if (!this.isLog(file, cache)) return false;
        const clean = (t) => String(t ?? "").replace(/\s/g, "").toLowerCase();
        const time = clean(start);
        const end = (lines[1] ?? "").match(/^\s+[-*+]\s+(\d{1,2}:\d{2}\s?[ap]m)\s*$/i)?.[1];
        const endTime = end === undefined ? undefined : clean(end);
        const cached = cache.frontmatter ?? {};
        if (clean(cached.time) === time && (endTime === undefined || clean(cached.endTime) === endTime)) return false;
        await app.fileManager.processFrontMatter(file, (front) => {
            front.time = time;
            if (endTime !== undefined) front.endTime = endTime;
        });
        return true;
    }

    // A meeting log, as AddTaskNote.isLog and MoveToProject know one: filed in a `›logs` folder
    // (AddTaskNote.isLogsFolderName), or tagged #log (in its frontmatter or its text) wherever it waits
    isLog(file, cache) {
        const folder = (file.path ?? "").split("/").slice(-2, -1)[0];
        if (folder && globalThis.customJS?.AddTaskNote?.isLogsFolderName?.(folder) === true) return true;
        const raw = cache.frontmatter?.tags ?? cache.frontmatter?.tag ?? [];
        return (Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/))
            .concat((cache.tags ?? []).map((t) => t.tag))
            .some((t) => String(t).replace(/^#/, "").toLowerCase() === "log");
    }

    // MARK: notes, files, folds

    dailyPath(date) {
        const { folder } = customJS.Schedule.dailyOpts();
        return `${folder ? folder + "/" : ""}${date}.md`;
    }

    async createDaily(date, path) {
        const { folder } = customJS.Schedule.dailyOpts();
        if (folder && !app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder);
        const alias = window.moment(date, "YYYY-MM-DD", true).format("M/D/YY dddd");
        return app.vault.create(path, `---\naliases: ${alias}\n---\n`);
    }

    currentFolds(file, text) {
        const saved = app.foldManager.load(file);
        if (saved && saved.lines === text.split("\n").length) return saved.folds;
        const view = app.workspace.getLeavesOfType("markdown").map((l) => l.view).find((v) => v?.file === file);
        return view?.currentMode.getFoldInfo?.()?.folds ?? [];
    }

    // Read through the adapter, which doesn't need Obsidian to have indexed the file yet
    async readJson(path) {
        if (!(await app.vault.adapter.exists(path))) return null;
        const text = await app.vault.adapter.read(path);
        try {
            return JSON.parse(text);
        } catch (e) {
            throw new Error(`${path} isn't valid JSON`);
        }
    }

    async writeJson(path, value) {
        await app.vault.adapter.write(path, JSON.stringify(value, null, 2) + "\n");
    }

    // Read and write in one step, so a change you make while the sync runs isn't lost
    async updateNote(path, transform) {
        const file = app.vault.getFileByPath(path);
        if (!file) { await app.vault.create(path, transform(null)); return; }
        await app.vault.process(file, (text) => transform(text));
    }


    // MARK: the report

    async writeReport(report, feed) {
        const when = window.moment(feed.generatedAt).format("YYYY-MM-DD h:mma");
        const lines = ["## Last run", "", `Calendar read ${when}, covering ${feed.windowStart} to ${feed.windowEnd}.`, ""];
        const section = (title, items) => {
            if (!items.length) return;
            lines.push(`**${title}**`, "");
            for (const item of items) lines.push(`- ${item}`);
            lines.push("");
        };
        section("Added", report.added);
        section("Adopted lines already in your notes", report.adopted);
        section("Updated", report.updated);
        section("Project links added (recurring events)", report.linked);
        section("Restored (back in your calendar)", report.restored);
        section("Removed", report.removed);
        section("Canceled (marked [-])", report.canceled);
        section("Forwarded", report.forwarded);
        section("Left for you", report.yours);
        section(`Held back (more than ${CalendarSync.MAX_REMOVALS} removals in one run)`, report.held);
        section("Skipped", report.skipped);
        if (lines.length === 4) lines.push("No changes.", "");
        if (!app.vault.getFileByPath(CalendarSync.NOTE)) return;
        const body = lines.join("\n").trimEnd() + "\n";
        await this.updateNote(CalendarSync.NOTE, (text) => this.replaceSection(text, "## Last run", body));
    }

    // The error log's calendar section (OBS-218): changes held back and lines it couldn't write, which
    // want you; the Last run report in the Calendar Sync note has the detail
    async logProblems(report) {
        const log = customJS.ErrorLog;
        if (!log) return;
        try {
            const name = CalendarSync.NOTE.split("/").pop().replace(/\.md$/, "");
            const at = { link: `[[${name}]]`, name };
            const groups = log.group([...report.held.map(() => ({ kind: "Held back changes", ...at })), ...report.skipped.map(() => ({ kind: "Skipped lines", ...at }))]);
            log.toast("Calendar sync", await log.write("Calendar sync", groups, { create: !app.isMobile }));
        } catch (e) {
            console.error("CalendarSync: couldn't update the error log", e);
        }
    }

    summary(report) {
        const counts = [
            report.added.length && `${report.added.length} added`,
            report.adopted.length && `${report.adopted.length} adopted`,
            report.updated.length && `${report.updated.length} updated`,
            report.linked.length && `${report.linked.length} linked`,
            report.restored.length && `${report.restored.length} restored`,
            report.removed.length && `${report.removed.length} removed`,
            report.canceled.length && `${report.canceled.length} canceled`,
            report.forwarded.length && `${report.forwarded.length} forwarded`,
            report.yours.length && `${report.yours.length} left for you`,
            report.held.length && `${report.held.length} held back`,
            report.skipped.length && `${report.skipped.length} skipped`,
        ].filter(Boolean);
        return counts.length ? `Calendar sync: ${counts.join(", ")}` : "Calendar sync: nothing to change";
    }
}
