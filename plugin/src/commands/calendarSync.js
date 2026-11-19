import { moment, Notice, Platform } from "obsidian";
import { app, plainday } from "../host.js";

export default class CalendarSync {
    // Writes calendar events into daily notes and keeps them current: an event that moves, is
    // renamed or is canceled updates the line the sync wrote (a canceled one is marked [-], kept as
    // a record of what was planned, and back to [<] if the event returns). A line you've touched is yours,
    // except for what you add on top of an event: ⭕ project links, a 🆓 and a link to its log after
    // the title, a note after the end time's colon, and time entries under it. Those are kept
    // through every update, and a moved event takes its links and 🆓 (not its time entries or the
    // end line's note) to the new day. A recurring series' ⭕ in Plainday's settings reaches every
    // upcoming line of that series. An event the calendar shows as free gets ℹ️ after its title (see
    // FREE_MARK), kept current the same way.
    // A log's line with no time, `- [<] Title [[log|⋯]]` (the Log template writes one when the
    // calendar has no event for a meeting, OBS-10), is adopted when the event arrives and given
    // its time, and a log a line links takes the line's times whenever the sync writes the line.
    // An event links its log at the end, `Title [[log|⋯]]`, as a task links its note (OBS-57),
    // after its ⭕ links, so the note link ends the line (OBS-90). Lines from before put the log
    // link ahead of the ⭕, or wrap the title in it, `[[log|Title]]`; they're still read, and
    // written the new way whenever the sync rewrites them.
    //
    // Where the events come from (OBS-275, part 2 of OBS-231's plan): every calendar in Settings →
    // Plainday → Calendars that's on and has a link on this device, downloaded and read by
    // CalendarFeed. A calendar that's off, has no link here, or couldn't be read this time is left out
    // of the run, and its lines are left as they are, never marked canceled. Nothing here ever holds a
    // calendar's link: a problem is said by the calendar's name.
    //
    // Which line is which event's (OBS-275): each event line ends in its event's ID, ` ^q7m2xk`, six
    // letters and digits worked out from the event's key (its UID, with the date it was due for one
    // occurrence of a repeating event: lineId), so every device finds the same line with nothing
    // shared. The daily notes are the record: Plainday writes no file of its own in the vault.
    //
    // What this device remembers, in its own local storage (CACHE, this vault's, never synced): what it
    // last wrote on each line (so a line you've changed since counts as yours), which lines it has seen
    // in place (so one you delete stays deleted), the lines it marked canceled, and recurring series'
    // titles. A device without it is cautious: it adds new events and adopts what's there, leaves a
    // line whose time or title differs from what it would write, forwards a moved line rather than
    // removing it, and cancels nothing, since it can't tell which calendar a line came from.
    //
    // Notes are changed through app.vault.process, which reads and writes in one step, so this
    // can't overwrite what you're typing. The cache only ever claims a line the sync has seen
    // in the note afterwards, so a write that doesn't land is retried rather than forgotten.
    static CACHE = "plainday-calendar-cache";
    static CACHE_VERSION = 1;
    // The last run's report on this device, for the window OBS-276 adds
    static LAST = "plainday-calendar-last";
    // What the sync used before OBS-275, read once on each device and left for you to delete: the
    // record of lines it wrote and the events the Mac's fetcher read (for the lines you'd deleted),
    // and the Calendar Sync note (for recurring events' projects)
    static OLD_LEDGER = "Config/Scripts/Calendar/calendar-sync.json";
    static OLD_EVENTS = "Config/Scripts/Calendar/calendar-events.json";
    static OLD_NOTE = "Config/Calendar Sync.md";
    static MAX_REMOVALS = 10;   // a run that would remove or forward more than this does neither
    // How long a line the sync saw must stay gone, across two runs, before it counts as one you deleted
    static MISSING_MS = 10 * 60 * 1000;
    // How long the sync works before it hands the app a turn (breathe)
    static SLICE_MS = 5;
    // An event line's ID: ID_LENGTH letters and digits, from ID_SPACE (36^6) values. One that another
    // line of the note already uses steps to the next of ID_STEPS.
    static ID_LENGTH = 6;
    static ID_SPACE = 2176782336;
    static ID_STEPS = 3;
    // A block ID ending a line, as Obsidian reads one (TaskIds.ID_AT_END)
    static ID_AT_END = /\s\^([A-Za-z0-9-]+)\s*$/;
    // What the summary and the error log say for a calendar that couldn't be synced, by the reader's
    // problem (CalendarFeed.load)
    static PROBLEMS = {
        dead: "its link stopped working on this device",
        unreachable: "couldn't be reached",
        unreadable: "isn't a calendar any more, or came cut off",
        slow: "took too long to read",
    };
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
        let working = null;
        let said;
        try {
            said = await this.run({ working: () => { working = new Notice("Syncing calendars…", 0); } });
        } catch (e) {
            console.error("CalendarSync:", e);
            said = `Calendar sync failed: ${e.message}`;
        }
        working?.hide();
        new Notice(said);
    }

    // One sync at a time: a second one says so and does nothing. `working` is called once the run
    // has calendars to download, for the notice that shows while it works.
    async run({ working = () => {} } = {}) {
        if (this.running) return "A calendar sync is already running";
        this.running = true;
        try {
            return await this.runOnce(working);
        } finally {
            this.running = false;
        }
    }

    async runOnce(working) {
        // Until the one-time conversion has run, an event's 🗒️ log link isn't read (OBS-208): the sync
        // would take the line for one you'd changed, or drop its ⭕ and log when the event moves. It
        // waits, changing nothing, and the next run after the conversion picks everything up.
        const old = await plainday.TimeReport?.oldMarksLeft?.();
        if (old) return `${old} line${old === 1 ? " in the daily notes still ends" : "s in the daily notes still end"} in a 🗒️ or 🔗 link, so the calendar sync waits for the one-time conversion: see the manual's Links at the end of a line`;
        const settings = plainday.Settings;
        const calendars = settings.get().calendars.list;
        // With no calendars, nothing goes over the network
        if (!calendars.length) return "No calendars to sync yet: add one in Settings → Plainday → Calendars";
        // One device writes the events, and Sync brings them to the others (OBS-275; several, OBS-161)
        if (!settings.syncHere()) return "This device doesn't sync calendars. To sync them here, turn on Settings → Plainday → Calendars → Sync calendars on this device, and keep it off on your other devices.";
        const linked = calendars.filter((c) => c.on).map((calendar) => ({ calendar, link: settings.link(calendar.id) })).filter((c) => c.link);
        if (!linked.length) return "No calendar is switched on with a link on this device: see Settings → Plainday → Calendars";
        working();

        const stats = { started: Date.now(), calendars: [] };
        const probe = this.blockProbe();
        const reader = plainday.CalendarFeed;
        const range = reader.window(this.rangeDays());
        const downloaded = performance.now();
        // Downloaded and read at the same time; a link goes only to the reader, never into a result
        const reads = await Promise.all(linked.map(async ({ calendar, link }) => ({ calendar, got: await reader.load(link, { calendar, window: range }) })));
        stats.fetchMs = performance.now() - downloaded;
        const cache = this.loadCache();
        const report = this.newReport();
        report.calendarCount = reads.length;
        for (const { calendar, got } of reads) {
            stats.calendars.push({ name: calendar.name, problem: got.problem ?? null, events: got.events?.length ?? 0, ...this.timings(got.stats) });
            if (got.problem) {
                report.notSynced.push({ id: calendar.id, name: calendar.name || "A calendar", problem: got.problem });
                if (got.problem === "dead") cache.dead[calendar.id] = true;
                continue;
            }
            delete cache.dead[calendar.id];
            for (const f of got.failed ?? []) report.failedEvents.push({ calendarId: calendar.id, calendar: calendar.name || "a calendar", uid: String(f.uid ?? ""), title: String(f.title ?? "") || "(untitled)" });
        }
        const ok = reads.filter((r) => !r.got.problem);
        if (ok.length) {
            const feed = reader.feed(ok.map(({ calendar, got }) => ({ calendar, events: got.events ?? [] })), range);
            // Events each calendar still has, outside the range: their lines aren't taken for canceled
            feed.outside = new Set(ok.flatMap(({ calendar, got }) => (got.outside ?? []).map((key) => `${calendar.id}|${key}`)));
            const selected = new Set(ok.map((r) => r.calendar.id));
            await this.migrate(cache);
            await this.recurringFromNote();
            const applied = performance.now();
            const series = await this.seriesProjects(feed, selected, cache);
            await this.apply(feed, cache, selected, series, report);
            stats.applyMs = performance.now() - applied;
            stats.window = { start: feed.windowStart, end: feed.windowEnd };
        }
        // A link given a new one since this run began: not the one that stopped working (linkChanged)
        for (const [id, at] of this.changedLinks ?? []) if (at >= stats.started) delete cache.dead[id];
        this.saveCache(cache);
        stats.longestBlockMs = probe.stop();
        this.saveLast(report, stats);
        await this.logProblems(report);
        return this.summary(report);
    }

    // The timings a read gives, rounded to tenths of a millisecond: the download, the read in the worker,
    // and from the worker's start to its answer
    timings(s = {}) {
        const ms = (v) => (typeof v === "number" ? Math.round(v * 10) / 10 : null);
        return { downloadMs: ms(s.downloadMs), readMs: ms(s.readMs), workerMs: ms(s.wallMs) };
    }

    // The longest stretch the app was held up while the sync ran, for the speed budget: a timer that
    // should fire every few milliseconds, and how late it was at worst. stop() gives that, in ms.
    blockProbe(every = 4) {
        let worst = 0, last = performance.now(), timer = null, stopped = false;
        const tick = () => {
            const now = performance.now();
            worst = Math.max(worst, now - last - every);
            last = now;
            if (!stopped) timer = window.setTimeout(tick, every);
        };
        timer = window.setTimeout(tick, every);
        return {
            stop: () => {
                stopped = true;
                window.clearTimeout(timer);
                tick();
                return Math.round(Math.max(0, worst) * 10) / 10;
            },
        };
    }

    // How far ahead to sync: Settings → Plainday → Calendars → Sync range (OBS-282)
    rangeDays() {
        return plainday.Settings.rangeDays();
    }

    // A calendar's link changed (Settings.storeLink): it's no longer the one that stopped working
    linkChanged(id) {
        // A run working now loaded the cache before this; it leaves this calendar's flag off when it saves
        (this.changedLinks ??= new Map()).set(id, Date.now());
        const cache = this.loadCache();
        if (!cache.dead[id]) return;
        delete cache.dead[id];
        this.saveCache(cache);
    }

    // Whether a calendar's link stopped working on this device at the last sync that read it, for the
    // settings panel
    deadLink(id) {
        return !!this.loadCache().dead[id];
    }

    // MARK: what this device remembers

    // This device's cache (see the top): { version, events: key → entry, dismissed: key → date, canceled:
    // key → entry, seriesTitles: series ID → title, dead: calendar ID → true, dismissedLines: "date|line" →
    // date, migrated }. An entry is what the sync last wrote for an event: { lid (its line's ID), id (the
    // event's UID), calendarId, title, date, lines (the sync's own lines, without the ID), confirmed (seen
    // in place), series, projects, log, nonbillable }. Anything that doesn't read starts afresh: the
    // device is then one without the cache, which is safe.
    loadCache() {
        let raw;
        try {
            raw = app.loadLocalStorage?.(CalendarSync.CACHE) ?? null;
            if (typeof raw === "string") raw = JSON.parse(raw);
        } catch {
            raw = null;
        }
        const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
        const r = obj(raw);
        const fresh = r.version === CalendarSync.CACHE_VERSION;
        return {
            version: CalendarSync.CACHE_VERSION,
            events: fresh ? obj(r.events) : {},
            dismissed: fresh ? obj(r.dismissed) : {},
            canceled: fresh ? obj(r.canceled) : {},
            seriesTitles: fresh ? obj(r.seriesTitles) : {},
            dead: fresh ? obj(r.dead) : {},
            dismissedLines: fresh ? obj(r.dismissedLines) : {},
            tangled: fresh ? obj(r.tangled) : {},
            migrated: fresh && r.migrated === true,
        };
    }

    saveCache(cache) {
        app.saveLocalStorage?.(CalendarSync.CACHE, cache);
    }

    // Forgets everything this device remembers (dev-vault.sh's done, OBS-61): the next run is a first one
    forgetCache() {
        app.saveLocalStorage?.(CalendarSync.CACHE, null);
        app.saveLocalStorage?.(CalendarSync.LAST, null);
    }

    // The last run's report on this device, with its timings
    saveLast(report, stats) {
        const { failedEvents, notSynced, ...lists } = report;
        app.saveLocalStorage?.(CalendarSync.LAST, { at: new Date().toISOString(), ...lists, notSynced, failedEvents, stats });
    }

    lastRun() {
        try {
            return app.loadLocalStorage?.(CalendarSync.LAST) ?? null;
        } catch {
            return null;
        }
    }

    // Once on each device, what the sync kept before OBS-275 (OLD_LEDGER), if it's there: the lines you'd
    // deleted, so they stay deleted, and the lines it had marked canceled, so an event that returns takes
    // its line back. Its other entries aren't taken: they're keyed by the Mac's own event IDs, which no
    // feed has, so every one would look canceled. A deleted line is keyed the same way, so it's found in
    // the Mac's last events file (OLD_EVENTS) and kept by its day and the line the sync wrote for it.
    async migrate(cache) {
        if (cache.migrated) return;
        cache.migrated = true;
        let ledger = null, events = null;
        try {
            ledger = await this.readJson(CalendarSync.OLD_LEDGER);
            events = ledger ? await this.readJson(CalendarSync.OLD_EVENTS) : null;
        } catch (e) {
            console.error("CalendarSync: couldn't read the old record", e.message);
        }
        if (!ledger || typeof ledger !== "object") return;
        const today = moment().format("YYYY-MM-DD");
        const byKey = new Map((Array.isArray(events?.events) ? events.events : []).filter((e) => e && typeof e.key === "string").map((e) => [e.key, e]));
        for (const [key, date] of Object.entries(ledger.dismissed ?? {})) {
            if (typeof date !== "string" || date < today) continue;
            cache.dismissed[key] = date;
            const old = byKey.get(key);
            if (old && typeof old.date === "string") cache.dismissedLines[`${old.date}|${this.lines(old)[0]}`] = old.date;
        }
        for (const [key, entry] of Object.entries(ledger.canceled ?? {})) {
            if (entry && typeof entry.date === "string" && entry.date >= today && Array.isArray(entry.lines)) cache.canceled[key] = { ...entry, lid: null };
        }
    }

    // MARK: projects for recurring series

    // Returns series ID -> { links, key } for the series that have projects in Plainday's settings
    // (`calendars.recurring`: a series by the title of its next occurrence, with its ⭕ and 🗃️ links).
    // This device's cache remembers that title by series ID, so a series whose title changes (a
    // birthday with an age in it, say) has its entry renamed and keeps its project. Two series with the
    // same title share an entry. Choosing a series' projects in the panel comes with OBS-276; until then
    // they're the ones the Calendar Sync note gave (recurringFromNote).
    async seriesProjects(feed, selected, cache) {
        const named = new Map();   // series ID -> title; the feed is sorted by start
        for (const event of feed.events) {
            if (event.recurring && selected.has(event.calendarId) && event.status !== "canceled" && !named.has(event.id)) {
                named.set(event.id, this.title(event));
            }
        }
        const settings = plainday.Settings;
        const list = settings.get().calendars.recurring ?? [];
        const known = cache.seriesTitles ?? {};
        const renames = [];
        for (const [id, title] of named) {
            // A title another series still has stays listed; the renamed series gets a copy of its entry
            if (!known[id] || known[id] === title) continue;
            // Shared when another series still goes by the old title: one that had it already (or
            // is new), not one that has just been renamed to it; or one missing from this read
            const shared = [...named].some(([other, t]) => other !== id && t === known[id] && (known[other] ?? t) === t)
                || Object.entries(known).some(([other, t]) => other !== id && !named.has(other) && t === known[id]);
            renames.push({ from: known[id], to: title, copy: shared });
        }
        // A series split in two: the new part takes the old part's entry, copied while the old part
        // still has occurrences
        const live = new Map();
        for (const event of feed.events) {
            if (selected.has(event.calendarId) && event.status !== "canceled" && !live.has(event.key)) live.set(event.key, event);
        }
        const split = new Set();
        for (const { entry, event } of this.seriesSplits(cache.events ?? {}, live)) {
            const from = known[entry.id] ?? entry.title;
            const to = named.get(event.id);
            if (known[event.id] || split.has(event.id) || !to || from === to) continue;
            split.add(event.id);
            renames.push({ from, to, copy: named.has(entry.id) });
        }
        const renamed = this.renameSeries(list, renames);
        if (JSON.stringify(renamed) !== JSON.stringify(list)) await settings.set("calendars", { recurring: renamed });
        const mapping = this.seriesMapping(renamed);

        const byId = new Map();
        for (const [id, title] of named) if (mapping.has(title)) byId.set(id, mapping.get(title));
        // A series missing from this read is remembered while its entry has a project
        const remembered = {};
        for (const [id, title] of Object.entries(known)) if (!named.has(id) && mapping.has(title)) remembered[id] = title;
        cache.seriesTitles = { ...remembered, ...Object.fromEntries(named) };
        return byId;
    }

    // Calendar's "this and future events" edit gives the rest of a series a new ID: occurrences of
    // the old series vanish and a new series appears on the same days. An occurrence the cache has
    // that's gone from `events`, and an occurrence of a repeating event the cache doesn't know, on
    // the same calendar, day, start and end, are the same event. Returns [{ key, entry, event }]
    // for the ones that pair up one to one.
    seriesSplits(cached, events) {
        const slot = (calendarId, date, lines) => `${calendarId}|${date}|${lines[0].split("\t")[0]}|${lines[1] ?? ""}`;
        const gone = new Map();
        const fresh = new Map();
        for (const [key, entry] of Object.entries(cached)) {
            if (key === entry.id || events.has(key)) continue;   // not an occurrence, or still there
            const at = slot(entry.calendarId, entry.date, entry.lines);
            gone.set(at, gone.has(at) ? null : { key, entry });
        }
        if (!gone.size) return [];
        for (const event of events.values()) {
            if (!event.recurring || cached[event.key]) continue;
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

    // Renames entries in the recurring list. Each { from, to, copy } gives `to` the links `from` had
    // before any rename this run (so chains and swaps come out right), and takes the `from` entry
    // away unless `copy` (another series still has that title) or another rename gives it a new
    // project. A `to` entry with links of its own keeps them, unless its series has been renamed away
    // too. A renamed series' new entry goes where its old one was.
    renameSeries(list, renames) {
        if (!renames.length) return list;
        const items = new Map();   // title -> links, the first entry for it
        for (const r of list) if (!items.has(r.title)) items.set(r.title, r.links);
        const vacated = new Set(renames.filter((r) => !r.copy).map((r) => r.from));
        const assign = new Map();   // title -> links it ends up with
        const dropped = new Set();  // old entries whose links went to a new title
        for (const { from, to, copy } of renames) {
            const source = items.get(from);
            if (!source || assign.has(to)) continue;
            const own = items.get(to);
            if (own?.length && !vacated.has(to)) continue;
            assign.set(to, source);
            if (!copy) dropped.add(from);
        }
        const out = [];
        const placed = new Set();
        for (const r of list) {
            if (assign.has(r.title)) { if (!placed.has(r.title)) out.push({ title: r.title, links: assign.get(r.title) }); placed.add(r.title); }
            else if (!dropped.has(r.title)) out.push(r);
            for (const { from, to } of renames) {
                if (from !== r.title || placed.has(to) || !assign.has(to) || items.has(to)) continue;
                out.push({ title: to, links: assign.get(to) });
                placed.add(to);
            }
        }
        return out;
    }

    // The recurring list as title -> { links, key }
    seriesMapping(list) {
        const mapping = new Map();
        for (const { title, links } of list) {
            const all = [...new Set([...(mapping.get(title)?.links ?? []), ...links])];
            mapping.set(title, { links: all, key: all.join(" ") });
        }
        return mapping;
    }

    // Once, on a device whose settings have no recurring list yet (saved before OBS-275): the ⭕ and 🗃️
    // links after each series under the Calendar Sync note's `## Recurring events`, into Plainday's
    // settings. The note isn't changed, and isn't read again.
    async recurringFromNote() {
        const settings = plainday.Settings;
        if (settings.get().calendars.recurring !== null) return;
        const file = app.vault.getFileByPath(CalendarSync.OLD_NOTE);
        const text = file ? await app.vault.read(file) : "";
        const list = [];
        let inside = false;
        for (const line of text.split("\n")) {
            if (/^##\s/.test(line)) { inside = line.trim() === "## Recurring events"; continue; }
            const item = inside && line.match(/^\s*[-*+]\s+(.*\S)\s*$/);
            if (!item) continue;
            const { rest, projects } = this.splitProjects(item[1]);
            if (rest && projects.length) list.push({ title: rest, links: projects });
        }
        await settings.set("calendars", { recurring: settings.recurringOf(list) ?? [] });
    }

    // MARK: event line IDs

    // A 53-bit hash of a string (cyrb53): the same on every device, for an event line's ID
    static hash(text) {
        let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
        for (let i = 0; i < text.length; i++) {
            const ch = text.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
        h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
        h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return 4294967296 * (2097151 & h2) + (h1 >>> 0);
    }

    // An event's line ID from its key: six letters and digits. `step` gives the next one, for an ID
    // another line already uses (stepped the same way on every device).
    lineId(key, step = 0) {
        const n = CalendarSync.hash(step ? `${key}#${step}` : String(key)) % CalendarSync.ID_SPACE;
        return n.toString(36).padStart(CalendarSync.ID_LENGTH, "0");
    }

    // The IDs an event's line can have, in the order they're tried
    lineIds(key) {
        return Array.from({ length: CalendarSync.ID_STEPS }, (_, i) => this.lineId(key, i));
    }

    // Where a line's block ID is: at its end, or ahead of links and marks typed after it (a ⭕, a note
    // link, ℹ️ or 🆓), which Obsidian no longer reads as a block ID but the sync still does, so a line
    // you or another tool added to after its ID is still found. { lid (lowercased), from, to } or null.
    static ID_IN_RUN = /\s\^([A-Za-z0-9-]+)((?:\s+(?:\[\[[^[\]]*\]\]|ℹ️?|🆓️?))*)\s*$/u;

    // The block ID a line ends with, or that sits ahead of links typed after it, lowercased, or null
    lidOf(line) {
        return String(line).match(CalendarSync.ID_IN_RUN)?.[1]?.toLowerCase() ?? null;
    }

    // The ID of an event line wherever it is in the line, even with words typed after it, or null: how
    // the sync still finds a line you added to (it's yours then, and left as it is)
    lidIn(line) {
        const text = String(line);
        if (!text.includes("^")) return null;
        const run = this.lidOf(text);
        if (run) return run;
        let found = null;
        for (const m of text.matchAll(/\s\^([A-Za-z0-9-]{1,32})(?=\s|$)/g)) found = m[1].toLowerCase();
        return found;
    }

    // Whether a line's ID is where the sync writes it, last
    lidAtEnd(line) {
        return CalendarSync.ID_AT_END.test(line);
    }

    // A line without its block ID, wherever in the run that ends the line it is
    bare(line) {
        const m = String(line).match(CalendarSync.ID_IN_RUN);
        return m ? String(line).slice(0, m.index) + m[2] : String(line);
    }

    // A line ending in ` ^lid`, in place of any ID it ends in; without one when `lid` is null
    withLid(line, lid) {
        const plain = this.bare(line).replace(/\s+$/, "");
        return lid ? `${plain} ^${lid}` : plain;
    }

    // A block with its first line ending in `lid`
    labeled(block, lid) {
        return block && [this.withLid(block[0], lid), ...block.slice(1)];
    }

    // MARK: working out what each note needs

    // Plans this run and writes it: `feed` holds the events of the calendars read this time (`selected`),
    // `cache` is this device's (loadCache), `series` the recurring events' projects, and `report`
    // collects what happened (newReport; its failedEvents are the events the reader couldn't read).
    async apply(feed, cache, selected, series = new Map(), report = this.newReport()) {
        const today = moment().format("YYYY-MM-DD");
        const upcoming = (date) => typeof date === "string" && date >= today;
        // Only days this read covered can say anything about their events: with a one-week range,
        // everything past next week is simply unknown, not canceled
        const covered = (date) => (!feed.windowStart || date >= feed.windowStart) && (!feed.windowEnd || date <= feed.windowEnd);
        const read = new Set(feed.calendars.map((c) => c.id));
        // An event the reader couldn't read: its line is left as it is, never taken for canceled
        const unread = new Set((report.failedEvents ?? []).map((f) => `${f.calendarId}|${f.uid}`));
        const outside = feed.outside ?? new Set();

        const events = new Map();
        for (const event of feed.events) {
            if (!selected.has(event.calendarId) || event.status === "canceled" || !upcoming(event.date)) continue;
            if (!events.has(event.key)) events.set(event.key, event);
        }

        // Days gone by are none of the sync's business any more
        for (const [key, entry] of Object.entries(cache.events)) if (!upcoming(entry?.date)) delete cache.events[key];
        for (const [key, date] of Object.entries(cache.dismissed)) if (!upcoming(date)) delete cache.dismissed[key];
        for (const [key, entry] of Object.entries(cache.canceled)) if (!upcoming(entry?.date)) delete cache.canceled[key];
        for (const [key, date] of Object.entries(cache.dismissedLines)) if (!upcoming(date)) delete cache.dismissedLines[key];
        for (const [key, date] of Object.entries(cache.tangled)) if (!upcoming(date)) delete cache.tangled[key];

        // Where each event line is now, by its ID: every day from today to the window's end, and any
        // other day this device remembers a line on
        const remembered = [...Object.values(cache.events), ...Object.values(cache.canceled)].map((e) => e.date);
        const index = await this.lineIndex(today, feed.windowEnd ?? today, remembered);
        const lids = await this.assignLids(events, cache, index);

        const plan = new Map();   // date -> operations
        const add = (date, op) => { if (!plan.has(date)) plan.set(date, []); plan.get(date).push(op); };
        const removals = [];
        // A line where this device remembers it, or, when it's gone from there, the day it's on now
        // (another device moved it). A copy on yet another day (a line you copied, or one on its way
        // through Sync) is left alone.
        const located = (entry) => {
            const found = entry.lid ? index.get(entry.lid) ?? [] : [];
            return found.length && !found.includes(entry.date) ? { ...entry, date: found[0] } : entry;
        };

        // The rest of a series split off in the calendar keeps its lines: renamed, not canceled and added
        const splits = this.seriesSplits(cache.events, events);
        const handedOver = new Set(splits.map((s) => s.key));

        for (const [key, cached] of Object.entries(cache.events)) {
            await this.breathe();
            if (handedOver.has(key)) continue;
            const event = events.get(key);
            if (event) { events.delete(key); delete cached.goneSince; }   // handled here; whatever is left over is new
            const entry = located(cached);
            const lid = entry.lid;
            if (!event) {
                // Only call it canceled when this run could have seen it: a calendar that's off, has no
                // link here or wasn't read, or an event the reader couldn't read, tells us nothing
                if (!covered(entry.date) || !selected.has(entry.calendarId) || !read.has(entry.calendarId) || unread.has(`${entry.calendarId}|${entry.id}`)
                    // Moved outside the range (further ahead than the range reaches): left as it is
                    || outside.has(`${entry.calendarId}|${key}`)) {
                    add(entry.date, { kind: "verify", key, entry, lid });
                    continue;
                }
                // Gone from a calendar that read fine: canceled only when a later read, at least
                // MISSING_MS on, still lacks it. A provider's copy of a calendar can lag behind an event
                // just added, and one copy shouldn't mark a real meeting canceled.
                const since = cached.goneSince;
                if (!since) cached.goneSince = this.now();
                if (!since || this.now() - since < CalendarSync.MISSING_MS) {
                    // Its line may still be taken over by a new event at the same time (an event whose ID changed)
                    add(entry.date, { kind: "verify", key, entry, lid, gone: true });
                    continue;
                }
                removals.push({ kind: "cancel", key, entry, lid });
                continue;
            }
            const lines = this.lines(event);
            // A line this device had seen, found gone on an earlier run and still on no day: you deleted it,
            // or it's on its way through Sync. Whatever the calendar says now, that's settled first
            // (verify's two-run rule), so a deleted line doesn't come back because its event changed since.
            // An event that changes in the run that first finds its line gone is written afresh, as before.
            if (cached.confirmed && cached.missingSince && lid && !(index.get(lid)?.length)) {
                add(entry.date, { kind: "verify", key, entry, event, lines, lid, seen: false });
                continue;
            }
            // This device acts on an event only when its own read of it has changed since it last wrote
            // or saw it. Another device may have read a newer or an older copy of the calendar (a
            // provider's copies can lag), and what it wrote stands until this device's read moves on, so
            // two devices never undo each other. A read older than one already seen changes nothing. Its
            // times and day are compared as the calendar gives them, not as this device writes them, so
            // a device in another time zone doesn't rewrite a line (Brian, 2026-11-18).
            const older = this.modifiedOf(event) && entry.modified && this.modifiedOf(event) < entry.modified;
            const changed = !older && this.sig(event) !== entry.sig;
            if (!changed) add(entry.date, { kind: "verify", key, entry, event, lines, lid, seen: !older });
            else if (event.date !== entry.date) removals.push({ kind: "moveOut", key, entry, event, lines, lid });
            // Even an unchanged line is checked, so a line you deleted is noticed and one whose write
            // never landed is written again
            else add(entry.date, { kind: this.same(lines, entry.lines) ? "verify" : "replace", key, entry, event, lines, lid, seen: true });
        }

        // A split's new part takes over the old part's line, and its ID
        for (const { key, entry, event } of splits) {
            events.delete(event.key);
            add(entry.date, { kind: "replace", key: event.key, entry: { ...located(entry), id: event.id }, event, lines: this.lines(event), handover: key, lid: lids.get(event.key) });
        }

        // An event marked canceled that's back in the calendar gets its [<] back; the next run brings
        // its line up to date (not in a held run, whose read isn't trusted)
        const returning = [];
        for (const [key, entry] of Object.entries(cache.canceled)) {
            const event = events.get(key);
            if (cache.events[key]) continue;
            // Gone again from a calendar that read fine: a return that hadn't settled is forgotten
            if (!event) { if (read.has(entry.calendarId)) delete entry.backSince; continue; }
            events.delete(key);
            // Back in a copy of the calendar no newer than the one it was canceled from: a provider's copies
            // can lag, and alternate, so that's a return only once a later read, MISSING_MS on, still has it
            if (entry.modified && this.modifiedOf(event) && this.modifiedOf(event) <= entry.modified) {
                if (!entry.backSince) entry.backSince = this.now();
                if (this.now() - entry.backSince < CalendarSync.MISSING_MS) continue;
            }
            returning.push({ kind: "restore", key, entry: located(entry), event, lid: entry.lid });
        }

        // Events this device doesn't know: new ones, or ones another device wrote first
        const fresh = [];
        for (const [key, event] of events) {
            await this.breathe();
            const lines = this.lines(event);
            // A line you'd deleted and put back (undone, say) is the event's again
            if (cache.dismissed[key] && index.has(lids.get(key))) delete cache.dismissed[key];
            if (cache.dismissed[key]) {
                // Kept until the event's day passes, wherever it has moved
                if (event.date > cache.dismissed[key]) cache.dismissed[key] = event.date;
                continue;
            }
            // A line you'd deleted before OBS-275, known by its day and the line the sync wrote
            if (cache.dismissedLines[`${event.date}|${lines[0]}`]) { cache.dismissed[key] = event.date; continue; }
            const lid = lids.get(key);
            const found = index.get(lid) ?? [];
            if (!found.length || found.includes(event.date)) {
                fresh.push({ date: event.date, op: { kind: "insert", key, event, lines, lid } });
                continue;
            }
            // Its line is on another day: written before the event moved, by this device before it lost
            // what it remembered, or by the device that synced before this one. With nothing to say the
            // line is as the sync wrote it, it's forwarded rather than removed.
            const entry = { lid, id: event.id, calendarId: event.calendarId, title: event.title, date: found[0], lines: null };
            removals.push({ kind: "moveOut", key, entry, event, lines, lid });
        }

        // One bad read shouldn't be able to strip a month of events out of the notes. Past the
        // limit nothing is applied but the checks: a read that wants that many removals is
        // exactly the one whose new events shouldn't be trusted either.
        const holding = removals.length > CalendarSync.MAX_REMOVALS;
        if (holding) {
            report.held.push(...removals.map((r) => `${r.entry.date} ${r.entry.title}`));
            for (const { op } of fresh) report.held.push(`${op.event.date} ${op.event.title} (not added)`);
        } else {
            for (const op of returning) add(op.entry.date, op);
            for (const removal of removals) {
                add(removal.entry.date, removal);
                if (removal.kind === "moveOut") {
                    removal.carry = await this.carryFor(removal.entry);
                    add(removal.event.date, { kind: "insert", key: removal.key, event: removal.event, lines: removal.lines, move: true, carry: removal.carry, lid: removal.lid });
                }
            }
            for (const { date, op } of fresh) add(date, op);
        }
        // Series links go only on events this read has, and wait with everything else in a held run.
        // An insert may find a line the sync marked canceled: an event deleted and made again.
        for (const [date, ops] of plan) {
            const canceled = Object.entries(cache.canceled).filter(([key, entry]) => entry.date === date && !events.has(key));
            for (const op of ops) {
                op.series = !holding && op.event?.recurring ? series.get(op.event.id) ?? null : null;
                if (op.kind === "insert") op.canceled = canceled;
            }
        }
        // Lines an insert may take over by their start and title, besides lines from before IDs: those
        // of events gone from this run, which this device knows it wrote (a canceled event made again,
        // or one whose ID changed)
        const back = new Set(returning.map((r) => r.key));
        const adoptable = new Set([
            ...removals.filter((r) => r.kind === "cancel").map((r) => r.lid),
            ...[...plan.values()].flat().filter((op) => op.gone).map((op) => op.lid),
            ...Object.entries(cache.canceled).filter(([key]) => !back.has(key)).map(([, e]) => e.lid),
        ].filter(Boolean));
        const ctx = { adoptable, relabeled: new Set() };
        // Lines this device saw that are on no day now, and gone long enough to count as deleted: past
        // MAX_REMOVALS in one run, none is (a daily notes folder renamed, a note Sync hasn't brought)
        const due = Object.values(cache.events).filter((e) => e.confirmed && e.lid && !(index.get(e.lid)?.length) && e.missingSince && this.now() - e.missingSince >= CalendarSync.MISSING_MS);
        report.holdDeletions = due.length > CalendarSync.MAX_REMOVALS;

        // Inserts run first, so a move writes the new line before the old one goes. If the new
        // line can't be written, the move's removal waits for the next run; if it landed without
        // the old line's links, the old line is forwarded rather than removed.
        const landed = new Map();
        const pass = async (wanted) => {
            for (const [date] of [...plan].sort()) {
                const ops = plan.get(date).filter(wanted);
                if (!ops.length) continue;
                await this.breathe();
                try {
                    await this.applyToNote(date, ops, cache, report, landed, ctx);
                } catch (e) {
                    console.error(`CalendarSync: ${date}`, e);
                    report.skipped.push(`${date}: ${e.message}`);
                }
            }
        };
        await pass((op) => op.kind === "insert");
        for (const ops of plan.values()) for (const op of ops) if (op.kind === "moveOut") op.landed = landed.get(op.key);
        await pass((op) => op.kind !== "insert" && !(op.kind === "moveOut" && !landed.has(op.key)));
        return report;
    }

    // Where each event line is, by its ID: Map(lid → [dates, earliest first]), from the daily notes from
    // `from` through `to` and on `also`. Read from the notes themselves, which are ahead of Obsidian's
    // index right after a write. A forwarded line carries no ID.
    async lineIndex(from, to, also = []) {
        const days = new Set(also.filter((d) => typeof d === "string" && d >= from));
        for (let d = from; d <= to; d = this.addDays(d, 1)) days.add(d);
        const index = new Map();
        for (const date of [...days].sort()) {
            await this.breathe();
            const file = app.vault.getFileByPath(this.dailyPath(date));
            if (!file) continue;
            const text = await (app.vault.cachedRead ?? app.vault.read).call(app.vault, file);
            for (const line of text.split("\n")) {
                const lid = line.includes("^") && this.topEvent(line) ? this.lidIn(line) : null;
                if (!lid) continue;
                if (!index.has(lid)) index.set(lid, []);
                const list = index.get(lid);
                if (list[list.length - 1] !== date) list.push(date);
            }
        }
        return index;
    }

    // YYYY-MM-DD, `n` days on
    addDays(date, n) {
        const [y, m, d] = date.split("-").map(Number);
        const t = new Date(Date.UTC(y, m - 1, d + n));
        return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
    }

    // Each event's line ID: the one this device gave its line, else the first of its IDs a line already
    // has (another device may have stepped), else its first. Two events in this run whose keys give one
    // ID are told apart: the later key, in sorted order, steps on, the same on every device.
    async assignLids(events, cache, index) {
        const out = new Map(), used = new Set();
        for (const key of [...events.keys()].sort()) {
            await this.breathe();
            const known = cache.events[key]?.lid ?? cache.canceled[key]?.lid ?? null;
            const first = known ? null : this.lineId(key);
            // The next steps only when the first is taken by another event this run, or isn't on any line
            // (the line that has it may have stepped, past a task's ID in its note)
            const ids = known || (!used.has(first) && index.has(first)) ? null : this.lineIds(key);
            const lid = known ?? (ids ? ids.find((id) => index.has(id) && !used.has(id)) ?? ids.find((id) => !used.has(id)) ?? ids[0] : first);
            used.add(lid);
            out.set(key, lid);
        }
        return out;
    }

    // An event as its calendar gives it, for telling whether this device's read of it changed: its
    // start and end as instants (an all-day event's as its days), title, free or busy, and status. Not
    // as this device writes it, which depends on the device's time zone.
    sig(event) {
        const at = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : String(iso); };
        const when = event.allDay ? [event.date, String(event.end ?? "").slice(0, 10)] : [at(event.start), at(event.end)];
        return JSON.stringify([...when, !!event.allDay, this.title(event), event.availability ?? "", event.status ?? ""]);
    }

    // An event's LAST-MODIFIED as the sync trusts it: none when it's more than a day ahead of now (a
    // calendar app with a wrong clock), which would make every later change look older
    modifiedOf(event) {
        const m = event?.modified;
        return typeof m === "number" && Number.isFinite(m) && m <= this.now() + 24 * 3600 * 1000 ? m : null;
    }

    // An entry without the timers of a line or an event found gone, nor of a canceled event found back
    untimed(entry) {
        const { goneSince: _g, missingSince: _m, backSince: _b, ...rest } = entry;
        return rest;
    }

    // Now, in ms (a test sets it)
    now() {
        return Date.now();
    }

    // Hands the app a turn once the sync has held it for SLICE_MS, so a long run never holds it up
    // for more than that at a time
    async breathe() {
        if (performance.now() - (this.sliceAt ?? 0) < CalendarSync.SLICE_MS) return;
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        this.sliceAt = performance.now();
    }

    // What a moved event's new line takes from the old one: its ⭕ links, and its log link if the
    // old line will go (one with time entries stays behind, forwarded, and keeps the log link).
    // Read from the note as it is now; the cache's copy only when the note can't be read.
    async carryFor(entry) {
        let text;
        try {
            const file = app.vault.getFileByPath(this.dailyPath(entry.date));
            if (!file) return { projects: [], log: null, nonbillable: false, series: entry.series };
            text = await app.vault.read(file);
        } catch (e) {
            return { projects: entry.projects ?? [], log: this.noteLink(entry.log), nonbillable: entry.nonbillable ?? false, series: entry.series };
        }
        const lines = text.split("\n");
        const block = this.findBlock(lines, entry);
        if (!block) return { projects: [], log: null, nonbillable: false, series: entry.series };
        const own = lines.slice(block.from, block.to + 1);
        const ann = this.detached(lines, block) || !Array.isArray(entry.lines) ? null : this.annotations(own, entry.lines);
        if (ann) return { projects: ann.projects, log: ann.entries ? null : ann.log, nonbillable: ann.nonbillable, series: entry.series };
        // A line that's yours, or one this device didn't write, stays behind, but its ⭕ links and 🆓
        // still say what the event is for
        const head = this.eventHead(own[0]);
        return { projects: head?.projects ?? [], log: null, nonbillable: head?.nonbillable ?? false, series: entry.series };
    }

    // `ctx`: the run's { adoptable, relabeled } (apply)
    async applyToNote(date, operations, cache, report, landed, ctx = { adoptable: new Set(), relabeled: new Set() }) {
        const path = this.dailyPath(date);
        const wantsInsert = operations.some((op) => op.kind === "insert");
        const had = app.vault.getFileByPath(path);
        const file = had ?? (wantsInsert ? await this.createDaily(date, path) : null);
        if (!had && file) (ctx.created ??= new Set()).add(path);
        // A note this run made (the daily notes' name or folder changed, say) holds none of the lines
        // remembered on that day: they're where the note was, not deleted
        if (file && ctx.created?.has(path)) {
            const kept = operations.filter((op) => op.kind === "insert");
            for (const op of operations) if (op.kind !== "insert") await this.record({ op, outcome: "missing", noteGone: true }, [], cache, report, landed);
            if (!kept.length) return;
            operations = kept;
        }
        if (!file) {
            // The whole note is gone: deleted, not brought by Sync yet, or in a folder the daily notes no
            // longer use. Nothing there is taken for a line you deleted.
            for (const op of operations) await this.record({ op, outcome: "missing", noteGone: true }, [], cache, report, landed);
            return;
        }

        const before = await app.vault.read(file);
        // A pass over what's on disk decides whether anything needs writing at all, so a note
        // that's already right isn't rewritten (which would churn through Sync every run)
        const dry = this.runOps(before, operations, ctx);
        let { outcomes, merged } = dry;
        let after = before;

        if (dry.text !== before) {
            // Keep the folds you have: snapshot first, and let RefoldDailyNotes sort out the rest
            plainday.RefoldDailyNotes?.remember(file, before, this.currentFolds(file, before));
            let written;
            await app.vault.process(file, (text) => { written = this.runOps(text, operations, ctx); return written.text; });
            ({ outcomes, merged } = written);
            after = await app.vault.read(file);   // read back what actually landed
            await plainday.RefoldDailyNotes?.refold(file, "open");
        }

        const afterLines = after.split("\n");
        for (const m of merged.merged) if (afterLines.some((l) => this.lidOf(l) === m.lid)) report.merged.push(`${date} ${m.title}`);
        for (const m of merged.tangled) {
            // Said once for each event and day, not on every run
            const said = `${m.lid}|${date}`;
            if (cache.tangled[said]) continue;
            cache.tangled[said] = date;
            report.yours.push(`${date} ${m.title} — two lines for this event, each with something of yours; keep one and delete the other`);
        }
        for (const result of outcomes) {
            if (result.relabeled) ctx.relabeled.add(result.relabeled);
            await this.record(result, afterLines, cache, report, landed);
        }
    }

    // Merges doubled lines first (mergeDoubles), then applies the operations to `text` in order, each
    // seeing the one before it
    runOps(text, operations, ctx = { adoptable: new Set(), relabeled: new Set() }) {
        const merged = this.mergeDoubles(text, operations);
        text = merged.text;
        const outcomes = [];
        for (const op of operations) {
            const result = this.applyOne(text, op, ctx);
            text = result.text;
            const { text: _, ...rest } = result;
            outcomes.push({ op, ...rest });
        }
        return { text, outcomes, merged };
    }

    // Two event lines with one ID in a note: two devices wrote the same event before Sync met, or one
    // retimed it while the other added to it. For each event the operations name, a copy that's just
    // the sync's own lines (as it would write them now, or as this device last wrote them) goes when
    // another copy has something of yours; that copy is kept, brought up to the event's lines now when
    // it was the sync's lines plus your additions, as the sync last wrote or would write them. Copies
    // that are the same are one; between plain copies, the one as the sync would write it now stays.
    // Two copies each with something of yours, or one that can't be brought up to date, are both left
    // (`tangled`). Returns { text, merged: [{ lid, title }], tangled: [{ lid, title }] }.
    mergeDoubles(text, operations) {
        const lines = text.split("\n");
        const merged = [], tangled = [];
        const known = new Map();   // lid -> { title, now: the event's lines now, was: this device's last }
        for (const op of operations) {
            const lid = op.entry?.lid ?? op.lid;
            if (!lid || known.has(lid)) continue;
            const now = Array.isArray(op.lines) ? op.lines : Array.isArray(op.entry?.lines) ? op.entry.lines : null;
            known.set(lid, { title: op.event?.title ?? op.entry?.title ?? "", now, was: Array.isArray(op.entry?.lines) ? op.entry.lines : null });
        }
        // Each ID's event lines, in one pass over the note; again after a merge, which moves the lines below
        const doubled = (done) => {
            const where = new Map();
            for (let i = 0; i < lines.length; i++) {
                if (!lines[i].includes("^")) continue;
                const lid = this.lidOf(lines[i]);
                if (!lid || !known.has(lid) || done.has(lid) || !this.topEvent(lines[i])) continue;
                where.set(lid, [...(where.get(lid) ?? []), i]);
            }
            return [...where].find(([, rows]) => rows.length > 1) ?? null;
        };
        const done = new Set();
        for (let next = doubled(done); next; next = doubled(done)) {
            const [lid, rows] = next;
            done.add(lid);
            const { title, now, was } = known.get(lid);
            const at = rows.map((i) => this.blockAt(lines, i));
            const blocks = at.map((b) => lines.slice(b.from, b.to + 1));
            const plain = [now, was].filter(Boolean).map((l) => this.labeled(l, lid).join("\n"));
            const texts = blocks.map((b) => b.join("\n"));
            // A copy is plain when it's the sync's own lines, as it would write them now or last wrote them
            const rich = [...new Set(texts.filter((t) => !plain.includes(t)))];
            let keep, replacement = null;
            if (!rich.length) {
                const current = now ? this.labeled(now, lid).join("\n") : null;
                keep = Math.max(0, texts.indexOf(current));
            } else if (rich.length === 1) {
                keep = texts.indexOf(rich[0]);
                const copy = blocks[keep].map((l, i) => (i === 0 ? this.bare(l) : l));
                // The sync's lines it holds, as this device last wrote them or would write them now
                const base = [now, was].filter(Boolean).find((l) => this.annotations(copy, l));
                if (base && now && base !== now) {
                    replacement = this.labeled(this.decorate(now, this.annotations(copy, base)), lid);
                    if (!replacement) { tangled.push({ lid, title }); continue; }
                } else if (!base) {
                    // A copy you changed beyond your additions: yours, and the plain copies may be newer
                    tangled.push({ lid, title });
                    continue;
                }
            } else {
                tangled.push({ lid, title });
                continue;
            }
            for (let j = at.length - 1; j >= 0; j--) {
                if (j === keep) { if (replacement) lines.splice(at[j].from, at[j].to - at[j].from + 1, ...replacement); }
                else lines.splice(at[j].from, at[j].to - at[j].from + 1);
            }
            merged.push({ lid, title });
        }
        return { text: lines.join("\n"), merged, tangled };
    }

    // Returns { text, outcome, lines?, written?, ... }. `lines` is what the sync itself would write
    // (what the cache keeps); `written` is that with your additions put back and the line's ID. Outcomes:
    // inserted, adopted, reinserted, replaced, linked (a series ⭕ added), present, removed, forwarded,
    // canceled (marked [-]), restored, taken (another event has the line now), missing (the sync's line
    // isn't there), yours (you changed it). `relabeled`: the ID a line had before it took this event's.
    applyOne(text, op, ctx = {}) {
        const adoptable = ctx.adoptable ?? new Set(), relabeled = ctx.relabeled ?? new Set();
        const lines = text.split("\n");
        if (op.kind === "insert") {
            // A moved event brings the old line's links; a series may add its ⭕
            const carry = op.carry ?? { projects: [], log: null, nonbillable: false, series: undefined };
            const links = carry.log ? null : this.seriesLinks(carry.projects, carry.series, op.series);
            const series = this.seriesApplied(carry.projects, carry.series, links, op.series);
            // Its own line, by its ID; else a line from before IDs, or one whose event is gone from this
            // run, with the same start and title; else a log's line with no time and the same title
            const byId = this.findBlock(lines, { lid: op.lid });
            // A moved event is one this device knows: it takes no line another event left (canceled, or
            // gone this run), only one from before IDs
            const existing = byId ?? this.findBlock(lines, { lines: op.lines }, { adopt: op.move ? null : adoptable, timeless: true });
            const had = existing ? this.lidOf(lines[existing.from]) : null;
            const taking = had && had !== op.lid ? had : null;
            // A new line takes the next of its IDs when another line of the note (a task's, or one of
            // your own) already ends in it
            const lid = existing ? op.lid : this.freeLid(lines, op.key, op.lid);
            const written = this.labeled(this.decorate(op.lines, { projects: links ?? carry.projects, log: carry.log, nonbillable: carry.nonbillable }), lid);
            // A log's line with no time (the Log template wrote it before the sync had the event):
            // written in the sync's shape with its log link, its 🆓, its ⭕ links and any a moved
            // event or a series brings, and whatever sits under it kept below the end time. A line holds one
            // log, so a moved event's other log link can't come along, and its old line stays.
            const timeless = existing && this.logLine(lines[existing.from]);
            if (timeless) {
                const projects = [...new Set([...timeless.projects, ...(links ?? carry.projects)])];
                const head = this.labeled(this.decorate(op.lines, { projects, log: timeless.log, nonbillable: timeless.nonbillable || carry.nonbillable }), lid);
                const block = [...head, ...lines.slice(existing.from + 1, existing.to + 1)];
                return {
                    text: [...lines.slice(0, existing.from), ...block, ...lines.slice(existing.to + 1)].join("\n"),
                    outcome: "adopted", lines: op.lines, written: head, lid, changed: ["time added"],
                    series, droppedLog: !!carry.log && this.noteLink(carry.log) !== timeless.log, relabeled: taking,
                };
            }
            if (!existing) return { text: this.insert(lines, written), outcome: "inserted", lines: op.lines, written, series, lid };
            // A line for this event is already there: adopt it rather than duplicate it.
            // What's recorded is what the sync would write, so a block that differs from that by
            // more than your additions counts as yours from then on.
            const found = this.head(lines[existing.from]), wanted = this.head(op.lines[0]);
            // Found by its ID, but with another start or title than the sync would write: another
            // device's line from before the event changed, or your edit. With nothing to tell which, this
            // device leaves it as it is.
            if (byId && found && wanted && (found.start !== wanted.start || found.title !== wanted.title)) {
                return { text, outcome: "adopted", lines: op.lines, written, lid, differs: true };
            }
            // A line the sync marked canceled for an event that's been made again gets its [<] back
            const revived = !op.move && /^\s*[-*+]\s+\[-\]/.test(lines[existing.from])
                && (op.canceled ?? []).find(([, entry]) => this.findBlock(lines, entry)?.from === existing.from);
            // Marked canceled, by a device that isn't this one (or by you): left as it is
            const stillCanceled = !revived && /^\s*[-*+]\s+\[-\]/.test(lines[existing.from]);
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
            // Found by its ID, without this device's memory of it: left as it is, end time and mark too
            if (changed.length && !byId && !this.detached(adopted, existing)) {
                // The head as the sync would have written it with the line's own mark, so only the
                // end time and the mark are what's updated. With no end line in the block (a time
                // entry replaced it), the new one is still expected, so it isn't written back.
                const ann = this.annotations(own, [this.markLine(op.lines[0], free), end > 0 ? bareEnd : op.lines[1]]);
                const updated = ann && this.labeled(this.decorate(op.lines, ann), lid);
                if (updated) adopted = [...adopted.slice(0, existing.from), ...updated, ...adopted.slice(existing.to + 1)];
                else changed.length = 0;
            } else changed.length = 0;
            // A line from before IDs, or one a gone event had, ends in this event's ID from now on
            adopted[existing.from] = this.withLid(adopted[existing.from], lid);
            const next = adopted.join("\n");
            return {
                text: next, outcome: "adopted", lines: op.lines, written, lid, revived: revived?.[0], changed,
                quiet: !!byId && !revived && !changed.length, stillCanceled, relabeled: taking,
            };
        }

        const lid = op.lid ?? op.entry.lid;
        const block = this.findBlock(lines, op.entry);
        if (!block) {
            // A line a run has seen in place and that's now gone was deleted by you. One that was
            // never seen means the sync's own write didn't land, so write it again.
            // A line a new event took over earlier this run (its ID changed, say) is that event's now
            if (op.entry.lid && relabeled.has(op.entry.lid)) return { text, outcome: "taken" };
            if (op.entry.confirmed || (op.kind !== "verify" && op.kind !== "replace")) return { text, outcome: "missing" };
            const fresh = op.lines ?? op.entry.lines;
            const written = this.labeled(this.decorate(fresh, { projects: op.entry.projects ?? [], log: op.entry.log ?? null, nonbillable: op.entry.nonbillable ?? false }) ?? fresh, lid);
            return { text: this.insert(lines, written), outcome: "reinserted", lines: fresh, written, lid };
        }
        const raw = lines.slice(block.from, block.to + 1);
        // The block as the sync's lines compare with it: without its ID
        const own = [this.bare(raw[0]), ...raw.slice(1)];
        const known = Array.isArray(op.entry.lines);
        // Lines of yours past a blank line under it would be left under some other event
        const detached = this.detached(lines, block);
        const untouched = known && !detached && this.same(own, op.entry.lines);
        const ann = known && !detached ? this.annotations(own, op.entry.lines) : null;
        const without = [...lines.slice(0, block.from), ...lines.slice(block.to + 1)];
        const swap = (written) => [...lines.slice(0, block.from), ...written, ...lines.slice(block.to + 1)].join("\n");

        if (op.kind === "verify") {
            const links = ann && !ann.entries && !ann.log ? this.seriesLinks(ann.projects, op.entry.series, op.series) : null;
            const written = links && this.labeled(this.decorate(op.entry.lines, { ...ann, projects: links }), lid);
            if (written) return { text: swap(written), outcome: "linked", lines: op.entry.lines, written, series: op.series.key, lid };
            const series = ann ? this.seriesApplied(ann.projects, op.entry.series, null, op.series) : undefined;
            // An ID that something was typed after goes back to the end of the line
            const moved = lid && this.lidOf(raw[0]) === lid && !this.lidAtEnd(raw[0]) ? swap([this.withLid(raw[0], lid), ...raw.slice(1)]) : text;
            return { text: moved, outcome: "present", lines: own, found: this.eventHead(own[0]), series };
        }
        const remark = (from, to) => {
            const line = lines[block.from].replace(new RegExp(`^(\\s*[-*+]\\s+)\\[${from}\\]`), `$1[${to}]`);
            return { line, text: [...lines.slice(0, block.from), line, ...lines.slice(block.from + 1)].join("\n") };
        };
        if (op.kind === "cancel") {
            // Kept as a record of what was planned, whatever you'd added to it; a line you've
            // already marked some other way is left as it is
            const { line, text: marked } = remark("<", "-");
            // Already [-] (another device canceled it, or a run whose cache write was lost): canceled all the same
            if (line === lines[block.from] && !/^\s*[-*+]\s+\[-\]/.test(line)) return { text, outcome: "yours" };
            return { text: marked, outcome: "canceled", marked: line };
        }
        if (op.kind === "restore") {
            const { line, text: unmarked } = remark("-", "<");
            // A line you've marked some other way is kept current again, but left as it is
            return { text: unmarked, outcome: "restored", quiet: line === lines[block.from] };
        }
        if (op.kind === "moveOut") {
            if (untouched) return { text: without.join("\n"), outcome: "removed" };
            // A line with only links and a 🆓 goes, once the new day's line has those same ones.
            // Anything more (time entries, a note on the end line), links that didn't make it
            // across, or a line this device didn't write, and it's forwarded.
            const carried = op.carry && op.landed?.asIntended && ann && !ann.entries && !ann.endNote
                && this.same(ann.projects, op.carry.projects) && this.noteLink(ann.log) === this.noteLink(op.carry.log)
                && !!ann.nonbillable === !!op.carry.nonbillable;
            return carried
                ? { text: without.join("\n"), outcome: "removed" }
                : { text: this.forward(lines, block, op.event.date), outcome: "forwarded" };
        }
        // replace: same day, new time or title
        if (!untouched && !ann) {
            // Brought up to date already, by another device: the event's lines now, with what you've added
            const now = !detached && this.annotations(own, op.lines);
            if (now) return { text, outcome: "present", lines: op.lines, found: this.eventHead(own[0]), current: true };
            return { text, outcome: "yours" };
        }
        const base = ann ?? { projects: [], log: null };
        const links = !base.entries && !base.log ? this.seriesLinks(base.projects, op.entry.series, op.series) : null;
        const written = this.labeled(ann ? this.decorate(op.lines, { ...ann, projects: links ?? ann.projects }) : op.lines, lid);
        if (!written) return { text, outcome: "yours" };
        const changed = [];
        // Time entries stay as you wrote them, so a new time is worth a look
        if (ann?.entries && (op.lines[0].split("\t")[0] !== op.entry.lines[0].split("\t")[0] || op.lines[1] !== op.entry.lines[1])) changed.push("time changed; check its time entries");
        const free = this.isFree(op.lines[0]);
        if (free !== this.isFree(op.entry.lines[0])) changed.push(`now ${free ? "free" : "busy"}`);
        return {
            text: this.insert(without, written), outcome: "replaced", lines: op.lines, written, changed, lid,
            series: this.seriesApplied(base.projects, op.entry.series, links, op.series),
            relabeled: op.entry.lid && op.entry.lid !== lid ? op.entry.lid : null,
        };
    }

    // `want`, or the next of `key`'s IDs, when another line of the note that isn't this event's
    // already ends in it
    freeLid(lines, key, want) {
        const taken = new Set(lines.filter((l) => !this.head(l)).map((l) => this.lidOf(l)).filter(Boolean));
        if (!taken.has(want)) return want;
        return this.lineIds(key).find((id) => !taken.has(id)) ?? want;
    }

    async record(result, after, cache, report, landed) {
        const { op, outcome, lines } = result;
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
                const lid = result.lid ?? op.lid ?? entry?.lid;
                const block = this.findBlock(after, { lid });
                const wrote = block !== null;
                if (!wrote && op.move) {
                    report.skipped.push(`${where(date, title)}: couldn't write the moved line, so it stays where it is`);
                    return;
                }
                const found = wrote ? this.eventHead(after[block.from]) : null;
                if (wrote) {
                    const intended = this.eventHead((result.written ?? lines)[0]);
                    const asIntended = !result.droppedLog && !result.differs && !!found && !!intended
                        && this.same(found.projects, intended.projects) && found.log === intended.log
                        && !!found.nonbillable === !!intended.nonbillable;
                    landed?.set(op.key, { asIntended });
                }
                // Carry forward what the cache knew (a series ⭕ you took off stays off), then
                // what the line says now
                const prev = cache.events[op.key] ?? entry ?? {};
                const next = {
                    lid,
                    id: event?.id ?? entry.id,
                    calendarId: event?.calendarId ?? entry.calendarId,
                    title, date, lines, confirmed: wrote,
                };
                // The event as this device read it, so it acts again only when its read changes
                const sig = event ? this.sig(event) : prev.sig;
                if (sig !== undefined) next.sig = sig;
                const modified = this.modifiedOf(event) ?? prev.modified ?? null;
                if (modified !== null) next.modified = modified;
                const series = result.series ?? prev.series ?? op.carry?.series;
                if (series !== undefined) next.series = series;
                this.remember(next, found ?? { projects: prev.projects ?? [], log: prev.log ?? null, nonbillable: prev.nonbillable ?? false });
                cache.events[op.key] = next;
                if (op.handover) delete cache.events[op.handover];
                if (wrote && result.revived) delete cache.canceled[result.revived];
                const changed = [...(result.changed ?? [])];
                if (wrote && found?.log && !result.differs && !result.stillCanceled && await this.fillLog(found.log, lines, date)) changed.push("log times updated");
                const said = changed.length ? `${where(date, title)} (${changed.join("; ")})` : where(date, title);
                if (!wrote) report.skipped.push(`${where(date, title)}: the line didn't land, will try again next run`);
                else if (result.differs) report.yours.push(`${where(date, title)} — its line here has another time or title than your calendar, and this device didn't write it, so it's left as it is`);
                else if (result.stillCanceled) report.yours.push(`${where(date, title)} — marked canceled, but it's in your calendar; this device didn't mark it, so it's left as it is`);
                else if (outcome === "adopted") { if (!result.quiet || changed.length) report.adopted.push(said); }
                else if (outcome === "replaced") report.updated.push(said);
                else if (outcome === "linked") report.linked.push(where(date, title));
                else if (outcome === "reinserted") report.added.push(`${where(date, title)} (written again)`);
                else report.added.push(said);
                return;
            }
            case "present": {
                const current = cache.events[op.key];
                if (!current) return;
                current.confirmed = true;
                delete current.missingSince;
                if (op.event && op.seen) {
                    current.sig = this.sig(op.event);
                    if (this.modifiedOf(op.event)) current.modified = this.modifiedOf(op.event);
                }
                // Its calendar as this run read it: one removed and added again has a new ID
                if (op.event) { current.calendarId = op.event.calendarId; current.id = op.event.id; }
                // Its line on another day than this device remembered: another device moved it
                current.date = entry.date;
                // Brought up to date by another device: the event's lines are what this device would write
                if (result.current) current.lines = result.lines;
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
                // Without the timers that led here: a restored event starts them afresh
                cache.canceled[op.key] = this.untimed(entry);
                delete cache.events[op.key];
                return;
            case "restored": {
                if (!result.quiet) report.restored.push(where(entry.date, entry.title));
                // Without what it last read, so the next run brings the line up to date, and with the
                // returning event's version, which a later copy is compared with
                const { sig: _, ...back } = this.untimed(entry);
                const modified = this.modifiedOf(op.event) ?? back.modified;
                cache.events[op.key] = { ...back, ...(modified ? { modified } : {}), confirmed: true };
                delete cache.canceled[op.key];
                return;
            }
            case "taken":
                delete cache.events[op.key];
                delete cache.canceled[op.key];
                return;
            case "missing": {
                // A line the sync had seen in place and that's gone from every day counts as one you
                // deleted, but only when it's still gone a while later: a line another device moved or
                // merged can be missing for a moment while Sync brings the notes across (MISSING_MS)
                if (entry.confirmed && op.kind === "verify") {
                    const current = cache.events[op.key];
                    const since = current?.missingSince;
                    if (result.noteGone) return;
                    // More lines gone in one run than a run may remove: held, as a run's removals are
                    if (since && this.now() - since >= CalendarSync.MISSING_MS && report.holdDeletions) {
                        report.held.push(`${where(entry.date, entry.title)} (gone from your notes; not taken as deleted)`);
                        return;
                    }
                    if (since && this.now() - since >= CalendarSync.MISSING_MS) {
                        cache.dismissed[op.key] = entry.date;
                        report.yours.push(`${where(entry.date, entry.title)} — you deleted this one, so it won't come back`);
                        delete cache.events[op.key];
                    } else if (current && !since) current.missingSince = this.now();
                    return;
                }
                // A canceled event's line that's gone: nothing to mark, and no reason to keep it off
                // if the event comes back
                if (op.kind === "cancel") { if (!result.noteGone) delete cache.events[op.key]; return; }
                if (result.noteGone) return;
                // A moved event's new line has already been recorded under the same key
                if (cache.events[op.key]?.date === entry.date) delete cache.events[op.key];
                if (op.handover) delete cache.events[op.handover];
                // A canceled line you deleted: the returning event is written afresh next run
                if (op.kind === "restore") delete cache.canceled[op.key];
                return;
            }
            case "yours":
                // What this device read, so it says this once, not on every run
                if (op.event && cache.events[op.key] && op.kind !== "cancel") {
                    cache.events[op.key].sig = this.sig(op.event);
                    if (this.modifiedOf(op.event)) cache.events[op.key].modified = this.modifiedOf(op.event);
                }
                report.yours.push(op.kind === "cancel"
                    ? `${where(entry.date, entry.title)} — canceled in your calendar; your line is marked otherwise, so it's left as it is`
                    : `${where(entry.date, entry.title)} — changed in your calendar, but this line is yours`);
                if (op.kind === "cancel") delete cache.events[op.key];
                // A split series' line that's yours: the new part's event owns it now
                if (op.handover) { cache.events[op.key] = { ...entry }; delete cache.events[op.handover]; }
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
        const match = this.bare(line).match(/^\s*[-*+]\s+\[[<-]\]\s+(?:(all day)|(\d{1,2}):(\d{2})\s?([ap]m))\t(.*)$/i);
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
    // day's other events (the one place a daily note carries a date link at the front of a line). It
    // gives up its ID: the event's line is on the other day now, and a [>] line with an ID would read
    // as a sent task's.
    forward(lines, block, date) {
        const moved = lines.slice(block.from, block.to + 1);
        const lid = this.lidIn(moved[0]);
        const bare = lid ? this.withLid(moved[0], null).replace(new RegExp(`\\s\\^${lid}(?=\\s|$)`, "i"), "") : moved[0];
        moved[0] = bare.replace(/^(\s*[-*+]\s+)\[<\]\s+/, `$1[>] ${this.dayLink(date)} `);
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

    // An entry's block: the event line ending in its ID (`entry.lid`). An entry with no ID (a line from
    // before IDs), or an insert looking for a line to adopt: a line with no ID, or one whose ID is in
    // `adopt` (an event gone from this run), whose first line is the entry's, else with the same start
    // and a title that reads the same (so a line with its log linked, either way, still matches), else,
    // for an insert only (`timeless`), a log's line with no time and the same title.
    findBlock(lines, entry, { adopt = null, timeless = false } = {}) {
        if (entry.lid) {
            const from = lines.findIndex((l) => l.includes(entry.lid) && this.lidIn(l) === entry.lid && this.topEvent(l));
            return from === -1 ? null : this.blockAt(lines, from);
        }
        if (!Array.isArray(entry.lines)) return null;
        const free = (l) => { const lid = this.lidIn(l); return /^[-*+]\s/.test(l) && (!lid || !!adopt?.has(lid)); };
        const wanted = this.head(entry.lines[0]);
        let from = lines.findIndex((l) => free(l) && this.bare(l) === entry.lines[0]);
        if (from === -1 && wanted) {
            const sameStart = (l) => free(l) && this.head(l)?.start === wanted.start;
            from = lines.findIndex((l) => sameStart(l) && this.head(l).title === wanted.title);
            if (from === -1) {
                // A prefix match only when one line could possibly be meant, so "Standup"
                // never adopts "Standup - Design review"
                const near = lines.filter((l) => sameStart(l) && this.head(l).title.startsWith(wanted.title));
                if (new Set(near).size === 1) from = lines.indexOf(near[0]);
            }
            // Only a line at the top level: one nested under a task belongs to that task
            if (from === -1 && timeless) from = lines.findIndex((l) => free(l) && /^[-*+]/.test(l) && this.logLine(l)?.shown === wanted.title);
        }
        return from === -1 ? null : this.blockAt(lines, from);
    }

    // The block a line starts: it and the indented lines under it, to the first blank line
    blockAt(lines, from) {
        let to = from;
        while (to + 1 < lines.length && /^\s/.test(lines[to + 1]) && lines[to + 1].trim() !== "") to++;
        return { from, to };
    }

    // An event line where the sync writes them: at the left edge. A line in that shape nested under
    // another is a subtask, never an event's (nesting decides what a line is)
    topEvent(line) {
        return /^[-*+]\s/.test(line) && !!this.head(line);
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
        const match = this.bare(line).match(/^\s*[-*+]\s+\[.\]\s+((?:all day|\d{1,2}:\d{2}\s?[ap]m))\t(.*)$/i);
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
        let rest = this.bare(text).trimEnd();
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
        const match = this.bare(line).match(/^- \[<\] ([^\t]+)\t(.*?)(\s*)$/);
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
        // Worked out once a run for each event: moment's formatting is the slow part
        const memo = (this.linesMemo ??= new WeakMap());
        if (typeof event === "object" && event && memo.has(event)) return [...memo.get(event)];
        const out = this.renderLines(event);
        if (typeof event === "object" && event) memo.set(event, out);
        return [...out];
    }

    renderLines(event) {
        const title = this.title(event);
        if (event.allDay) return [`- [<] All day\t${title}`];
        const mark = event.availability === "free" ? ` ${CalendarSync.FREE_MARK}` : "";
        const head = `- [<] ${this.time(event.start)}\t${title}${mark}`;
        const start = this.time(event.start), end = this.time(event.end);
        const overnight = start.endsWith("pm") && end.endsWith("am") && Date.parse(event.end) - Date.parse(event.start) < 24 * 3600 * 1000;
        return event.endsSameDay === false && !overnight ? [head] : [head, `\t- ${end}`];
    }

    time(iso) {
        return moment(iso).format("h:mma");
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
        if (folder && plainday?.AddTaskNote?.isLogsFolderName?.(folder) === true) return true;
        const raw = cache.frontmatter?.tags ?? cache.frontmatter?.tag ?? [];
        return (Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/))
            .concat((cache.tags ?? []).map((t) => t.tag))
            .some((t) => String(t).replace(/^#/, "").toLowerCase() === "log");
    }

    // MARK: notes, files, folds

    // A day's note, named and placed as Plainday names daily notes (Schedule.dailyNotePath: the Daily
    // notes plugin's folder and format, or Notebook Navigator's, OBS-283), so a vault whose daily notes
    // aren't named YYYY-MM-DD gets its events in its own notes (OBS-124)
    dailyPath(date) {
        return plainday.Schedule.dailyNotePath(moment(date, "YYYY-MM-DD", true));
    }

    async createDaily(date, path) {
        const folder = path.split("/").slice(0, -1).join("/");
        if (folder && !app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder);
        const alias = moment(date, "YYYY-MM-DD", true).format("M/D/YY dddd");
        return app.vault.create(path, `---\naliases: ${alias}\n---\n`);
    }

    // The link a forwarded line carries to the day its event moved to: the note's name (its path when
    // the name alone isn't enough), labelled M/D
    dayLink(date) {
        const path = this.dailyPath(date);
        const name = path.split("/").pop().replace(/\.md$/, "");
        const target = app.metadataCache?.getFirstLinkpathDest?.(name, "")?.path;
        const text = !target || target === path ? name : path.replace(/\.md$/, "");
        return `[[${text}|${moment(date, "YYYY-MM-DD", true).format("M/D")}]]`;
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
            throw new Error(`${path} isn't valid JSON`, { cause: e });
        }
    }

    // MARK: the report

    newReport() {
        return {
            added: [], adopted: [], updated: [], linked: [], restored: [], removed: [], canceled: [], forwarded: [],
            merged: [], yours: [], held: [], skipped: [],
            // Calendars this run couldn't sync: [{ id, name, problem }]; events the reader couldn't read:
            // [{ calendarId, calendar, uid, title }]
            notSynced: [], failedEvents: [],
        };
    }

    // The error log's calendar section (OBS-218): a calendar whose link stopped working, or that
    // couldn't be synced this time, by its name; an event the reader couldn't read, by its title and
    // calendar, so you can find it; and changes held back or lines it couldn't write, at their daily
    // note. Each line names the device it's about, since a link is on one device and each device reads
    // for itself: a run writes this device's lines and keeps the other devices' as they are, so two
    // devices don't take each other's lines out and put them back. The log's own rule toasts only
    // what's new, so a calendar that keeps failing says so once. Never a link: a calendar is named.
    async logProblems(report) {
        const log = plainday.ErrorLog;
        if (!log) return;
        try {
            const on = ` (on ${this.deviceName()})`;
            const items = [];
            const mine = (kind, link, name) => items.push({ kind, link: `${link}${on}`, name });
            for (const c of report.notSynced) mine(c.problem === "dead" ? "Link stopped working" : "Calendar not synced", c.name, c.name);
            for (const e of report.failedEvents) {
                const name = `${e.title} (${e.calendar})`;
                mine("Event skipped", name, name);
            }
            const atDay = (kind, said) => {
                const date = String(said).slice(0, 10);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
                const name = this.dailyPath(date).split("/").pop().replace(/\.md$/, "");
                mine(kind, `[[${name}]]`, name);
            };
            for (const h of report.held) atDay("Held back changes", h);
            for (const k of report.skipped) atDay("Skipped lines", k);
            // The other devices' lines, as the log has them
            const file = app.vault.getFileByPath(log.path());
            const had = file ? log.sections(await app.vault.read(file)).get("Calendar sync")?.lines ?? new Map() : new Map();
            for (const [key, count] of had) {
                const cut = key.indexOf(" · ");
                const kind = key.slice(0, cut), link = key.slice(cut + 3);
                const device = link.match(/ \(on ([^()]+)\)$/);
                if (!device || ` (on ${device[1]})` === on) continue;
                for (let i = 0; i < count; i++) items.push({ kind, link, name: link });
            }
            log.toast("Calendar sync", await log.write("Calendar sync", log.group(items), { create: !app.isMobile }));
        } catch (e) {
            console.error("CalendarSync: couldn't update the error log", e);
        }
    }

    // What this device is called in the error log, until OBS-276 lets you name it
    deviceName() {
        if (Platform?.isIosApp) return Platform.isTablet ? "iPad" : "iPhone";
        if (Platform?.isAndroidApp) return Platform.isTablet ? "Android tablet" : "Android phone";
        if (Platform?.isMacOS) return "Mac";
        if (Platform?.isWin) return "Windows";
        if (Platform?.isLinux) return "Linux";
        return "this device";
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
            report.merged.length && `${report.merged.length} doubled line${report.merged.length === 1 ? "" : "s"} merged`,
            report.yours.length && `${report.yours.length} left for you`,
            report.held.length && `${report.held.length} held back`,
            report.skipped.length && `${report.skipped.length} skipped`,
        ].filter(Boolean);
        const none = report.notSynced.length > 0 && report.notSynced.length === report.calendarCount;
        const head = none ? "Calendar sync: nothing synced" : counts.length ? `Calendar sync: ${counts.join(", ")}` : "Calendar sync: nothing to change";
        const notes = [];
        if (report.notSynced.length) notes.push(`Not synced: ${report.notSynced.map((c) => `${c.name} (${CalendarSync.PROBLEMS[c.problem] ?? "couldn't be read"})`).join(", ")}`);
        if (report.failedEvents.length) notes.push(`${report.failedEvents.length} event${report.failedEvents.length === 1 ? "" : "s"} skipped, which the calendar sync can't read: see the error log`);
        return [head, ...notes].join(". ");
    }
}
