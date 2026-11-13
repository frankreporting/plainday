// How long the calendar reader (plugin/src/shared/calendarFeed.js) takes on Big, the invented feed
// the size of a large real one, and on Heavy, what's slowest for ical.js (calendarFeeds.mjs), in
// Node: the download from a server on this
// machine, the read, and its longest step, which is what blocks the app. The best of three runs,
// so numbers compare from one PR to the next (OBS-274). Run from the repository root, after
// `npm ci`:
//
//   node plugin/test/calendarFeedSpeed.mjs [--day YYYY-MM-DD] [--days 62]
//
// A private test measures a real feed the same way, through measure().
import http from "node:http";
import vm from "node:vm";
import ICAL from "ical.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadClass } from "../classShape.mjs";
import { feeds } from "./calendarFeeds.mjs";

// Obsidian's requestUrl, on Node's fetch
async function requestUrl({ url }) {
    const r = await fetch(url);
    return { status: r.status, text: await r.text() };
}

export function reader() {
    const context = vm.createContext({ ICAL, requestUrl, performance, window: { setTimeout, clearTimeout } });
    const CalendarFeed = loadClass("calendarFeed.js", context);
    return { CalendarFeed, feed: new CalendarFeed() };
}

// The best of `runs` loads of `url`: download, read (the time spent working, without the hand-backs)
// and longest step, in milliseconds, and how many events and steps. Also the read in one block,
// with no hand-backs, as OBS-227's spike measured it.
export async function measure(url, { days = 62, runs = 3, calendar = { id: "cal", name: "Feed", account: null }, link = url } = {}) {
    const best = { downloadMs: Infinity, readMs: Infinity, longestMs: Infinity, oneBlockMs: Infinity };
    let events = 0, steps = 0, skipped = 0, bytes = 0;
    for (let i = 0; i < runs; i++) {
        const { feed } = reader();
        const window = feed.window(days);
        const got = await feed.load(url, { calendar, window });
        if (got.problem) throw new Error(`the feed didn't load: ${got.problem}`);
        best.downloadMs = Math.min(best.downloadMs, got.stats.downloadMs);
        best.readMs = Math.min(best.readMs, got.stats.readMs);
        best.longestMs = Math.min(best.longestMs, got.stats.longestMs);
        ({ steps, skipped } = got.stats);
        events = got.events.length;
        const text = await (await fetch(url)).text();
        bytes = Buffer.byteLength(text);
        const whole = reader();
        whole.CalendarFeed.SLICE_MS = Infinity;
        const started = performance.now();
        await whole.feed.read(text, { calendar, window, link });
        best.oneBlockMs = Math.min(best.oneBlockMs, performance.now() - started);
    }
    return { ...best, events, steps, skipped, bytes };
}

const round = (ms) => Math.round(ms * 10) / 10;
export function report(name, m) {
    return `${name}: ${(m.bytes / 1e6).toFixed(2)} MB, ${m.skipped} old events skipped, ${m.events} events; download ${round(m.downloadMs)} ms, `
        + `read ${round(m.readMs)} ms in ${m.steps} steps, longest step ${round(m.longestMs)} ms (in one block: ${round(m.oneBlockMs)} ms)`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
    const t = new Date();
    const day = option("--day", `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`);
    const days = Number(option("--days", "62"));
    const all = feeds(day);
    const server = http.createServer((req, res) => {
        const name = (req.url ?? "").replace(/^\/|\.ics$/g, "");
        res.writeHead(200, { "Content-Type": "text/calendar" });
        res.end(all[name]?.text ?? "");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = (name) => `http://127.0.0.1:${server.address().port}/${name}.ics`;
    try {
        console.log(report("Big", await measure(url("big"), { days, link: all.big.link })));
        console.log(report("Heavy", await measure(url("heavy"), { days, link: all.heavy.link })));
    } finally {
        server.close();
    }
}
