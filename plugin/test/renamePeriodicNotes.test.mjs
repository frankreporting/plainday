// Tests for Rename periodic notes (OBS-305): plugin/src/commands/renamePeriodicNotes.js, which renames the
// periodic notes still named in an old format, and every link to them. moment is the real one, from
// node_modules; the vault is a stand-in whose metadata cache reads links the way Obsidian's does (each with
// its text as written and where it is), and Notebook Navigator's calendar makes the notes, with the demo's
// patterns unless a test sets others. Every note is invented; the last test converts the demo's own notes.
//
// Run from the repository root, after `npm ci`: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { loadClass } from "../classShape.mjs";

const require = createRequire(import.meta.url);
const moment = require("moment");
moment.locale("en");
const TODAY = new Date(2026, 10, 20, 12).getTime();
moment.now = () => TODAY;
// What a class gives back was made in its own context, whose arrays strict equality tells apart: compared as data
const plain = (x) => JSON.parse(JSON.stringify(x));

const PLANNER = "Reference/Planner";
const DAYS = `${PLANNER}/days`;
const WEEKS = `${PLANNER}/weeks`;

// The metadata cache of a note, as far as the command reads it: its wikilinks and embeds outside its
// properties, its Markdown links, and its links in properties. `link` is the link as Obsidian gives it
// (a table's \| read as the bar); `original` is the text as written, at `position`.
function cacheOf(text) {
    const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
    const body = fm ? fm[0].length : 0;
    const links = [], embeds = [], frontmatterLinks = [];
    for (const m of text.matchAll(/(!?)\[\[([^\]]*)\]\]/g)) {
        if (m.index < body) continue;
        const inner = m[2].replace(/\\\|/g, "|");
        const bar = inner.indexOf("|");
        const entry = { link: bar < 0 ? inner : inner.slice(0, bar), original: m[0], displayText: bar < 0 ? inner : inner.slice(bar + 1),
            position: { start: { offset: m.index }, end: { offset: m.index + m[0].length } } };
        (m[1] ? embeds : links).push(entry);
    }
    for (const m of text.matchAll(/(?:^|[^!\]])\[([^\]]*)\]\(([^)\s]+)\)/g)) {
        const at = m.index + m[0].indexOf("[");
        if (at < body || /^[a-z]+:/i.test(m[2])) continue;
        links.push({ link: decodeURI(m[2]).replace(/\.md$/, ""), original: m[0].slice(m[0].indexOf("[")), displayText: m[1], position: { start: { offset: at }, end: { offset: m.index + m[0].length } } });
    }
    if (fm) {
        for (const line of fm[1].split("\n")) {
            const kv = line.match(/^(\w+):.*\[\[([^\]|]*)(?:\|[^\]]*)?\]\]/);
            if (kv) frontmatterLinks.push({ key: kv[1], link: kv[2], original: `[[${kv[2]}]]` });
        }
    }
    return { links, embeds, frontmatterLinks };
}

// Plainday's classes on a stand-in vault of `notes` (path → text), with Navigator's patterns. `open` is a
// note open in an editor. Returns the vault's notes as they are after each call, and the notices.
function vault(notes, { patterns = {}, open = null } = {}) {
    const files = new Map(Object.entries(notes));
    const made = new Set();
    const handles = new Map();
    const parentOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
    const folder = (p) => ({
        path: p || "/", name: p.split("/").pop(),
        get children() {
            const prefix = p ? `${p}/` : "";
            const out = new Set();
            for (const k of [...files.keys(), ...made]) if (k.startsWith(prefix)) out.add(k.slice(prefix.length).split("/")[0]);
            return [...out];
        },
    });
    const hasFolder = (p) => !p || made.has(p) || [...files.keys(), ...made].some((k) => k.startsWith(`${p}/`));
    const file = (p) => {
        if (!files.has(p)) return null;
        if (!handles.has(p)) handles.set(p, {});
        return Object.assign(handles.get(p), { path: p, name: p.split("/").pop(), basename: p.split("/").pop().replace(/\.md$/, ""), extension: "md", parent: folder(parentOf(p)) });
    };
    const byLink = (linkpath) => {
        const l = linkpath.replace(/\.md$/i, "").toLowerCase();
        const all = [...files.keys()].map(file);
        return all.find((f) => f.path.replace(/\.md$/, "").toLowerCase() === l) ?? all.find((f) => f.basename.toLowerCase() === l) ?? null;
    };
    const notices = [], renames = [];
    let editorText = open ? files.get(open) : null;
    const view = open && {
        get file() { return file(open); },
        editor: {
            getValue: () => editorText,
            offsetToPos: (o) => o,
            replaceRange(text, from, to) { editorText = editorText.slice(0, from) + text + editorText.slice(to); },
        },
        getMode: () => "source",
        save: async () => { files.set(open, editorText); },
    };
    const app = {
        internalPlugins: { plugins: { "daily-notes": { instance: { options: { format: "YYYY-MM-DD", folder: DAYS } } } } },
        plugins: { plugins: { "notebook-navigator": { settings: {
            calendarIntegrationMode: "notebook-navigator", vaultProfiles: [{ periodicNotesFolder: PLANNER }],
            calendarCustomFilePattern: "[days]/YYYY-MM-DD", calendarCustomWeekPattern: "[weeks]/gggg[w]ww",
            calendarCustomMonthPattern: "[months]/YYYY-MM", calendarCustomYearPattern: "[years]/YYYY", ...patterns,
        } } } },
        workspace: { getLeavesOfType: () => (view ? [{ view }] : []) },
        metadataCache: {
            getFileCache: (f) => (files.has(f.path) ? cacheOf(files.get(f.path)) : null),
            getFirstLinkpathDest: (linkpath) => byLink(linkpath),
        },
        fileManager: {
            trashFile: async (f) => {
                if (folder(f.path).children.length) throw new Error("not empty");
                for (const p of [...made]) if (p === f.path || p.startsWith(`${f.path}/`)) made.delete(p);
                files.delete(f.path);
                renames.push(`delete ${f.path}`);
            },
        },
        vault: {
            getMarkdownFiles: () => [...files.keys()].filter((p) => p.endsWith(".md")).map(file),
            getFileByPath: file,
            getFolderByPath: (p) => (hasFolder(p) ? folder(p) : null),
            getAbstractFileByPath: (p) => file(p) ?? (made.has(p) ? folder(p) : null),
            createFolder: async (p) => { made.add(p); },
            rename: async (f, to) => {
                if (files.has(to)) throw new Error("Destination file already exists!");
                const from = f.path;
                // The folder a note leaves stays, as Obsidian leaves it, until it's removed
                for (let d = parentOf(from); d; d = parentOf(d)) made.add(d);
                files.set(to, files.get(from));
                files.delete(from);
                handles.set(to, handles.get(from));
                handles.delete(from);
                file(to);
                renames.push(`${from} → ${to}`);
            },
            process: async (f, fn) => { const text = fn(files.get(f.path)); files.set(f.path, text); return text; },
        },
    };
    const plainday = {};
    const context = vm.createContext({
        moment, app, plainday, URL, console: { ...console, error: () => {} }, getAllTags: () => [], getLanguage: () => "en",
        Notice: class { constructor(m) { notices.push(m); } setMessage() { return this; } hide() {} },
        MarkdownView: class {}, window: { setTimeout, requestAnimationFrame: (fn) => fn() },
    });
    for (const [key, f] of [["Settings", "settings"], ["Schedule", "schedule"], ["DatePrompt", "datePrompt"], ["JumpToDate", "jumpToDate"],
        ["TimeReport", "timeReport"], ["PeriodicNotes", "periodicNotes"], ["RenamePeriodicNotes", "renamePeriodicNotes"]]) {
        plainday[key] = new (loadClass(`${f}.js`, context))();
    }
    const R = plainday.RenamePeriodicNotes;
    return {
        R, plainday, notices, renames,
        notes: () => Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b))),
        editor: () => editorText,
        folders: () => [...made].sort(),
        // The plan for `form`, and the run of it
        plan: (form) => R.plan({ unit: "day", folder: DAYS, to: "DD-MM-YYYY", ...form }),
        async run(form) {
            const p = R.plan({ unit: "day", folder: DAYS, to: "DD-MM-YYYY", ...form });
            assert.equal(p.refused, undefined, p.refused);
            return R.run(p);
        },
    };
}

const day = (name, body = "") => [`${DAYS}/${name}.md`, `---\naliases: 9/17/26 Thursday\n---\n${body}`];

test("which notes: those under the folder named strictly in the old format; other names, other folders and logs are left", () => {
    const v = vault(Object.fromEntries([
        day("2026-09-17"), day("2026-09-18"),
        [`${DAYS}/2026-9-19.md`, ""], [`${DAYS}/2026-09-14 Homepage review.md`, ""], [`${DAYS}/Notes.md`, ""],
        [`Projects/2026-09-20.md`, ""],
    ]));
    const p = v.plan({ from: "YYYY-MM-DD" });
    assert.deepEqual(plain(p.notes.map((n) => `${n.rel} → ${n.path}`)), [`2026-09-17 → ${DAYS}/17-09-2026.md`, `2026-09-18 → ${DAYS}/18-09-2026.md`]);
    assert.equal(p.dest, DAYS);
    const shown = v.R.describe(p).map((l) => l.text);
    assert.match(shown[0], /^Renames 2 daily notes, such as 2026-09-18 → 18-09-2026 \(Friday, September 18, 2026\), into `Reference\/Planner\/days`\.$/);
});

test("the links follow: label, heading, block, \\| and ! kept; a path keeps a path; a day with no note is renamed too", async () => {
    const v = vault(Object.fromEntries([
        day("2026-09-17", "- [ ] Renew car registration [[2026-09-30|🚩 9/30]]\n"),
        day("2026-09-18"),
        ["Projects/Brochure.md", [
            "- [>] Send final copy [[2026-09-17#^p7d2qe|9/17]]",
            "- See [[2026-09-18#Morning]] and ![[2026-09-17]]",
            `- By path: [[${DAYS}/2026-09-18|Fri]]`,
            "- Another note's date: [[2026-09-20]] stays, [[Brochure]] stays",
            "",
            "| Day | Hours |",
            "| --- | ----: |",
            "| **[[2026-09-18\\|Fri 9/18]]** | 2:00 |",
        ].join("\n")],
        ["Projects/2026-09-20.md", "A note of its own, named like a day"],
    ]));
    const end = await v.run({ from: "YYYY-MM-DD" });
    const n = v.notes();
    assert.deepEqual(Object.keys(n).filter((p) => p.startsWith(DAYS)), [`${DAYS}/17-09-2026.md`, `${DAYS}/18-09-2026.md`]);
    assert.equal(n["Projects/Brochure.md"], [
        "- [>] Send final copy [[17-09-2026#^p7d2qe|9/17]]",
        "- See [[18-09-2026#Morning]] and ![[17-09-2026]]",
        `- By path: [[${DAYS}/18-09-2026|Fri]]`,
        "- Another note's date: [[2026-09-20]] stays, [[Brochure]] stays",
        "",
        "| Day | Hours |",
        "| --- | ----: |",
        "| **[[18-09-2026\\|Fri 9/18]]** | 2:00 |",
    ].join("\n"), "a link the same length leaves its table as it was");
    assert.match(n[`${DAYS}/17-09-2026.md`], /\[\[30-09-2026\|🚩 9\/30\]\]/, "a 🚩 to a day with no note");
    assert.equal(end.text, "Renamed 2 daily notes and rewrote 6 links in 2 notes.");
    assert.equal(end.left, false);
});

test("links are rewritten before the notes are renamed", async () => {
    const v = vault(Object.fromEntries([day("2026-09-17"), ["Inbox/A.md", "[[2026-09-17]]"]]));
    const order = [];
    const process = v.plainday.Schedule.rewrite.bind(v.plainday.Schedule);
    v.plainday.Schedule.rewrite = async (f, fn) => { order.push(`links in ${f.path}`); return process(f, fn); };
    await v.run({ from: "YYYY-MM-DD" });
    order.push(...v.renames);
    assert.deepEqual(order, ["links in Inbox/A.md", `${DAYS}/2026-09-17.md → ${DAYS}/17-09-2026.md`]);
});

test("a note open in an editor is written through it, and saved before the renames", async () => {
    const v = vault(Object.fromEntries([day("2026-09-17"), ["Inbox/A.md", "x [[2026-09-17]] y"]]), { open: "Inbox/A.md" });
    await v.run({ from: "YYYY-MM-DD" });
    assert.equal(v.editor(), "x [[17-09-2026]] y");
    assert.equal(v.notes()["Inbox/A.md"], "x [[17-09-2026]] y", "saved");
});

test("a table whose links change length is padded again, as Obsidian's table editor pads it", async () => {
    const plainday = vault({}).plainday;
    const table = (rows) => plainday.TimeReport.table(["Week", "Hours"], [null, "right"], rows);
    const v = vault({
        [`${WEEKS}/2026w38.md`]: "", [`${WEEKS}/2026w37.md`]: "",
        "Projects/Kestrel.md": ["## By Week", "", ...table([["[[2026w38\\|9/13-9/19]]", "2:00"], ["[[2026w37\\|9/6-9/12]]", "1:30"]]), ""].join("\n"),
    }, { patterns: { calendarCustomWeekPattern: "[weeks]/[W]ww-gggg" } });
    await v.run({ unit: "week", folder: WEEKS, from: "gggg[w]ww", to: "[W]ww-gggg" });
    const n = v.notes();
    assert.deepEqual(Object.keys(n).filter((p) => p.startsWith(WEEKS)), [`${WEEKS}/W37-2026.md`, `${WEEKS}/W38-2026.md`]);
    assert.equal(n["Projects/Kestrel.md"], ["## By Week", "", ...table([["[[W38-2026\\|9/13-9/19]]", "2:00"], ["[[W37-2026\\|9/6-9/12]]", "1:30"]]), ""].join("\n"));
});

test("a note with a table that can't be padded is left as it was and listed; the renames go on", async () => {
    const broken = "| Day | Hours |\n| --- | --- |\n| [[2026w38]] | 2:00 | extra |\n";
    const v = vault({ [`${WEEKS}/2026w38.md`]: "", "Projects/Hand table.md": broken }, { patterns: { calendarCustomWeekPattern: "[weeks]/[W]ww-gggg" } });
    const end = await v.run({ unit: "week", folder: WEEKS, from: "gggg[w]ww", to: "[W]ww-gggg" });
    assert.equal(v.notes()["Projects/Hand table.md"], broken);
    assert.ok(v.notes()[`${WEEKS}/W38-2026.md`] !== undefined, "renamed");
    assert.match(end.text, /Couldn't change Hand table, so left it as it was\./);
    assert.equal(end.left, true);
});

test("a week is renamed by its fourth day: weeks from Sunday to ISO weeks name the same week", () => {
    const v = vault({ [`${WEEKS}/2027w01.md`]: "", [`${WEEKS}/2026w38.md`]: "" }, { patterns: { calendarCustomWeekPattern: "[weeks]/GGGG-[W]WW" } });
    const p = v.plan({ unit: "week", folder: WEEKS, from: "gggg[w]ww", to: "GGGG-[W]WW" });
    assert.deepEqual(plain(p.notes.map((n) => `${n.rel} → ${n.name}`)), ["2026w38 → 2026-W38", "2027w01 → 2026-W53"]);
    assert.match(v.R.describe(p)[0].text, /such as 2027w01 → 2026-W53 \(the week of Sunday, December 27, 2026\)/);
});

test("a new format is refused before anything changes: with a folder, without a whole date", () => {
    const v = vault(Object.fromEntries([day("2026-09-17")]));
    assert.match(v.plan({ from: "YYYY-MM-DD", to: "YYYY/MM-DD" }).refused, /doesn't find notes in date folders yet/);
    assert.match(v.plan({ from: "YYYY-MM-DD", to: "MM-DD" }).refused, /don't give a note's whole date/);
    assert.match(v.plan({ from: "", to: "DD-MM-YYYY" }).refused, /Give the format the notes are named in now/);
    assert.match(v.plan({ unit: "week", folder: WEEKS, from: "gggg[w]ww", to: "[W]ww" }).refused, /whole date/);
});

test("a name another note has already: that note is left beside it, its links too, and listed; merged, a rerun moves its links", async () => {
    const v = vault(Object.fromEntries([day("2026-09-17"), day("2026-09-18"), day("18-09-2026"), ["Inbox/A.md", "[[2026-09-18|9/18]] [[2026-09-17|9/17]]"]]));
    const p = v.plan({ from: "YYYY-MM-DD" });
    assert.deepEqual(plain(p.taken.map((n) => n.rel)), ["2026-09-18"]);
    assert.match(v.R.describe(p).map((l) => l.text).join("\n"), /Leaves 2026-09-18, since another note already has the new name/);
    const end = await v.run({ from: "YYYY-MM-DD" });
    assert.equal(v.notes()["Inbox/A.md"], "[[2026-09-18|9/18]] [[17-09-2026|9/17]]");
    assert.ok(`${DAYS}/2026-09-18.md` in v.notes());
    assert.match(end.text, /Left 2026-09-18, since another note has the new name\. Merge the two, then run this again\./);
    // Merged by hand: the old one deleted, its links now link no note, and a rerun gives them the new name
    const merged = vault(Object.fromEntries(Object.entries(v.notes()).filter(([k]) => k !== `${DAYS}/2026-09-18.md`)));
    await merged.run({ from: "YYYY-MM-DD" });
    assert.equal(merged.notes()["Inbox/A.md"], "[[18-09-2026|9/18]] [[17-09-2026|9/17]]");
});

test("Markdown links and links in properties are counted and listed, not rewritten", async () => {
    const v = vault(Object.fromEntries([day("2026-09-17"), ["Inbox/A.md", "---\nday: \"[[2026-09-17]]\"\n---\nSee [the day](2026-09-17.md) and [[2026-09-17]]\n"]]));
    const p = v.plan({ from: "YYYY-MM-DD" });
    assert.deepEqual(plain([...p.other]), [["Inbox/A.md", 2]]);
    assert.match(v.R.describe(p).map((l) => l.text).join("\n"), /Can't rewrite 2 links written as a Markdown link or in properties/);
    const end = await v.run({ from: "YYYY-MM-DD" });
    assert.equal(v.notes()["Inbox/A.md"], "---\nday: \"[[2026-09-17]]\"\n---\nSee [the day](2026-09-17.md) and [[17-09-2026]]\n");
    assert.match(end.text, /Fix by hand the Markdown links or links in properties in A\./);
});

test("an old format typed wrong reads few notes, and warns when labels show other days", () => {
    const v = vault(Object.fromEntries([day("2026-09-11"), day("2026-09-02"), day("2026-09-17"), ["Projects/Invoice.md", "| **[[2026-09-11\\|Fri 9/11]]** |"]]));
    const p = v.plan({ from: "YYYY-DD-MM" });
    assert.deepEqual(plain(p.notes.map((n) => `${n.rel} → ${n.name}`)), ["2026-09-02 → 09-02-2026", "2026-09-11 → 09-11-2026"]);
    const lines = v.R.describe(p);
    assert.match(lines[0].text, /such as 2026-09-11 → 09-11-2026 \(Monday, November 9, 2026\)/);
    const warning = lines.find((l) => l.caution);
    assert.match(warning.text, /^1 link would link a day other than the one its label shows, such as "Fri 9\/11" for 09-11-2026\. The old format is probably wrong\.$/);
});

test("notes in date folders come out into the kind's folder, and the folders they leave empty go", async () => {
    const v = vault({
        [`${PLANNER}/2026/20260917.md`]: "", [`${PLANNER}/2026/20260918.md`]: "", [`${PLANNER}/2025/20260919.md`]: "wrong year's folder",
        [`${PLANNER}/2026/Kept.md`]: "", [`${PLANNER}/2027/20270101.md`]: "",
        "Inbox/A.md": "[[20260917|9/17]] [[20260930|🚩 9/30]] [[Reference/Planner/2026/20260918]]",
    });
    const p = v.plan({ folder: PLANNER, from: "YYYY/YYYYMMDD", to: "YYYY-MM-DD" });
    assert.deepEqual(plain(p.notes.map((n) => `${n.rel} → ${n.path}`)), [`2026/20260917 → ${DAYS}/2026-09-17.md`, `2026/20260918 → ${DAYS}/2026-09-18.md`, `2027/20270101 → ${DAYS}/2027-01-01.md`]);
    assert.match(v.R.describe(p).at(-1).text, /can't be put back into them this way yet/);
    await v.R.run(p);
    const n = v.notes();
    assert.equal(n["Inbox/A.md"], `[[2026-09-17|9/17]] [[2026-09-30|🚩 9/30]] [[${DAYS}/2026-09-18]]`);
    assert.deepEqual(Object.keys(n).filter((k) => k.startsWith(PLANNER)), [`${PLANNER}/2025/20260919.md`, `${PLANNER}/2026/Kept.md`, `${DAYS}/2026-09-17.md`, `${DAYS}/2026-09-18.md`, `${DAYS}/2027-01-01.md`]);
    assert.deepEqual(v.renames.filter((r) => r.startsWith("delete")), [`delete ${PLANNER}/2027`], "2026 still holds a note of its own");
});

// The demo's notes, as committed
function demoNotes() {
    const root = path.resolve(import.meta.dirname, "../..");
    const out = {};
    const walk = (dir) => {
        for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
            const rel = dir ? `${dir}/${e.name}` : e.name;
            if (e.name.startsWith(".") || ["node_modules", "Config", "plugin"].includes(rel)) continue;
            if (e.isDirectory()) walk(rel);
            else if (e.name.endsWith(".md")) out[rel] = fs.readFileSync(path.join(root, rel), "utf8");
        }
    };
    walk("");
    return out;
}

test("the demo renamed to DD-MM-YYYY reads as planned, and renamed back is as committed", async () => {
    const committed = demoNotes();
    const v = vault(committed, { patterns: { calendarCustomFilePattern: "[days]/DD-MM-YYYY" } });
    const p = v.plan({ from: "YYYY-MM-DD" });
    assert.equal(p.notes.length, 10);
    assert.equal(p.taken.length, 0);
    assert.equal(p.mislabeled.count, 0, "every label shows the day its link reads as");
    const end = await v.R.run(p);
    const n = v.notes();
    const flip = (k) => k.replace(/(\d{4})-(\d{2})-(\d{2})\.md$/, "$3-$2-$1.md");
    assert.deepEqual(Object.keys(n).filter((k) => k.startsWith(`${DAYS}/`)).sort(), Object.keys(committed).filter((k) => k.startsWith(`${DAYS}/`)).map(flip).sort());
    assert.match(n["Projects/Freelance/Pinecrest Library Brochure/Write brochure copy.md"] ?? "", /\[\[17-09-2026#\^p7d2qe\|9\/17\]\]/);
    assert.match(n[`${DAYS}/17-09-2026.md`], /\[\[30-09-2026\|🚩 9\/30\]\]/);
    assert.ok(Object.keys(n).some((k) => k.includes("2026-09-14 Homepage review")), "a log keeps its name");
    assert.equal(end.left, false, end.text);
    // And back
    const back = vault(n);
    await back.run({ from: "DD-MM-YYYY", to: "YYYY-MM-DD" });
    assert.deepEqual(back.notes(), Object.fromEntries(Object.entries(committed).sort(([a], [b]) => a.localeCompare(b))));
});
