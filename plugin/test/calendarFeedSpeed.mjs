// How long the calendar reader takes on Big, the invented feed the size of a large real one, and
// on Heavy, what's slowest for ical.js (calendarFeeds.mjs), in Node, best of three runs, so numbers
// compare from one PR to the next (OBS-274):
// - the download, from a server on this machine;
// - the read, in the worker (plugin/src/worker/calendarRead.js), timed here in this process;
// - the worker as the build makes it, on a thread of its own: from starting it to its answer;
// - what the read holds up Obsidian's main thread for: CalendarFeed handing the text over.
// Run from the repository root, after `npm ci`:
//
//   node plugin/test/calendarFeedSpeed.mjs [--day YYYY-MM-DD] [--days 62]
//
// A private test measures a real feed the same way, through measure().
import http from "node:http";
import path from "node:path";
import vm from "node:vm";
import { Worker as Thread } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { loadClass } from "../classShape.mjs";
import { workerSource } from "../esbuild.config.mjs";
import { CalendarReader } from "../src/worker/calendarRead.js";
import { feeds } from "./calendarFeeds.mjs";

// Obsidian's requestUrl, on Node's fetch
async function requestUrl({ url }) {
    const r = await fetch(url);
    return { status: r.status, text: await r.text() };
}

// A worker that reads in this process, a turn later
function inProcess(reader) {
    return class {
        postMessage(data) {
            setTimeout(() => this.onmessage?.({ data: structuredClone(reader.read(data.text, data.options)) }), 0);
        }
        terminate() {}
    };
}

// The worker as the build makes it, on a Node thread
let built = null;
export async function threadWorker() {
    built ??= (await workerSource()).code;
    return class {
        constructor() {
            this.thread = new Thread(`const { parentPort } = require("node:worker_threads"); globalThis.self = globalThis;
                self.postMessage = (m) => parentPort.postMessage(m); parentPort.on("message", (m) => self.onmessage({ data: m }));\n${built}`, { eval: true });
            this.thread.on("message", (m) => this.onmessage?.({ data: m }));
            this.thread.on("error", (e) => this.onerror?.(e));
        }
        postMessage(data) { this.thread.postMessage(data); }
        terminate() { void this.thread.terminate(); }
    };
}

// CalendarFeed on Node: requestUrl on fetch, and a worker that reads in this process, or `Worker`
export function feedOn(Worker = null) {
    const context = vm.createContext({
        requestUrl, performance, window: { setTimeout, clearTimeout }, calendarWorkerSource: "",
        Worker: Worker ?? inProcess(new CalendarReader()), Blob: class {}, URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
    });
    const CalendarFeed = loadClass("calendarFeed.js", context);
    return new CalendarFeed();
}

// The best of `runs`: download, read and the worker's start to answer, and the main thread's
// part, in milliseconds, with how many events and old events skipped
export async function measure(url, { days = 62, runs = 3, calendar = { id: "cal", name: "Feed", account: null }, link = url } = {}) {
    const Worker = await threadWorker();
    const best = { downloadMs: Infinity, readMs: Infinity, workerMs: Infinity, mainMs: Infinity };
    let events = 0, skipped = 0, bytes = 0;
    for (let i = 0; i < runs; i++) {
        const feed = feedOn();
        const window = feed.window(days);
        let started = performance.now();
        const got = await feed.download(url);
        best.downloadMs = Math.min(best.downloadMs, performance.now() - started);
        if (got.problem) throw new Error(`the feed didn't load: ${got.problem}`);
        bytes = Buffer.byteLength(got.text);
        const read = new CalendarReader().read(got.text, { calendar, window, owner: feed.owner(link) });
        best.readMs = Math.min(best.readMs, read.stats.readMs);
        ({ skipped } = read.stats);
        events = read.events.length;
        const threaded = feedOn(Worker);
        started = performance.now();
        const answer = threaded.read(got.text, { calendar, window, link });
        best.mainMs = Math.min(best.mainMs, performance.now() - started);
        const result = await answer;
        if (result.problem) throw new Error(`the worker didn't read it: ${result.problem}`);
        best.workerMs = Math.min(best.workerMs, result.stats.wallMs);
    }
    return { ...best, events, skipped, bytes };
}

const round = (ms) => Math.round(ms * 10) / 10;
export function report(name, m) {
    return `${name}: ${(m.bytes / 1e6).toFixed(2)} MB, ${m.skipped} old events skipped, ${m.events} events; download ${round(m.downloadMs)} ms, `
        + `read ${round(m.readMs)} ms, worker start to answer ${round(m.workerMs)} ms, main thread ${round(m.mainMs)} ms`;
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
