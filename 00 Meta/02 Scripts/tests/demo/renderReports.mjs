// Renders the time reports in the demo vault's notes exactly as TimeReport would write them, so
// opening the demo in Obsidian (where TimeReportOnStartup runs) doesn't rewrite tracked notes.
//
//   node "00 Meta/02 Scripts/tests/demo/renderReports.mjs"           write the reports
//   node "00 Meta/02 Scripts/tests/demo/renderReports.mjs" --check   list notes that would change (exit 1)
//
// It mirrors TimeReport.refresh without `app`: timeReport.js is loaded with vm (as the tests do), the
// vault is read from disk, and makeIndex stands in for the metadata cache. demoVault.test.mjs uses
// the same functions to check that the committed notes are already what this would write.
//
// What it reproduces from the app-facing code at the bottom of timeReport.js:
//   - readDailyNotes: notes named YYYY-MM-DD in the daily notes folder whose text has a time in it;
//   - readInvoices: notes whose frontmatter tags include `invoice`, attached with attachBilling (OBS-5);
//   - projectTargets plus every live project or area note that already has a block (writeProjectNotes),
//     each with its timesheet note (writeTimesheet: found by its `timesheet` tag and `area`, else made
//     beside the project note when it has entries, with SHEET_ID as its id);
//   - periodsWithEntries plus every periodic note that already has a block (writePeriodNotes), and
//     a missing periodic note is created the way createPeriodNote makes one;
//   - writeBlock's plan (blockEdits): the old "## Time tracking" heading renamed "## Time Report", a
//     blank line above it, then placeBlock unless sameBlock;
//   - the project `link` and the weekly/monthly `linkTarget` (a name, or a path when names clash).
// What it can't reproduce exactly (see the report in demoVault.test.mjs for the checks that stand in):
//   - `now`: the app leaves out entries that haven't ended yet. The demo's entries are all in the
//     past, so the model is built without a clock;
//   - the week-naming probe against moment's locale: weeks are assumed to start on Sunday, as
//     Notebook Navigator's gggg[w]ww does in the default locale;
//   - fileToLinktext: a project's link text is its name when no other note has that name, else its
//     path (the demo keeps every project name unique, and the test checks that);
//   - getFirstLinkpathDest: makeIndex resolves a link by exact path or by the shortest path ending
//     in its name, which matches Obsidian for the demo's unique names;
//   - the "Updated" stamp: new blocks get STAMP; sameBlock ignores that line, so blocks that are
//     already right keep theirs, just as in the app.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const PLANNER = "30 Reference/36 Planner";
export const DAYS = `${PLANNER}/days`;
export const FOLDERS = { week: `${PLANNER}/weeks`, month: `${PLANNER}/months`, year: `${PLANNER}/years` };
export const STAMP = "2026-09-16 9:00pm";
// The id a timesheet note the demo's report run makes gets (the app stamps the time it's made)
export const SHEET_ID = "2026091621000000";
// Only these folders hold demo notes (00 Meta is the system; its files still count for link names)
export const NOTE_FOLDERS = ["10 Inbox/", "Projects/", "30 Reference/", "90 Archive/"];

export function loadTimeReport(root = ROOT) {
    const code = fs.readFileSync(path.join(root, "00 Meta/02 Scripts/CustomJS/timeReport.js"), "utf8");
    const TimeReport = vm.runInContext(code + "\n;TimeReport", vm.createContext({}));
    return new TimeReport();
}

// Billing, which reads the invoice notes for the project timesheets (OBS-5)
export function loadBilling(root = ROOT) {
    const code = fs.readFileSync(path.join(root, "00 Meta/02 Scripts/CustomJS/billing.js"), "utf8");
    const Billing = vm.runInContext(code + "\n;Billing", vm.createContext({}));
    return new Billing();
}

// Every file in the vault, as vault-relative paths; dot folders (.obsidian, .git) are skipped
export function listFiles(root = ROOT) {
    const out = [];
    const walk = (dir) => {
        for (const d of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
            if (d.name.startsWith(".")) continue;
            const rel = dir ? `${dir}/${d.name}` : d.name;
            if (d.isDirectory()) walk(rel);
            else out.push(rel);
        }
    };
    walk("");
    return out.sort();
}

// The small subset of YAML the demo notes use: `key: value`, `key: [a, 'b']`, and `key:` followed by
// `- item` lines. Empty values are null. Returns {} for a note without frontmatter.
export function frontmatter(text) {
    const lines = text.split(/\r?\n/);
    if (lines[0]?.trimEnd() !== "---") return {};
    const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === "---");
    if (end === -1) return {};
    const unquote = (s) => {
        s = s.trim();
        if (/^".*"$/.test(s)) return JSON.parse(s);
        if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
        return s;
    };
    const scalar = (s) => {
        s = s.trim();
        if (s === "") return null;
        if (/^\[.*\]$/.test(s)) return s.slice(1, -1).split(",").map((x) => unquote(x)).filter((x) => x !== "");
        if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
        return unquote(s);
    };
    const out = {};
    let listKey = null;
    for (const line of lines.slice(1, end)) {
        const item = line.match(/^\s*-\s+(.*)$/);
        if (item && listKey) {
            out[listKey] = [...(Array.isArray(out[listKey]) ? out[listKey] : []), unquote(item[1])];
            continue;
        }
        const kv = line.match(/^([^\s:][^:]*):(?:\s+(.*))?$/);
        if (!kv) continue;
        out[kv[1]] = scalar(kv[2] ?? "");
        listKey = out[kv[1]] === null ? kv[1] : null;
    }
    return out;
}

// { files: [paths], notes: Map(path → { text, fm }) } for every markdown file
export function readVault(root = ROOT) {
    const files = listFiles(root);
    const notes = new Map();
    for (const f of files.filter((p) => p.endsWith(".md"))) {
        const text = fs.readFileSync(path.join(root, f), "utf8");
        notes.set(f, { text, fm: frontmatter(text) });
    }
    return { root, files, notes };
}

const basename = (p) => p.split("/").pop().replace(/\.md$/, "");

export function makeIndex(tr, vault) {
    return tr.makeIndex([...vault.notes].map(([p, { fm }]) => ({
        path: p,
        tags: [].concat(fm.tags ?? []).filter(Boolean),
        area: fm.area ?? null,
        props: fm,
    })));
}

// readDailyNotes: YYYY-MM-DD notes in the daily notes folder with a time in them
export function dailyNotes(vault) {
    const out = [];
    for (const [p, { text }] of vault.notes) {
        if (p.slice(0, p.lastIndexOf("/")) !== DAYS) continue;
        const name = basename(p);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(name) || Number.isNaN(Date.parse(name))) continue;
        if (!/\d[:.]\d\d|\d\s*[ap]\.?m/i.test(text)) continue;
        out.push({ date: name, path: p, text });
    }
    return out;
}

// readInvoices: every note tagged `invoice` in its frontmatter, and any note where invoices are filed
// (an invoices/ folder, or the demo Invoice Settings' `folder`) that still has its Billed entries
// (flagged untagged), as [{ path, props, text, tagged }]
export function invoiceNotes(vault, billing) {
    const folder = billing.folderOf(vault.notes.get("00 Meta/Invoice Settings.md")?.fm.folder).folder;
    const out = [];
    for (const [p, { text, fm }] of vault.notes) {
        const tagged = [].concat(fm.tags ?? []).some((t) => String(t).replace(/^#/, "").toLowerCase() === "invoice");
        const inFolder = billing.inInvoiceFolder(p, folder) && billing.hasBilled(text);
        if (tagged || inFolder) out.push({ path: p, props: fm, text, tagged });
    }
    return out;
}

// Link helpers the app builds from the vault: project links and weekly/monthly link targets
export function linkers(tr, vault, index = makeIndex(tr, vault)) {
    const count = new Map();
    for (const p of vault.notes.keys()) count.set(basename(p), (count.get(basename(p)) ?? 0) + 1);
    const link = (p) => {
        const target = vault.notes.has(p) && count.get(basename(p)) === 1 ? basename(p) : p.replace(/\.md$/, "");
        return tr.reportLink(target, p, index);
    };
    const linkTarget = (unit, key) => {
        const own = vault.notes.has(`${FOLDERS[unit]}/${key}.md`) ? 1 : 0;
        return (count.get(key) ?? 0) - own > 0 ? `${FOLDERS[unit]}/${key}` : key;
    };
    return { link, linkTarget };
}

const apply = (content, edit) => content.slice(0, edit.start) + edit.text + content.slice(edit.end);

// writeBlock's plan with onlyIfChanged (blockEdits): the note as it would be afterwards, or { error }
export function planBlock(tr, content, block) {
    const edits = tr.blockEdits(content, block, { onlyIfChanged: true });
    if (edits.error) return { error: edits.error };
    return { content: edits.reduce(apply, content) };
}

// Everything a TimeReport run would do to the vault:
// { model, index, targets: { project, week, month, year }, blocks: Map(path → block),
//   changes: [{ path, before (null for a new note), after }], errors: [{ path, error }] }
export function planReports(tr, vault, { stamp = STAMP, billing = loadBilling(vault.root) } = {}) {
    const index = makeIndex(tr, vault);
    const model = tr.attachBilling(tr.build(dailyNotes(vault), index), invoiceNotes(vault, billing), index, billing);
    const { link, linkTarget } = linkers(tr, vault, index);
    const hasBlock = (p) => vault.notes.has(p) && tr.hasBlock(vault.notes.get(p).text);
    const changes = [], errors = [], blocks = new Map();
    const targets = { project: [], week: [], month: [], year: [] };

    const write = (p, block, created) => {
        blocks.set(p, block);
        const before = vault.notes.get(p)?.text ?? null;
        const base = before ?? created;
        const r = planBlock(tr, base, block);
        if (r.error) { errors.push({ path: p, error: r.error }); return; }
        if (r.content !== before) changes.push({ path: p, before, after: r.content });
    };

    // writeProjectNotes, and each project's timesheet note (writeTimesheet)
    const projects = tr.projectTargets(model);
    for (const p of vault.notes.keys()) {
        if (!projects.has(p) && !tr.isArchived(p) && tr.counts(p, index) && hasBlock(p)) projects.add(p);
    }
    const sheets = new Map();
    for (const [p, { fm }] of vault.notes) {
        if (![].concat(fm.tags ?? []).includes("timesheet")) continue;
        const target = String(fm.area ?? "").match(/\[\[([^\]|#]+)/)?.[1]?.trim();
        const project = target ? index.linkDest(target, p) : null;
        if (project && !sheets.has(project)) sheets.set(project, p);
    }
    targets.sheet = [];
    for (const p of projects) {
        if (!vault.notes.has(p) || tr.isArchived(p)) continue;
        targets.project.push(p);
        const sheetPath = sheets.get(p) ?? tr.sheetPath(p);
        const block = tr.render(model, { kind: "timesheet", path: p }, stamp, link);
        let sheet = null;
        // A note with the timesheet's name that isn't tagged `timesheet` is left alone, and so is an
        // area's timesheet made before areas stopped getting one
        const mine = sheets.has(p) || !vault.notes.has(sheetPath);
        if (tr.takesTimesheet(p, index, model) && mine && (vault.notes.has(sheetPath) || tr.sheetHasEntries(model, p))) {
            const fm = vault.notes.get(p).fm;
            const area = `[[${basename(p)}|${[].concat(fm.aliases ?? [])[0] || basename(p)}]]`;
            write(sheetPath, block, tr.sheetNote(SHEET_ID, area, block));
            targets.sheet.push(sheetPath);
            sheet = basename(sheetPath);
        }
        write(p, tr.render(model, { kind: "project", path: p, linkTarget, sheet }, stamp, link));
    }

    // writePeriodNotes (with create, as on the desktop)
    const wanted = tr.periodsWithEntries(model);
    for (const unit of ["week", "month", "year"]) {
        const keys = new Set(wanted[unit]);
        for (const p of vault.notes.keys()) {
            if (p.slice(0, p.lastIndexOf("/")) === FOLDERS[unit] && tr.constructor.PERIOD_NAME[unit].test(basename(p)) && hasBlock(p)) keys.add(basename(p));
        }
        for (const key of [...keys].sort()) {
            const p = `${FOLDERS[unit]}/${key}.md`;
            targets[unit].push(p);
            const block = tr.render(model, { kind: "period", unit, key, linkTarget }, stamp, link);
            const fm = tr.periodFrontmatter(unit, key);
            const created = `${fm}${fm ? "\n" : ""}${tr.constructor.HEADING}\n\n${block}\n`;
            write(p, block, created);
        }
    }
    return { model, index, targets, blocks, changes, errors };
}

function main() {
    const check = process.argv.includes("--check");
    const tr = loadTimeReport();
    const vault = readVault();
    const { changes, errors } = planReports(tr, vault);
    for (const e of errors) console.error(`${e.path}: ${e.error}`);
    for (const c of changes) {
        console.log(`${check ? "would " : ""}${c.before === null ? "create" : "update"} ${c.path}`);
        if (!check) {
            fs.mkdirSync(path.dirname(path.join(ROOT, c.path)), { recursive: true });
            fs.writeFileSync(path.join(ROOT, c.path), c.after);
        }
    }
    if (!changes.length) console.log("Reports are up to date.");
    if (errors.length || (check && changes.length)) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
