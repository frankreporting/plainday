import { requestUrl } from "obsidian";
import { calendarWorkerSource } from "../host.js";

export default class CalendarFeed {
    // Downloads a calendar's private link (Google's secret address, iCloud's public calendar link,
    // Outlook's published calendar) and has it read into the events the calendar sync writes into
    // daily notes, in the shape the Mac's fetcher wrote to calendar-events.json, so the sync's
    // apply() takes them as they are (OBS-274; part 1 of OBS-231's plan). Settings → Plainday's
    // Add calendar checks a link with it (check()); OBS-275 wires it into Sync calendars.
    //
    //   const window = feed.window(62);
    //   const got = await feed.load(link, { calendar: { id, name, account, address }, window });
    //   got.problem   why the calendar couldn't be synced: "dead" (the link stopped working),
    //                 "unreachable", "unreadable" (not a calendar, or cut off), or "slow" (its read
    //                 ran past READ_LIMIT_MS)
    //   got.events    the events, as calendar-events.json held them; got.name, the feed's own name
    //   got.failed    [{ uid, title }]: events it couldn't read, whose lines are to be left as they
    //                 are, not taken for canceled
    //   got.outside   the keys of events the feed has that start outside the window: not canceled either
    //   feed.feed([{ calendar, events }], window)   the whole events file, for apply()
    //
    // The reading runs in a background worker (plugin/src/worker/), which says how it reads a feed.
    // Here, on Obsidian's main thread, it only downloads the feed and hands the text over, so
    // nothing in a feed can hold the app up. ical.js loops forever on some impossible repeating
    // rules, which only hand-made calendar files hold; a worker that does is stopped after
    // READ_LIMIT_MS, and that calendar isn't synced that time.
    //
    // A link works like a password (OBS-231, 11/04): nothing here puts it in a result, an error,
    // the console or a notice, and the worker never sees it. A failed download comes back as a
    // problem and a status code only.

    static TIMEOUT_MS = 30000;
    // How long a read may take before its worker is stopped. The largest real feed reads in tens of
    // milliseconds on a Mac; a phone is a few times slower.
    static READ_LIMIT_MS = 20000;
    // The answers that mean the link itself stopped working (reset, unpublished or deleted).
    // Anything else that fails means the calendar couldn't be reached this time.
    static DEAD = [401, 403, 404, 410];
    static GOOGLE = /^https?:\/\/(?:www\.)?(?:calendar\.)?google\.com\/calendar\/ical\/([^/?#]+)\//i;
    // The account Add calendar suggests for a link, by the server it's on; blank for any other
    static ACCOUNTS = [
        [/(?:^|\.)google\.com$/i, "Google"],
        [/(?:^|\.)icloud\.com$/i, "iCloud"],
        [/(?:^|\.)(?:outlook\.com|office365\.com|office\.com|live\.com)$/i, "Outlook"],
    ];

    // Downloads a link and reads it: the read, with how long the download took, or the problem
    async load(link, { calendar, window }) {
        const started = performance.now();
        const got = await this.download(link);
        const downloadMs = performance.now() - started;
        if (got.problem) return { problem: got.problem, status: got.status };
        const read = await this.read(got.text, { calendar, window, link });
        if (read.problem) return { problem: read.problem, status: got.status };
        read.stats.downloadMs = downloadMs;
        return read;
    }

    // The feed's text, or the problem: "dead" for an answer that says the link stopped working,
    // "unreachable" for any other failure, no answer, or none within TIMEOUT_MS, and "unreadable"
    // for an answer that isn't a calendar. Never the link, nor an error that could carry it.
    async download(link) {
        let timer;
        const timeout = new Promise((resolve) => { timer = window.setTimeout(() => resolve(undefined), CalendarFeed.TIMEOUT_MS); });
        // A request that fails after the timeout has won is caught too, so its error, which can
        // carry the address, never reaches the console as an unhandled rejection
        const request = Promise.resolve()
            .then(() => requestUrl({ url: this.url(link), method: "GET", throw: false }))
            .catch(() => null);
        const response = await Promise.race([request, timeout]);
        window.clearTimeout(timer);
        if (!response) return { problem: "unreachable", status: null };
        const status = Number(response.status) || null;
        if (CalendarFeed.DEAD.includes(status)) return { problem: "dead", status };
        if (!status || status < 200 || status >= 300) return { problem: "unreachable", status };
        let text;
        try {
            text = response.text;
        } catch {
            return { problem: "unreadable", status };
        }
        if (!this.isCalendar(text)) return { problem: "unreadable", status };
        return { text, status };
    }

    /**
     * A webcal:// link is fetched as https://
     * @param {unknown} link
     * @returns {string}
     */
    url(link) {
        return String(link ?? "").trim().replace(/^webcals?:\/\//i, "https://");
    }

    /**
     * Whether text is a link a calendar can be added by: https:// or webcal://, with a server, and
     * nothing else around it. http:// would send the link, which works like a password, unencrypted, so
     * it's taken only from this device itself (a feed served for a test).
     * @param {unknown} link
     * @returns {boolean}
     */
    isLink(link) {
        const text = String(link ?? "").trim();
        if (!/^(?:https?|webcals?):\/\//i.test(text) || /\s/.test(text)) return false;
        try {
            const url = new URL(this.url(text));
            if (!url.hostname) return false;
            return url.protocol === "https:" || ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
        } catch {
            return false;
        }
    }

    /**
     * The address Add calendar fills in as yours on a calendar: a Google link's calendar ID when it's a
     * person's address, not a shared, holiday or birthday calendar's own ID (…@group.calendar.google.com,
     * …@group.v.calendar.google.com, …@import.calendar.google.com); else null
     * @param {unknown} link
     * @returns {string | null}
     */
    address(link) {
        const own = this.owner(link);
        return own && !/@(?:group(?:\.v)?|import)\.calendar\.google\.com$/i.test(own) ? own : null;
    }

    /**
     * The account Add calendar suggests for a link: Google, iCloud or Outlook, by its server; else ""
     * @param {unknown} link
     * @returns {string}
     */
    account(link) {
        let host = "";
        try {
            host = new URL(this.url(link)).hostname;
        } catch {
            return "";
        }
        return CalendarFeed.ACCOUNTS.find(([server]) => server.test(host))?.[1] ?? "";
    }

    /**
     * Checks a link for Add calendar, or for a new link in Edit: downloads it once and reads it.
     * { name }, the feed's own name ("" when it gives none), or { problem }: "notLink" for text that
     * isn't a link, or load()'s problem. Never the link.
     * @param {string} link
     * @returns {Promise<{ name: string, problem?: undefined } | { problem: string, name?: undefined }>}
     */
    async check(link) {
        if (!this.isLink(link)) return { problem: "notLink" };
        const got = await this.load(link, { calendar: {}, window: this.window(0) });
        if (got.problem) return { problem: String(got.problem) };
        return { name: typeof got.name === "string" ? got.name.trim() : "" };
    }

    // Whether text starts as a calendar does (after any byte-order mark, which trimStart takes)
    isCalendar(text) {
        return typeof text === "string" && /^BEGIN:VCALENDAR[ \t]*\r?\n/i.test(text.trimStart().slice(0, 40));
    }

    // The calendar's own address, when its link says it: a Google link's path holds the calendar
    // ID. Otherwise null: an iCloud or Outlook feed doesn't say whose calendar it is, so the reader
    // doesn't guess (OBS-274, 11/15). Add calendar fills in your address on a Google calendar from
    // it (OBS-282).
    /**
     * @param {unknown} link
     * @returns {string | null}
     */
    owner(link) {
        const m = CalendarFeed.GOOGLE.exec(this.url(link));
        if (!m) return null;
        try {
            return decodeURIComponent(m[1]).trim().replace(/^mailto:/i, "").toLowerCase() || null;
        } catch {
            return null;
        }
    }

    // Whose declined invitations are left out: your email address on the calendar, from Plainday's
    // settings, when you've given one; else the calendar's own, when its link says it (owner()); else
    // none, and every invitation is read (OBS-282)
    owners(calendar = {}, link = null) {
        const given = typeof calendar?.address === "string" ? calendar.address.trim().replace(/^mailto:/i, "").toLowerCase() : "";
        if (given) return [given];
        const own = this.owner(link);
        return own ? [own] : null;
    }

    // Reads a feed's text in a background worker: { name, events, failed, stats }, or a problem.
    // `calendar` is the calendar's { id, name, account, address } in Plainday's settings, `window`
    // from window(), and `link` the link it came from, which says whose calendar it is when it's
    // Google's and the calendar has no address of yours (owners()).
    async read(text, { calendar = {}, window: range, link = null }) {
        if (!this.isCalendar(text)) return { problem: "unreadable" };
        const started = performance.now();
        let url = null, worker = null;
        try {
            url = URL.createObjectURL(new Blob([calendarWorkerSource], { type: "text/javascript" }));
            worker = new Worker(url);
        } catch {
            if (url) URL.revokeObjectURL(url);
            return { problem: "unreadable" };
        }
        return new Promise((resolve) => {
            let timer = null, done = false;
            const finish = (result) => {
                if (done) return;
                done = true;
                window.clearTimeout(timer);
                worker.terminate();
                URL.revokeObjectURL(url);
                if (result?.stats) result.stats.wallMs = performance.now() - started;
                resolve(result && typeof result === "object" ? result : { problem: "unreadable" });
            };
            timer = window.setTimeout(() => finish({ problem: "slow" }), CalendarFeed.READ_LIMIT_MS);
            worker.onmessage = (event) => finish(event.data);
            worker.onerror = () => finish({ problem: "unreadable" });
            worker.onmessageerror = () => finish({ problem: "unreadable" });
            // Only what the reader needs, as text: a calendar's settings may hold more (its link)
            try {
                worker.postMessage({
                    text,
                    options: {
                        calendar: this.calendarOf(calendar),
                        window: { start: range.start.getTime(), end: range.end.getTime() },
                        owner: this.owners(calendar, link),
                    },
                });
            } catch {
                finish({ problem: "unreadable" });
            }
        });
    }

    // A calendar's ID, name and account, as text, as the events carry them: the sync matches events
    // to calendars by ID
    calendarOf(calendar = {}) {
        const text = (value) => (value === undefined || value === null ? null : String(value));
        return { id: text(calendar.id), name: text(calendar.name), account: text(calendar.account) };
    }

    // The window the Mac's fetcher used: today, through `days` days after it. `start` and `end`
    // are the instants an event's start must fall between (local midnight today, and local
    // midnight after the last day); windowStart and windowEnd are the first and last days.
    window(days, now = new Date()) {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const last = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days);
        const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
        return { start, end, windowStart: this.date(start), windowEnd: this.date(last) };
    }

    // The whole events file, as the Mac's fetcher wrote it, from one or more calendars' reads:
    // [{ calendar: { id, name, account }, events }]
    feed(reads, window, now = new Date()) {
        return {
            generatedAt: this.stamp(now),
            source: "ical",
            windowStart: window.windowStart,
            windowEnd: window.windowEnd,
            calendars: reads.map(({ calendar }) => {
                const { id, name, account } = this.calendarOf(calendar);
                return { id, title: name, account };
            }),
            events: reads.flatMap((r) => r.events)
                .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0)),
        };
    }

    // A day as YYYY-MM-DD, in this device's time zone
    date(d) {
        return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}-${this.pad(d.getDate())}`;
    }

    // An instant as local time with its offset, as moment().format() writes it: 2026-11-13T09:30:00-05:00
    stamp(d) {
        const offset = -d.getTimezoneOffset();
        const abs = Math.abs(offset);
        return `${this.date(d)}T${this.pad(d.getHours())}:${this.pad(d.getMinutes())}:${this.pad(d.getSeconds())}${offset < 0 ? "-" : "+"}${this.pad(Math.floor(abs / 60))}:${this.pad(abs % 60)}`;
    }

    pad(n) {
        return String(n).padStart(2, "0");
    }
}
