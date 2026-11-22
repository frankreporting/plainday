import { moment, Notice, Platform } from "obsidian";
import { app, plainday } from "../host.js";

export default class CalendarSync {
    // Writes calendar events into daily notes and keeps them current. A convention says which part of
    // an event line is whose, so the sync never has to guess (OBS-275, Part 2 of OBS-231's plan, 11/19):
    //
    //   - [<] 10:00am⇥Kestrel standup bring laptop ℹ️ [[Kestrel Outfitters 2026|⭕]] [[2026-09-16 Standup|⋯]] ^e-q7m2xk
    //   ⇥- 10:20am: a note after the end time
    //   ⇥- 10:00am - 10:20am
    //
    // - Plainday's: the box ([<], or [-] for an event gone from its calendar), the start, the title, and
    //   the time on the first line under a timed event (its end). Written from the event on every run, so
    //   a title or time edited by hand is written back, and a [-] goes back to [<] when its event returns.
    // - Yours: everything after the title on the line (⭕ and 🗃️ links, 🆓, ℹ️, the log link, words), kept
    //   exactly as you wrote it; anything after the end time's colon; every other line under it.
    // - Where the title ends: this device remembers the title it last wrote on each line, and the event's
    //   title as the calendar has it now does as well. A line that starts with neither (you edited the
    //   title) has your part start at your first link or mark (⭕, 🗃️, 🆓, ℹ️, a note link), and the words
    //   before it are written back as the title.
    // - The end time is the first line under a timed event, a time alone or with a note after a colon;
    //   when the first line is anything else, the end time is written above it. An all-day event, or one
    //   ending on a later day (an evening that runs past midnight aside), has none, so nothing under it
    //   is the sync's.
    // - ℹ️ (free time, not counted): a new line gets it right after its title when the calendar says the
    //   event is free. After that, the latest change wins: when the calendar switches the event between
    //   free and busy, ℹ️ is set to match; one you add or take off in between stays.
    // - The box is yours, as before Plainday: a new line gets [<], and the line is kept current whatever box
    //   you give it. The sync marks [<] lines [-] when their event is gone, and puts back [<] on a line
    //   it marked [-] when the event returns; a [-] you set yourself (an event you skipped) stays.
    // - The ID, last: `^e-` and six letters and digits worked out from the event's key (its UID, with the
    //   date it was due for one occurrence of a repeating event: lineId), so the line is found on any day
    //   with nothing kept in the vault. The `e-` sets it apart from a task's ID or a block link.
    //
    // So a line you delete comes back on the next run, and a line moves with its event to another day,
    // taking what's yours along; one with time entries under it is forwarded instead, and the new day's
    // line takes your part of it. An event moved further ahead than the range has its line removed,
    // unless time entries are under it, and comes back when its day is in range. A series split by a
    // "this and future events" edit keeps its lines (handOver). A new line for a recurring series gets
    // the series' ⭕ from the settings. Lines from before IDs (no ID at all) are taken over by their exact start and title, and a
    // log's line with no time (`- [<] Title [[log|⋯]]`, a new log writes one when the calendar has
    // no event of that title, OBS-10) by its title. A log a line links takes the line's times (fillLog).
    //
    // Where the events come from: every calendar in Settings → Plainday → Calendars that's on and has a
    // link on this device, downloaded and read by CalendarFeed. A calendar that's off, has no link here,
    // or couldn't be read this time is left out of the run, its lines left as they are. Nothing here
    // ever holds a calendar's link: a problem is said by the calendar's name. One device syncs (Settings'
    // syncHere, Brian 11/18); several devices is OBS-161.
    //
    // What this device remembers, in its own local storage (CACHE, this vault's, never synced): for each
    // line it has seen, its event and calendar (so a line whose event is gone from a calendar that read
    // fine can be marked [-]), the start, title and end time it last wrote there, whether the calendar
    // called the event free at the last sync, when it first read the event, and when a missing event was
    // first missed (a provider's copy of a calendar can lag behind an event just added, so one first read
    // less than MISSING_MS before is marked only when a second read, MISSING_MS on, still lacks it); and
    // recurring series' titles. A device without it marks nothing canceled that it
    // hasn't seen read before, and leaves every ℹ️ as it is.
    //
    // Notes are changed through app.vault.process, which reads and writes in one step, so this can't
    // overwrite what you're typing.
    static CACHE = "plainday-calendar-cache";
    static CACHE_VERSION = 3;
    // The last run's report on this device, for the window OBS-276 adds
    static LAST = "plainday-calendar-last";
    // How long an event must stay gone, across two reads, before its line is marked canceled
    static MISSING_MS = 10 * 60 * 1000;
    // How long the sync works before it hands the app a turn (breathe)
    static SLICE_MS = 5;
    // An event line's ID: ID_PREFIX, then ID_LENGTH letters and digits, from ID_SPACE (36^6) values. One
    // that another line of the note already uses steps to the next of ID_STEPS.
    static ID_PREFIX = "e-";
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
    // A line under an event that may be time worked, as TimeReport reads one or lists it under Problems
    // (a bullet or a number, then a time and a dash, a mistyped one included): a moved line with one
    // stays behind, forwarded, on the day the time was worked
    static ENTRYISH = /^\s+(?:[-*+]|\d+[.)])\s+\d{1,2}(?::\d{2})?\s?(?:[ap]m)?\s*[-–—]/i;
    // A ⭕ project link, or a 🗃️ area link (OBS-36), at the end of a title (a phone may add or
    // drop the U+FE0F)
    static PROJECT_LINK = /\s*\[\[[^[\]|]+\|\s*(?:⭕|🗃)️?\s*\]\]$/u;
    // Where your part of an event line starts when its title isn't one the sync knows (you edited it):
    // your first ⭕, 🗃️ or note link (⋯, or a ↗ read alike, OBS-208), or 🆓 or ℹ️, with the space before it
    static FIRST_MARK = /\s(?:\[\[[^[\]|]+\|\s*(?:⭕|🗃|⋯|↗)️?\s*\]\]|(?:🆓|ℹ)️?(?=\s|$))/u;
    // Note links anywhere in your part of a line, and one ending the run of links and marks that ends it
    static NOTE_LINKS = /\[\[[^[\]|]+\|\s*(?:⋯|↗)️?\s*\]\]/gu;
    static RUN_END = /\s+(?:\[\[[^[\]|]+\|\s*(?:⭕|🗃|⋯|↗)️?\s*\]\]|(?:🆓|ℹ)️?)$/u;
    // A title wrapped in a link to its log, the way lines were written before OBS-57:
    // `[[2026-09-16 Planning|Planning]]`. CalNav reads titles with this too. Only a link to a
    // log's name (its date first, LOG_NAME) is the event's log.
    static LOG_LINK = /^\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]$/;
    static LOG_NAME = /^\[\[(?:[^[\]|#]*\/)?\d{4}-\d{2}-\d{2} /;
    // A note link at the end of a line: an event's log, the way a task links its note (OBS-57).
    // ⋯ is written, and a ↗ is read alike (OBS-208); a phone may add or drop the U+FE0F after ↗. It
    // needs a space before it, so a title that is only a link keeps it.
    static NOTE_MARK = "⋯";
    static NOTE_LINK = /\s+\[\[[^[\]|]+\|\s*(?:⋯|↗️?)\s*\]\]$/u;
    // ℹ️ after the title marks an event you're free during (Show As: Free): not your time, so TimeReport
    // never counts it or checks it for overlaps (OBS-47). The sync writes it on timed events the
    // calendar shows as free; an all-day event has no time to count, so it gets none. Tentative and
    // unknown count as busy. A phone may leave out the U+FE0F. Whitespace before it, as TimeReport reads
    // it, so a title that simply ends in the character isn't one.
    static FREE_MARK = "ℹ️";
    static FREE = /\s+ℹ️?$/u;
    // 🆓 after the title is yours: TimeReport reads it as "don't bill this event's time" (OBS-24).
    // A phone may add U+FE0F.
    static NONBILLABLE_MARK = "🆓";
    static NONBILLABLE = /\s+🆓️?$/u;
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
        // would take it for part of the title and write the title back without it. It waits, changing
        // nothing, and the next run after the conversion picks everything up.
        const old = await plainday.TimeReport?.oldMarksLeft?.();
        if (old) return `${old} line${old === 1 ? " in the daily notes still ends" : "s in the daily notes still end"} in a 🗒️ or 🔗 link, so the calendar sync waits for the one-time conversion: see the manual's Links at the end of a line`;
        const settings = plainday.Settings;
        const calendars = settings.get().calendars.list;
        // With no calendars, nothing goes over the network
        if (!calendars.length) return "No calendars to sync yet: add one in Settings → Plainday → Calendars";
        // One device writes the events, and Sync brings them to the others (OBS-275; several, OBS-161)
        if (!settings.syncHere()) return "This device doesn't sync calendars. To sync them here, turn on Settings → Plainday → Calendars → Sync calendars using this device, and keep it off on your other devices.";
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
            await this.handOver(feed, selected, cache);
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

    // This device's cache (see the top): { version, lines: line ID → { key, uid, calendarId, date, title
    // (the title the sync last wrote on the line), free (whether the calendar called the event free at
    // the last sync that wrote it), start and end (the start and the end time it wrote, end false for
    // none), seen (when it first read the event), goneSince (when its event was first missed) },
    // seriesTitles: series ID → title, dead: calendar ID → true }. Anything that doesn't read starts
    // afresh: the device is then one without the cache, which is safe.
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
        const lines = {};
        for (const [lid, m] of Object.entries(fresh ? obj(r.lines) : {})) {
            if (m && typeof m === "object" && typeof m.key === "string" && typeof m.date === "string") lines[lid] = m;
        }
        return {
            version: CalendarSync.CACHE_VERSION,
            lines,
            seriesTitles: fresh ? obj(r.seriesTitles) : {},
            dead: fresh ? obj(r.dead) : {},
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

    // MARK: projects for recurring series

    // A "this and future events" edit gives the rest of a series a new ID: its occurrences vanish, and a
    // new series appears in the same places. An occurrence this device remembers a line for, gone from a
    // calendar read this time, and an occurrence of a repeating event it has no line for, on the same
    // calendar, day, start and end, are the same event: the new one takes over the old one's line, and
    // its series goes by the old one's title, so seriesProjects renames the series' project to it (as
    // the sync did before Plainday). Only places where one of each pairs up.
    async handOver(feed, selected, cache) {
        const today = moment().format("YYYY-MM-DD");
        const slot = (calendarId, date, start, end) => `${calendarId}|${date}|${start}|${end}`;
        const read = new Set();
        for (const event of feed.events) if (selected.has(event.calendarId) && event.status !== "canceled") read.add(`${event.calendarId}|${event.key}`);
        // The occurrences this device has a line for that the calendars read no longer have: usually none,
        // and then nothing else is looked at
        const gone = new Map();
        for (const [lid, m] of Object.entries(cache.lines)) {
            if (m.key === m.uid || !m.start || !selected.has(m.calendarId) || read.has(`${m.calendarId}|${m.key}`)) continue;
            const at = slot(m.calendarId, m.date, m.start, m.end);
            gone.set(at, gone.has(at) ? null : lid);
        }
        if (!gone.size) return;
        const known = new Set(Object.values(cache.lines).map((m) => m.key));
        const places = new Set([...gone.keys()].map((at) => at.split("|").slice(0, 2).join("|")));
        const fresh = new Map();
        for (const event of feed.events) {
            await this.breathe();
            if (!event.recurring || !places.has(`${event.calendarId}|${event.date}`) || event.date < today || known.has(event.key) || !read.has(`${event.calendarId}|${event.key}`)) continue;
            const lines = this.lines(event);
            const at = slot(event.calendarId, event.date, this.head(lines[0])?.start, lines.length > 1 ? lines[1].replace(/^\s*[-*+]\s+/, "").toLowerCase() : false);
            fresh.set(at, fresh.has(at) ? null : event);
        }
        const titles = cache.seriesTitles ?? {};
        for (const [at, lid] of gone) {
            const event = fresh.get(at), old = lid && cache.lines[lid];
            if (!old || !event || String(event.id) === old.uid) continue;
            if (titles[old.uid] && !titles[event.id]) titles[event.id] = titles[old.uid];
            const { goneSince: _, ...rest } = old;
            cache.lines[lid] = { ...rest, key: event.key, uid: String(event.id) };
        }
        cache.seriesTitles = titles;
    }

    // Returns series ID -> { links, key } for the series that have projects in Plainday's settings
    // (`calendars.recurring`: a series by the title of its next occurrence, with its ⭕ and 🗃️ links).
    // This device's cache remembers that title by series ID, so a series whose title changes (a
    // birthday with an age in it, say) has its entry renamed and keeps its project. Two series with the
    // same title share an entry. A series' links go on a line when the sync first writes it. Choosing a
    // series' projects in the panel comes with OBS-276; until then they're the ones already in
    // Plainday's settings.
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

    // An event's line ID from its key: `e-` and six letters and digits. `step` gives the next one, for an
    // ID another line already uses (stepped the same way on every device).
    lineId(key, step = 0) {
        const n = CalendarSync.hash(step ? `${key}#${step}` : String(key)) % CalendarSync.ID_SPACE;
        return CalendarSync.ID_PREFIX + n.toString(36).padStart(CalendarSync.ID_LENGTH, "0");
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

    // MARK: a run

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
        const inFeed = new Set();   // every event the calendars read have, whatever its day
        for (const event of feed.events) {
            if (!selected.has(event.calendarId) || event.status === "canceled") continue;
            inFeed.add(`${event.calendarId}|${event.key}`);
            if (upcoming(event.date) && !events.has(event.key)) events.set(event.key, event);
        }
        // Days gone by are none of the sync's business any more
        for (const [lid, m] of Object.entries(cache.lines)) if (!upcoming(m.date)) delete cache.lines[lid];

        // Where each event line is now, by its ID: every day from today to the window's end, and any
        // other day this device remembers a line on
        const { where } = await this.lineIndex(today, feed.windowEnd ?? today, Object.values(cache.lines).map((m) => m.date));
        const lids = await this.assignLids(events, cache, where);
        const claimed = new Set(lids.values());

        const plan = new Map();   // date -> operations
        const add = (date, op) => { if (!plan.has(date)) plan.set(date, []); plan.get(date).push(op); };
        // Each day's events by start and title, so a line from before IDs goes to the event it's for
        const onDay = new Map();
        for (const event of events.values()) {
            await this.breathe();
            const h = this.head(this.lines(event)[0]);
            if (!onDay.has(event.date)) onDay.set(event.date, []);
            onDay.get(event.date).push({ key: event.key, start: h?.start, title: h?.title });
        }
        // Each event read: its line on its day, written from the event with your part kept (writeEvent).
        // Its line on another day moves to it with your part, or is forwarded (leaveIn).
        for (const [key, event] of events) {
            await this.breathe();
            const lid = lids.get(key);
            const others = (where.get(lid) ?? []).filter((d) => d !== event.date);
            const title = this.title(event);
            const carry = others.length ? await this.carryFrom(others, lid, this.recalled(cache.lines[lid], key, title)) : null;
            const day = (onDay.get(event.date) ?? []).filter((e) => e.key !== key);
            add(event.date, { kind: "event", key, lid, event, title, lines: this.lines(event), carry, day, series: event.recurring ? series.get(event.id) ?? null : null });
            // What it found there: a line that's changed since stays, forwarded, rather than lose what's new
            for (const date of others) add(date, { kind: "leave", key, lid, to: event.date, title, expect: (carry?.parts ?? []).filter((p) => p.date === date && !p.staying).map((p) => p.raw) });
        }
        // Lines whose event this run didn't read. One whose event its calendar now has further ahead than
        // the range goes, and comes back when its day is in range (Brian, 11/19). One whose event is gone
        // from a calendar that read fine, on a day the read covered and not skipped by the reader, is
        // marked canceled: at once when this device first read the event at least MISSING_MS ago, else
        // once a read MISSING_MS after the one that first missed it still lacks it (a provider's copy of a
        // calendar can lag behind an event just added). Anything else (its calendar off, unread or
        // skipped, or a line this device has no memory of) is left as it is.
        for (const [lid, dates] of where) {
            if (claimed.has(lid)) continue;
            const m = cache.lines[lid];
            if (!m) continue;
            if (inFeed.has(`${m.calendarId}|${m.key}`)) { delete m.goneSince; continue; }
            if (read.has(m.calendarId) && outside.has(`${m.calendarId}|${m.key}`)) {
                for (const date of dates) add(date, { kind: "drop", key: m.key, lid, title: m.title });
                continue;
            }
            const known = read.has(m.calendarId) && !unread.has(`${m.calendarId}|${m.uid}`) && dates.every(covered);
            if (!known) continue;
            const settled = typeof m.seen === "number" && this.now() - m.seen >= CalendarSync.MISSING_MS;
            if (!settled) {
                if (!m.goneSince) { m.goneSince = this.now(); continue; }
                if (this.now() - m.goneSince < CalendarSync.MISSING_MS) continue;
            }
            for (const date of dates) add(date, { kind: "cancel", key: m.key, lid, title: m.title });
        }

        // Each event's line first; then the lines it moved from, once its new line is in place, and the
        // canceled ones. `wrote`: the sync's part of each event's line as it's written now (writeEvent),
        // for the cache; `placed`: each event's line ID where its line is in place; `canceled`: the lines
        // this run marked [-], remembered so their [<] comes back with their event; `done`: what each
        // event's line came to (tell).
        const ctx = { cache, wrote: new Map(), placed: new Map(), canceled: new Set(), done: [] };
        const pass = async (wanted) => {
            for (const date of [...plan.keys()].sort()) {
                const ops = plan.get(date).filter(wanted);
                if (!ops.length) continue;
                await this.breathe();
                try {
                    await this.applyToNote(date, ops, ctx, report);
                } catch (e) {
                    console.error(`CalendarSync: ${date}`, e);
                    report.skipped.push(`${date}: ${e.message}`);
                }
            }
        };
        await pass((op) => op.kind === "event");
        await this.tell(ctx.done, report);
        const waiting = new Set();
        for (const ops of plan.values()) {
            for (const op of ops) {
                if (op.kind !== "leave" || ctx.placed.has(op.key) || waiting.has(op.key)) continue;
                waiting.add(op.key);
                report.skipped.push(`${op.to} ${op.title}: couldn't write its line on its new day, so the old one stays where it is`);
            }
        }
        await pass((op) => op.kind === "cancel" || op.kind === "drop" || (op.kind === "leave" && ctx.placed.has(op.key)));

        // What this device remembers from here: each event line it has seen, and the lines of events gone
        // from their calendars, which keep the time they were first missed. The title, free or busy and
        // end time are what the sync wrote on the line: a line it didn't write (one you'd marked another
        // way, or one that couldn't be written) keeps what was remembered of it.
        const lines = {};
        for (const [key, event] of events) {
            const lid = ctx.placed.get(key) ?? (where.has(lids.get(key)) ? lids.get(key) : null);
            if (!lid) continue;
            const old = cache.lines[lid]?.key === key ? cache.lines[lid] : null;
            const now = ctx.wrote.get(key) ?? old ?? {};
            const m = { key, uid: String(event.id ?? ""), calendarId: event.calendarId, date: ctx.placed.has(key) ? event.date : where.get(lid)[0], seen: old?.seen ?? this.now() };
            for (const k of ["title", "free", "end", "start"]) if (now[k] !== undefined) m[k] = now[k];
            lines[lid] = m;
        }
        for (const [lid, dates] of where) if (!claimed.has(lid) && cache.lines[lid]) lines[lid] = { ...cache.lines[lid], date: dates[0], ...(ctx.canceled.has(lid) ? { canceled: true } : {}) };
        cache.lines = lines;
        return report;
    }

    // Where each event line is, by its ID: { where: Map(lid → [dates, earliest first]), yours: the IDs
    // on a line marked another way ([x], [!]) }, from the daily notes from `from` through `to` and on
    // `also`. Read from the notes themselves, which are ahead of Obsidian's index right after a write.
    // A forwarded line carries no ID.
    async lineIndex(from, to, also = []) {
        const days = new Set(also.filter((d) => typeof d === "string" && d >= from));
        for (let d = from; d <= to; d = this.addDays(d, 1)) days.add(d);
        const where = new Map();
        for (const date of [...days].sort()) {
            await this.breathe();
            const file = app.vault.getFileByPath(this.dailyPath(date));
            if (!file) continue;
            const text = await (app.vault.cachedRead ?? app.vault.read).call(app.vault, file);
            for (const raw of text.split("\n")) {
                const line = raw.replace(/\r$/, "");
                const lid = line.includes("^") && this.topEvent(line) ? this.lidIn(line) : null;
                if (!lid) continue;
                if (!where.has(lid)) where.set(lid, []);
                const list = where.get(lid);
                if (list[list.length - 1] !== date) list.push(date);
            }
        }
        return { where };
    }

    // YYYY-MM-DD, `n` days on
    addDays(date, n) {
        const [y, m, d] = date.split("-").map(Number);
        const t = new Date(Date.UTC(y, m - 1, d + n));
        return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
    }

    // Each event's line ID: the one this device saw its line with, while a line still has it; else the
    // first of its IDs a line already has (it may have stepped past a task's ID in its note), else its
    // first. Two events in this run whose keys give one ID are told apart: the later key, in sorted
    // order, steps on, the same on every device.
    async assignLids(events, cache, where) {
        const seen = new Map(Object.entries(cache.lines).map(([lid, m]) => [m.key, lid]));
        const out = new Map(), used = new Set();
        for (const key of [...events.keys()].sort()) {
            await this.breathe();
            const known = seen.get(key);
            const first = this.lineId(key);
            let lid;
            if (known && where.has(known) && !used.has(known)) lid = known;
            else if (where.has(first) && !used.has(first)) lid = first;
            else {
                const ids = this.lineIds(key);
                lid = ids.find((id) => where.has(id) && !used.has(id)) ?? ids.find((id) => !used.has(id)) ?? ids[0];
            }
            used.add(lid);
            out.set(key, lid);
        }
        return out;
    }

    // What a moved event's lines on other days bring to its new line: { parts: [parseBlock's block, with
    // its date, its text (raw) and whether it will stay behind, forwarded (staying), with what's under
    // it, when it brings only your part of its line] }. `recall`: what this device remembers (recalled).
    async carryFrom(dates, lid, recall = {}) {
        const parts = [];
        for (const date of dates) {
            const file = app.vault.getFileByPath(this.dailyPath(date));
            if (!file) continue;
            const lines = (await app.vault.read(file)).split("\n").map((l) => l.replace(/\r$/, ""));
            for (const at of this.blocksWith(lines, lid)) {
                const raw = lines.slice(at.from, at.to + 1);
                const block = this.parseBlock(raw, recall);
                if (!block.head) continue;
                const staying = this.staysBehind(lines, at, block);
                parts.push({ ...(staying ? { head: block.head, groups: [], end: null } : block), date, raw: raw.join("\n"), staying });
            }
        }
        return { parts };
    }

    // `ctx`: the run's { cache, wrote, placed } (apply)
    async applyToNote(date, ops, ctx, report) {
        const path = this.dailyPath(date);
        let file = app.vault.getFileByPath(path);
        if (!file) {
            // Nothing to move or mark where there's no note; an event's line makes one
            if (!ops.some((op) => op.kind === "event")) return;
            file = await this.createDaily(date);
        }
        const before = await app.vault.read(file);
        // A pass over what's on disk decides whether anything needs writing at all, so a note that's
        // already right isn't rewritten (which would churn through Sync every run)
        let { text, outcomes } = this.runOps(before, ops, ctx);
        let after = before;
        if (text !== before) {
            // Keep the folds you have: snapshot first, and let RefoldDailyNotes sort out the rest
            plainday.RefoldDailyNotes?.remember(file, before, this.currentFolds(file, before));
            await this.breathe();
            // Worked out again only if the note changed since it was read (you typed in it meanwhile)
            const read = before;
            await app.vault.process(file, (now) => {
                if (now !== read) ({ text, outcomes } = this.runOps(now, ops, ctx));
                return text;
            });
            await this.breathe();
            after = await app.vault.read(file);   // read back what actually landed
            await plainday.RefoldDailyNotes?.refold(file, "open");
        }
        const lines = after.split("\n").map((l) => l.replace(/\r$/, ""));
        for (const result of outcomes) {
            await this.breathe();
            await this.record(date, result, lines, ctx, report);
        }
    }

    // Applies the operations to `text` in order, each seeing the one before it: { text, outcomes }
    runOps(text, ops, ctx = { cache: { lines: {} } }) {
        // A CRLF note is read without its CRs, and keeps them
        const cr = String(text).includes("\r\n");
        let lines = String(text).split("\n").map((l) => l.replace(/\r$/, ""));
        const outcomes = [];
        for (const op of ops) {
            const result = op.kind === "event" ? this.writeEvent(lines, op, ctx) : op.kind === "leave" ? this.leaveIn(lines, op) : op.kind === "drop" ? this.dropIn(lines, op) : this.cancelIn(lines, op);
            lines = result.lines;
            const { lines: _, ...rest } = result;
            outcomes.push({ op, ...rest });
        }
        return { text: lines.join(cr ? "\r\n" : "\n"), outcomes };
    }

    // An event's line in a note, written from the event with your part kept (see the top): its copies
    // here (two lines with its ID, copied by hand, say) become one, with everything under any of them;
    // a moved line's part comes along (`op.carry`). With no line, a line from before IDs or a log's line
    // with no time is taken over, else one is written, in time order, with a series' ⭕ (`op.series`).
    // Returns { lines, outcome, lid, changed, differs, wrote }: outcome is added, adopted, updated,
    // restored, merged, moved (written from its line on another day), present (as it was) or left
    // (yours); wrote is what the sync's part of the line is now ({ title, free, end }), for the cache.
    writeEvent(lines, op, ctx = {}) {
        let found = this.blocksWith(lines, op.lid);
        let adopted = false;
        if (!found.length) {
            const old = this.adoptable(lines, op.lines, op.day, op.title);
            if (old) { found = [old]; adopted = true; }
        }
        // What this device remembers of the line; nothing for a line taken over, which had no ID
        const memory = adopted ? null : ctx.cache?.lines?.[op.lid] ?? null;
        const recall = this.recalled(memory, op.key, op.title);
        const copies = found.map((at) => ({ at, ...this.parseBlock(lines.slice(at.from, at.to + 1), recall) }));
        // A line taken over steps past an ID another line of the note ends in, as a new line does
        const lid = copies.length && !adopted ? op.lid : this.freeLid(lines, op.key, op.lid);
        if (copies.some((c) => !c.head)) return { lines, outcome: "left" };
        const sources = [...copies, ...(op.carry?.parts ?? [])];
        // The box stays as you set it, on the line or the one it moved from; a [-] the sync wrote goes
        // back to [<] now its event is here, and a forwarded line's new line starts [<]
        const had = copies[0]?.head.box ?? (op.carry?.parts ?? []).find((p) => !p.staying)?.head.box ?? "<";
        const box = had === "-" && memory?.canceled ? "<" : had;
        const part = this.partOf(sources);
        const start = this.head(op.lines[0])?.start;
        const free = op.event ? op.event.availability === "free" : this.splitTail(op.lines[0].slice(op.lines[0].indexOf("\t") + 1)).free;
        // A new line: the event's own (ℹ️ after the title when it's free) and a series' ⭕. A line already
        // there: your part as you wrote it, with ℹ️ set to match when the calendar has switched a timed
        // event between free and busy since the last sync that wrote the line (the latest change wins)
        let tail = part.tail, flipped = null;
        if (!sources.length) tail = op.series?.links?.length ? ` ${op.series.links.join(" ")}` : "";
        else if (start !== "all day" && typeof memory?.free === "boolean" && memory.free !== free) {
            flipped = free ? "free" : "busy";
            tail = !free ? this.dropFree(tail) : this.hasFree(tail) ? tail : this.addFree(tail);
        }
        const block = this.blockFor(op.lines, lid, { title: op.title, tail, box, fresh: !sources.length }, sources);
        const wrote = { title: op.title, free, start, end: op.lines.length > 1 ? op.lines[1].replace(/^\s*[-*+]\s+/, "").toLowerCase() : false };

        let out;
        if (!copies.length) out = this.insert(lines, block).split("\n");
        else {
            out = [...lines];
            for (const { at } of [...copies].reverse()) out.splice(at.from, at.to - at.from + 1);
            const first = copies[0].at;
            // Where it was, unless its time moved it among the day's events (lines of yours below a blank
            // line under it would be left under another line, so it stays put then)
            if (this.same(this.rank(block[0]), this.rank(lines[first.from])) || this.detached(lines, first)) out.splice(first.from, 0, ...block);
            else out = this.insert(out, block).split("\n");
        }
        if (out.join("\n") === lines.join("\n")) return { lines, outcome: "present", lid, differs: part.differs, wrote };

        const changed = [];
        const was = copies[0];
        if (adopted && !was.head.start) changed.push("time added");
        else if (was && !adopted) {
            const end = (op.lines[1] ?? "").replace(/^\s*[-*+]\s+/, "").toLowerCase() || null;
            const timed = was.head.start !== start || (was.end?.time ?? null) !== end;
            if (timed && sources.some((s) => s.entries)) changed.push("time changed; check its time entries");
            if (flipped && this.hasFree(was.head.tail) !== this.hasFree(tail)) changed.push(`now ${flipped}`);
        }
        const outcome = adopted ? "adopted"
            : copies.length > 1 ? "merged"
                : !copies.length ? (sources.length ? "moved" : "added")
                    : copies[0].head.box === "-" && box === "<" ? "restored" : "updated";
        return { lines: out, outcome, lid, changed, differs: part.differs, wrote };
    }

    // What this device remembers of a line, for reading it (parseBlock): the titles it may start with
    // (the one the sync last wrote on it, then the event's own), whether it was written with no end time
    // under it (endless), and the end time it was written with (endAt)
    recalled(memory, key, title) {
        const m = memory?.key === key ? memory : null;
        return { titles: [...new Set([m?.title, title].filter(Boolean))], endless: m?.end === false, endAt: typeof m?.end === "string" ? m.end : null };
    }

    // A moved event's line on the day it left: it goes, its part of yours now on the new day's line, or
    // it's forwarded there when time entries are under it (or lines of yours below a blank line), which
    // stay with it. One that changed since the run read it (`op.expect`: you typed under it meanwhile)
    // is forwarded too, so nothing new is lost. A line marked another way stays. `outcome`: moved,
    // forwarded or gone (not there).
    leaveIn(lines, op) {
        let out = [...lines], outcome = "gone";
        for (;;) {
            const at = this.blocksWith(out, op.lid)[0];
            if (!at) break;
            const raw = out.slice(at.from, at.to + 1);
            const block = this.parseBlock(raw);
            if (this.staysBehind(out, at, block) || !(op.expect ?? []).includes(raw.join("\n"))) {
                out = this.forward(out, at, op.to).split("\n");
                outcome = "forwarded";
            } else {
                out.splice(at.from, at.to - at.from + 1);
                if (outcome === "gone") outcome = "moved";
            }
        }
        return { lines: out, outcome };
    }

    // An event moved further ahead than the range: its line goes, with what's under it, and comes back
    // when its day is in range. One with time entries under it stays as it is, since they're time worked
    // there. A line marked another way stays. `outcome`: removed, or present (nothing to remove).
    dropIn(lines, op) {
        let out = [...lines], outcome = "present";
        for (const at of this.blocksWith(lines, op.lid).reverse()) {
            if (this.staysBehind(lines, at, this.parseBlock(lines.slice(at.from, at.to + 1)))) continue;
            out.splice(at.from, at.to - at.from + 1);
            outcome = "removed";
        }
        return { lines: out, outcome };
    }

    // A gone event's lines marked [-], kept as a record of what was planned, whatever is under them; a
    // line marked another way stays. `outcome`: canceled, or present (nothing to mark).
    cancelIn(lines, op) {
        const out = [...lines];
        let outcome = "present";
        for (const at of this.blocksWith(out, op.lid)) {
            const line = out[at.from].replace(/^([-*+]\s+)\[<\]/, "$1[-]");
            if (line !== out[at.from]) { out[at.from] = line; outcome = "canceled"; }
        }
        return { lines: out, outcome };
    }

    // What one operation did, into the report; for an event, whether its line is in place (ctx.placed),
    // and its log's times
    async record(date, result, after, ctx, report) {
        const { op, outcome } = result;
        const at = `${date} ${op.title}`;
        if (op.kind === "leave") {
            if (outcome === "moved") report.moved.push(`${date} → ${op.to} ${op.title}`);
            else if (outcome === "forwarded") report.forwarded.push(`${date} → ${op.to} ${op.title}`);
            return;
        }
        if (op.kind === "cancel") {
            if (outcome === "canceled") { report.canceled.push(at); ctx.canceled?.add(op.lid); }
            return;
        }
        if (op.kind === "drop") {
            if (outcome === "removed") report.removed.push(`${at} (moved past the sync range)`);
            return;
        }
        if (outcome === "left") return;
        const found = this.blocksWith(after, result.lid);
        if (!found.length) {
            report.skipped.push(`${at}: the line didn't land, will try again next run`);
            return;
        }
        ctx.placed.set(op.key, result.lid);
        if (result.wrote) ctx.wrote?.set(op.key, result.wrote);
        // Said once every line is in place, when its log has its times (tell)
        const head = this.parseHead(after[found[0].from], [op.title]);
        ctx.done?.push({ date, at, op, result, log: head?.notes[0] ?? null });
    }

    // What an event's line came to, into the report, once its log (if one line alone links it) has the
    // line's times. A log more than one event line links (one kept across a series' events, say)
    // keeps its own: which line's times it should have would be a guess.
    async tell(done, report) {
        const links = new Map();
        for (const d of done) if (d.log) links.set(d.log, (links.get(d.log) ?? 0) + 1);
        for (const { date, at, op, result, log } of done) {
            const { outcome } = result;
            const changed = [...(result.changed ?? [])];
            if (log && links.get(log) === 1 && await this.fillLog(log, op.lines, date)) changed.push("log times updated");
            const said = changed.length ? `${at} (${changed.join("; ")})` : at;
            if (outcome === "added") report.added.push(said);
            else if (outcome === "adopted") report.adopted.push(said);
            else if (outcome === "restored") report.restored.push(said);
            else if (outcome === "merged") report.merged.push(result.differs ? `${said} — the copies had different links, so the first one's are kept` : said);
            // A line written from its line on another day is said once, where it moved from (leaveIn)
            else if (outcome === "updated" || (outcome === "present" && changed.length)) report.updated.push(said);
            if (result.differs && outcome !== "merged") report.merged.push(`${at} — its line on another day had different links, so this one's are kept`);
        }
    }

    // `want`, or the next of `key`'s IDs, when another line of the note that isn't an event line
    // already ends in it
    freeLid(lines, key, want) {
        if (!lines.some((l) => l.includes(want))) return want;
        const taken = new Set(lines.filter((l) => !this.head(l)).map((l) => this.lidOf(l)).filter(Boolean));
        if (!taken.has(want)) return want;
        return this.lineIds(key).find((id) => !taken.has(id)) ?? want;
    }

    // MARK: reading an event line

    // The sync's own boxes: [<], and [-] for an event gone from its calendar. Any other is yours.
    ours(box) {
        return box === "<" || box === "-";
    }

    // Whether a moved event's line stays behind, forwarded: time entries are under it, or lines of
    // yours below a blank line under it, which would be left under another line
    staysBehind(lines, at, block) {
        return block.entries || lines.slice(at.from + 1, at.to + 1).some((l) => CalendarSync.ENTRYISH.test(l)) || this.detached(lines, at);
    }

    // The blocks of the event lines whose ID is `lid`, in order: at the left edge, with the ID at the
    // end or links or words typed after it
    blocksWith(lines, lid) {
        const out = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line.includes(lid) || !this.topEvent(line) || this.lidIn(line) !== lid) continue;
            const at = this.blockAt(lines, i);
            out.push(at);
            i = at.to;
        }
        return out;
    }

    // A line with no ID an event takes over (lines from before IDs): one with the start and title the
    // sync writes, exactly; else a log's line with no time and the event's title, when no other event
    // that day has it (`day`: [{ start, title }]). At the left edge only: a nested line is a subtask. Not
    // a line marked [-] (a gone event's line isn't another's to take), and not one with any ID: an
    // event's, a task's, or a block link of yours.
    adoptable(lines, eventLines, day = [], title = null) {
        const wanted = this.head(eventLines[0]);
        if (!wanted) return null;
        let same = null, log = null;
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            if (!/^[-*+]\s+\[(?!-)/.test(l) || this.lidIn(l)) continue;
            if (l.includes("\t")) {
                if (same !== null) continue;
                const head = this.head(l);
                // The event's title at the start, then anything of yours, as on every line (splitTitle); not a
                // line whose title is another of that time's events'
                const m = head && head.start === wanted.start && l.match(/\t(.*)$/);
                if (m && this.splitTitle(this.bare(m[1]), [title ?? wanted.title]).title === (title ?? wanted.title) && !day.some((e) => e.start === head.start && e.title === head.title && head.title !== wanted.title)) same = i;
            } else if (log === null && l.includes("[[") && this.logLine(l)?.shown === wanted.title) log = i;
        }
        if (same !== null) return this.blockAt(lines, same);
        if (log !== null && !day.some((e) => e.title === wanted.title)) return this.blockAt(lines, log);
        return null;
    }

    // An event line taken apart by whose part is whose (see the top): { box, start, title (the
    // calendar's, as the line has it), tail (yours: everything after the title, as you wrote it, from the
    // space before it, its ID left out), notes (its note links, as the sync writes them), free (an ℹ️ in
    // your part), lid }, or null when it isn't one. `titles`: the titles the line may start with
    // (splitTitle).
    parseHead(line, titles = []) {
        const lid = this.lidIn(line);
        const text = lid ? String(line).replace(new RegExp(`\\s\\^${lid}(?=\\s|$)`, "i"), "") : String(line);
        const m = text.match(/^\s*[-*+]\s+\[(.)\]\s+((?:all day|\d{1,2}:\d{2}\s?[ap]m))\t(.*)$/i);
        if (!m) return null;
        const { title, tail } = this.splitTitle(m[3], titles);
        return { box: m[1], start: m[2].toLowerCase(), title, tail, ...this.marksOf(tail), lid };
    }

    // Where the title ends in an event line's text after its tab: { title, tail }. When the text starts
    // with one of `titles` (what the sync last wrote there, the event's own), followed by anything but a
    // letter or digit (`Planning, bring laptop`; `Planning:`), everything after it is yours, exactly as
    // typed. Otherwise your part starts at your first link or mark (FIRST_MARK),
    // and the words before it are taken for the title. A title wrapped in a link to its log, from before
    // OBS-57, reads as its title, and the log link goes last in your part, as the sync writes one.
    splitTitle(text, titles = []) {
        let body = String(text).trimEnd();
        let log = "";
        const wrapped = body.startsWith("[[") ? body.match(/^\[\[[^[\]]+\]\]/)?.[0] : null;
        const parts = wrapped && CalendarSync.LOG_NAME.test(wrapped) ? wrapped.match(CalendarSync.LOG_LINK) : null;
        if (parts) {
            log = ` ${this.noteLink(wrapped)}`;
            body = `${(parts[2] ?? parts[1]).trim()}${body.slice(wrapped.length)}`;
        }
        for (const t of titles) {
            if (t && body.startsWith(t) && !/^[\p{L}\p{N}]/u.test(body.slice(t.length))) return { title: t, tail: body.slice(t.length) + log };
        }
        const at = body.search(CalendarSync.FIRST_MARK);
        return at === -1 ? { title: body.trim(), tail: log } : { title: body.slice(0, at).trim(), tail: body.slice(at) + log };
    }

    // The note links and whether there's an ℹ️ in your part of a line
    marksOf(tail) {
        return { notes: [...String(tail).matchAll(CalendarSync.NOTE_LINKS)].map((m) => this.noteLink(m[0])), free: this.hasFree(tail) };
    }

    hasFree(tail) {
        return /(?:^|\s)ℹ️?(?=\s|$)/u.test(String(tail));
    }

    // Your part of a line with every ℹ️ taken out
    dropFree(tail) {
        return String(tail).replace(/\s+ℹ️?(?=\s|$)/gu, "");
    }

    // Your part of a line with ℹ️ added at the start of the run of links and marks that ends it, after
    // your last word: the time report reads ℹ️ only there (OBS-90), and on a line of links alone that's
    // right after the title
    addFree(tail) {
        const text = String(tail);
        let at = text.length;
        for (let m; (m = text.slice(0, at).match(CalendarSync.RUN_END));) at = m.index;
        return `${text.slice(0, at)} ${CalendarSync.FREE_MARK}${text.slice(at)}`;
    }

    // An event line's block taken apart: { head (parseHead, or a log's line with no time), groups: the
    // lines under it but the end time, each with the lines nested under it, in order (a blank line goes
    // with the group above it); end: { time, note (what follows the time: `: …`), line (as it was), under
    // (lines nested under it) } or null; entries: whether time entries are under it }. `titles` and
    // `endless` and `endAt` come from what this device remembers (recalled). The end time is the end
    // time this device wrote there, on a line one tab in, alone or with a note after a colon, wherever it
    // is among the lines under it (you may have typed a line above it); else the first line under a timed
    // line, one tab in, holding a time alone or a time and a note. Under an all-day line, or one this
    // device wrote with no end time, nothing is the sync's.
    parseBlock(block, { titles = [], endless = false, endAt = null } = {}) {
        let head = this.parseHead(block[0], titles);
        if (!head) {
            const log = this.logLine(block[0]);
            if (log) head = { box: "<", start: null, title: log.shown, tail: log.tail, notes: [log.log], free: this.hasFree(log.tail), lid: null };
        }
        const groups = [];
        let base = null;
        for (const line of block.slice(1)) {
            if (line.trim() === "") {
                if (groups.length) groups[groups.length - 1].push(line);
                else groups.push([line]);
                continue;
            }
            const width = this.indentWidth(line);
            if (base === null || width <= base) {
                base ??= width;
                groups.push([line]);
            } else groups[groups.length - 1].push(line);
        }
        let end = null;
        const first = groups.findIndex((g) => g[0].trim() !== "");
        const timed = !!head?.start && head.start !== "all day" && !endless;
        const endOf = (g) => (this.indentWidth(g[0]) === 4 ? g[0].match(CalendarSync.END_LINE) : null);
        const timeOf = (m) => m[1].replace(/^\s*[-*+]\s+/, "").toLowerCase();
        let at = timed && endAt ? groups.findIndex((g) => { const m = endOf(g); return m && timeOf(m) === endAt; }) : -1;
        if (at === -1 && timed && first !== -1 && endOf(groups[first])) at = first;
        if (at !== -1) {
            const m = endOf(groups[at]);
            const [line, ...under] = groups[at];
            end = { time: timeOf(m), note: m[2] ?? "", line, under };
            groups.splice(at, 1);
        }
        const entries = groups.some((g) => CalendarSync.ENTRY.test(g[0].match(/^\s+[-*+]\s+(.*)$/)?.[1]?.trim() ?? ""));
        return { head, groups, end, entries };
    }

    // Your part of an event's line, from its copies in order: the first that has one. `differs` when
    // another copy's is different.
    partOf(sources) {
        const norm = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
        const tail = sources.map((s) => s.head.tail ?? "").find((t) => norm(t)) ?? "";
        return { tail, differs: sources.some((s) => norm(s.head.tail) && norm(s.head.tail) !== norm(tail)) };
    }

    // An event's block as the sync writes it: its line (`part`: the title and your part, or for a new
    // line the event's own with a series' ⭕) with its ID last; the end time first under it, with the
    // first note any copy had after its colon (another copy's different note goes under it as a line of
    // its own); then what was under its copies, in order: a group under a later copy that's the same as
    // one under an earlier copy is there once (two the same under one copy both stay). With no end time
    // now (all day, or ending on a later day), an end line with a note stays as it was, and a bare one
    // goes.
    blockFor(eventLines, lid, part, sources) {
        const first = eventLines[0];
        const tab = first.indexOf("\t");
        const tail = part.tail ?? "";
        const box = (l) => l.replace(/^(\s*[-*+]\s+)\[<\]/, `$1[${part.box ?? "<"}]`);
        const line = part.fresh ? `${first}${tail}` : box(`${first.slice(0, tab)}\t${part.title}${tail}`);
        const groups = [], seen = new Set(), notes = [], noted = [], under = [];
        const said = (n) => n.replace(/^\s*:?\s*/, "");
        for (const s of sources) {
            const mine = [];
            for (const g of s.groups) if (!seen.has(g.join("\n"))) mine.push(g);
            groups.push(...mine);
            for (const g of mine) seen.add(g.join("\n"));
            if (!s.end) continue;
            for (const l of s.end.under) if (!under.includes(l)) under.push(l);
            if (said(s.end.note) && !notes.some((n) => said(n) === said(s.end.note))) { notes.push(s.end.note); noted.push(s.end.line); }
        }
        const end = eventLines.length > 1
            ? [eventLines[1] + (notes[0] ?? ""), ...notes.slice(1).map((n) => `\t- ${said(n)}`), ...under]
            : [...noted, ...under];
        return [`${line.trimEnd()} ^${lid}`, ...end, ...groups.flat()];
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
        // Most lines of a long note are neither: tell them cheaply
        if (!line.includes("\t")) return line.includes("[<]") && this.timeless(line) ? [2, 0, ""] : null;
        const match = this.bare(line).match(/^\s*[-*+]\s+\[[^\] ]\]\s+(?:(all day)|(\d{1,2}):(\d{2})\s?([ap]m))\t(.*)$/i);
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
        // A note just made from a template that Templater hasn't run yet holds raw code (`<%`), which
        // becomes its properties: above it, the events would end up above them (Schedule.placeInTopList)
        if (/^\s*<%/.test(lines.join("\n"))) {
            const body = lines.join("\n").replace(/\s+$/, "");
            return `${body}\n${block.join("\n")}\n`;
        }
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
        at = this.pastDetached(lines, at);
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
        moved[0] = bare.replace(/^(\s*[-*+]\s+)\[[^\]]\]\s+/, `$1[>] ${this.dayLink(date)} `);
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
        at = this.pastDetached(without, at);
        return [...without.slice(0, at), ...moved, ...without.slice(at)].join("\n");
    }

    // The block a line starts: it and the indented lines under it, and those below a blank line that
    // are still indented (the time report reads them as the line's too), so they move with it
    blockAt(lines, from) {
        let to = from;
        for (;;) {
            while (to + 1 < lines.length && /^\s/.test(lines[to + 1]) && lines[to + 1].trim() !== "") to++;
            const past = this.pastDetached(lines, to + 1);
            if (past === to + 1) return { from, to };
            to = past - 1;
        }
    }

    // Where an insert at `at` goes so as not to come between a block and its lines below a blank line:
    // past blank lines followed by indented ones, and those lines
    pastDetached(lines, at) {
        let k = at;
        while (k < lines.length && lines[k].trim() === "") k++;
        if (k === at || k >= lines.length || !/^\s+\S/.test(lines[k])) return at;
        while (k < lines.length && /^\s+\S/.test(lines[k])) k++;
        return this.pastDetached(lines, k);
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

    // An event line with no time: `- [<] Title [[log|⋯]]`, which a new log writes for a
    // log whose event the calendar doesn't have (OBS-10). Sorts after the timed events.
    timeless(line) {
        return /^\s*[-*+]\s+\[<\]\s+(?!(?:all day|\d{1,2}:\d{2}\s?[ap]m)\t)\S/i.test(line);
    }

    // A timeless line that links a log, at the end or (from before OBS-57) around its title, taken
    // apart: { log, shown, projects, free, nonbillable, tail (yours: everything after the title, the log
    // link last) }. Null for any other line.
    logLine(line) {
        if (!this.timeless(line)) return null;
        const text = this.bare(line).replace(/^\s*[-*+]\s+\[<\]\s+/, "").trimEnd();
        const { rest, projects, free, nonbillable, log } = this.splitTail(text, true);
        if (log) return { log: this.noteLink(log), shown: rest, projects, free, nonbillable, tail: text.slice(rest.length) };
        const wrapped = CalendarSync.LOG_NAME.test(rest) && rest.match(CalendarSync.LOG_LINK);
        return wrapped ? { log: this.noteLink(rest), shown: (wrapped[2] ?? wrapped[1]).trim(), projects, free, nonbillable, tail: `${text.slice(rest.length)} ${this.noteLink(rest)}` } : null;
    }

    // MARK: what you add to an event line

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
    // A title ending in ℹ️ or 🆓 would read as the marks, or in ` ^v2` as a block ID, and the line
    // would never read the same again
    title(event) {
        return (event.title || "").replace(/\s+/g, " ").replace(/(?:\s+(?:(?:🆓|ℹ)\uFE0F?|\^[A-Za-z0-9-]+))+$/u, "").trim() || "(untitled)";
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
    // its event reached the calendar, or whose event was retimed or moved, says when the event
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

    // A event log, as AddTaskNote.isLog and MoveToProject know one: filed in a `›logs` folder
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

    // A day's note for an event's line, made as every periodic note is made (PeriodicNotes.ensure): its alias,
    // then its template
    async createDaily(date) {
        return plainday.PeriodicNotes.ensure("day", date);
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

    // MARK: the report

    newReport() {
        return {
            added: [], adopted: [], updated: [], restored: [], moved: [], forwarded: [], canceled: [], removed: [], merged: [], skipped: [],
            // Calendars this run couldn't sync: [{ id, name, problem }]; events the reader couldn't read:
            // [{ calendarId, calendar, uid, title }]
            notSynced: [], failedEvents: [],
        };
    }

    // The error log's calendar section (OBS-218): a calendar whose link stopped working, or that
    // couldn't be synced this time, by its name; an event the reader couldn't read, by its title and
    // calendar, so you can find it; and lines it couldn't write, at their daily note. Each line names
    // the device it's about, since a link is on one device and each device reads for itself: a run
    // writes this device's lines and keeps the other devices' as they are. The log's own rule toasts
    // only what's new, so a calendar that keeps failing says so once. Never a link: a calendar is named.
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
            for (const k of report.skipped) {
                const date = String(k).slice(0, 10);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
                const name = this.dailyPath(date).split("/").pop().replace(/\.md$/, "");
                mine("Skipped lines", `[[${name}]]`, name);
            }
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
            // The log is made only when there's something to put in it, and only on a desktop
            log.toast("Calendar sync", await log.write("Calendar sync", log.group(items), { create: !app.isMobile && items.length > 0 }));
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
            report.restored.length && `${report.restored.length} restored`,
            report.moved.length && `${report.moved.length} moved`,
            report.forwarded.length && `${report.forwarded.length} forwarded`,
            report.canceled.length && `${report.canceled.length} canceled`,
            report.removed.length && `${report.removed.length} removed`,
            report.merged.length && `${report.merged.length} doubled line${report.merged.length === 1 ? "" : "s"} merged`,
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
