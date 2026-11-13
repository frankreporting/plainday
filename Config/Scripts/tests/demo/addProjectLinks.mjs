// OBS-90's one-off conversion: every checklist line that links its note (⋯, or ⋯) keeps a link to
// its project or area too, before the note link, which ends the line. Run it once on a vault, then
// install the OBS-90 scripts:
//
//   node "Config/Scripts/tests/demo/addProjectLinks.mjs" [vault] [--old <timeReport.js>] [--write]
//
// `vault` is the vault's folder (this repository, the demo, when left out). `--old` is timeReport.js
// from before OBS-90, the vault's own by default: that's the one still installed until
// UpdateObsidianPM brings OBS-90 in (it refuses a timeReport.js that already reads the new rule).
// Without `--write` it's a dry run that writes nothing. `--write` needs Obsidian quit, so the
// startup report and the calendar sync can't write in between, and a `vault-backup` snapshot first.
//
// What changes, in the periodic notes (Planner) only, as the time report reads them (code blocks,
// comments and frontmatter are skipped, and so is a line with a comment on it, which is listed):
//   - a line with a note link and no ⭕ or 🗃️ gets the project or area the time report counted it
//     toward before OBS-90, so no hours move. That's usually where its note is filed, but a sub-task
//     counts toward a ⭕ on the line it's nested under. A line that counted toward no project, or an
//     archived one, is left as it is;
//   - its ⭕ and 🗃️ links, wherever they are on the line, go before the note link;
//   - a line whose time counted through a project linked in its text, which only a ⭕ at the end
//     does since OBS-90, gets that project's ⭕ at the end.
// The check: every entry and event in the daily notes is counted by the old report on the notes as
// they are and by the new one on the notes as converted, and the two must count the same ones (an
// archived one stays out), each on the same project, with the same minutes and 🆓. The report lists
// any that don't (there should be none: edit those lines by hand), and the lines whose ⭕ now
// differs from where their note is filed: a disagreement the old rule hid, which the new report
// lists under Problems. Each is Brian's to settle: move the note, or change the line. It also lists
// open tasks whose project is only linked in their text, which no longer says where time goes.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { ROOT, PLANNER, loadTimeReport, readVault, makeIndex, dailyNotes } from "./renderReports.mjs";

const TASK = /^\s*[-*+]\s+\[.\]/;

// The project line `i` counted toward, as a command reads it: through `ctx` (its context) in a
// timeReport.js from before OBS-196, whose resolve took one, else off the note's `lines`
const lookup = (tr, lines, ctx, i, p, index) => (tr.resolve.length === 3 ? tr.resolve(ctx, p, index, true) : tr.resolve((n) => lines[n], i, p, index).live);

// The classes, loaded with vm; only their text methods are used
function load(file, name) {
    return new (vm.runInContext(fs.readFileSync(file, "utf8") + `\n;${name}`, vm.createContext({})))();
}

// Every line's context as the time report builds it: the line, then each line it's nested under
// (indented text that isn't a list item is skipped), as { body } with the bullet taken off
function contexts(tr, lines) {
    const out = [];
    const stack = [];
    for (const [i, raw] of lines.entries()) {
        if (!raw.trim()) { out.push(null); continue; }
        const width = tr.indentWidth(raw);
        while (stack.length && stack[stack.length - 1].width >= width) stack.pop();
        const bullet = raw.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
        const node = { width, body: bullet ? bullet[1].trim() : raw.trim(), text: !bullet && width > 0 };
        out.push([node, ...stack.slice().reverse().filter((a) => !a.text)].map((c) => ({ body: c.body })));
        stack.push(node);
    }
    return out;
}

// Runs the conversion on `vault` (readVault's shape) with `oldTr` (the report before OBS-90) and
// `newTr`. Returns { notes: Map(path → converted text), changes, disagreements, skipped, moved,
// counted } without writing anything.
export function convert(vault, oldTr, newTr, tasks) {
    const index = makeIndex(newTr, vault);
    const names = new Map();
    for (const f of vault.files) {
        const base = f.split("/").pop().replace(/\.md$/, "").toLowerCase();
        names.set(base, (names.get(base) ?? 0) + 1);
    }
    const linkFor = (p) => {
        const base = p.split("/").pop().replace(/\.md$/, "");
        return `[[${names.get(base.toLowerCase()) > 1 ? p.replace(/\.md$/, "") : base}|${newTr.linkMark(p, index)}]]`;
    };
    const live = (p) => p && newTr.counts(p, index) && !newTr.isArchived(p);
    const notes = new Map();
    const changes = [], disagreements = [], skipped = [];

    // One pass: `extra` holds lines (path → Set of line numbers) that also need their old project,
    // because their entries would move otherwise
    const pass = (extra) => {
        notes.clear();
        changes.length = 0;
        disagreements.length = 0;
        skipped.length = 0;
        for (const [p, { text }] of vault.notes) {
            if (!p.startsWith(`${PLANNER}/`)) continue;
            const raw = text.split("\n");
            const bare = raw.map((l) => l.replace(/\r$/, ""));
            const { hidden, visible } = newTr.scan(bare);
            const ctx = contexts(newTr, visible);
            let changed = false;
            const out = bare.map((line, i) => {
                const cr = raw[i].endsWith("\r") ? "\r" : "";
                if (hidden[i] || !TASK.test(visible[i])) return raw[i];
                const body = ctx[i][0].body;
                const { notes: own } = newTr.lineLinks(body);
                const wanted = extra.get(p)?.has(i);
                if (!own.length && !wanted) return raw[i];
                if (visible[i] !== line) {
                    skipped.push({ path: p, line: i + 1, text: line, why: "has a comment on it" });
                    return raw[i];
                }
                const marks = tasks.projectLinks(line).map((l) => l.raw);
                let next;
                if (marks.length) {
                    next = tasks.withHome(line, marks.join(" "), marks);
                } else {
                    const project = lookup(oldTr, visible, ctx[i], i, p, index);
                    if (!live(project)) return raw[i];
                    next = tasks.withHome(line, linkFor(project), []);
                    // Where the note is filed, when that's somewhere else
                    const note = own[0] && index.linkDest(own[0].target, p);
                    const filed = note && newTr.projectOfNote(note, index);
                    if (filed && filed !== project && !newTr.isArchived(filed)) disagreements.push({ path: p, line: i + 1, text: next, project, note, filed });
                }
                if (next === line) return raw[i];
                changes.push({ path: p, line: i + 1, before: line, after: next });
                changed = true;
                return next + cr;
            });
            if (changed) notes.set(p, out.join("\n"));
        }
    };

    // The check: every entry and event on the same project before and after
    const days = (converted) => dailyNotes(vault).map((n) => ({ ...n, text: converted.get(n.path) ?? n.text }));
    const before = oldTr.build(dailyNotes(vault), index);
    const key = (e) => `${e.path}:${e.line}:${e.start}`;
    const was = new Map(before.entries.map((e) => [key(e), e]));
    const same = (a, b) => !!a && !!b && (a.project ?? null) === (b.project ?? null) && a.minutes === b.minutes && !!a.free === !!b.free;
    const extra = new Map();
    let moved = [];
    for (let round = 0; round < 5; round++) {
        pass(extra);
        const after = newTr.build(days(notes), index);
        const now = new Map(after.entries.map((e) => [key(e), e]));
        // Counted differently, or counted on one side only (an archived entry the other side counts):
        // [{ path, line, before, after }], either side null when it isn't counted there
        moved = after.entries.filter((e) => !same(was.get(key(e)), e)).map((e) => ({ path: e.path, line: e.line, before: was.get(key(e)) ?? null, after: e }))
            .concat(before.entries.filter((e) => !now.has(key(e))).map((e) => ({ path: e.path, line: e.line, before: e, after: null })));
        // An entry that moved: its task line gets the project it had
        let more = false;
        for (const { before: old, after: e } of moved) {
            if (!old?.project || !e) continue;
            const line = e.context?.[0]?.line ?? e.line;
            const set = extra.get(e.path) ?? new Set();
            if (!set.has(line - 1)) { set.add(line - 1); more = true; }
            extra.set(e.path, set);
        }
        if (!more) break;
    }
    return { notes, changes, disagreements, skipped, moved, counted: before.entries.length, textOnly: textOnly(vault, oldTr, newTr, index, notes) };
}

// Open tasks (`[ ]`, `[/]`) whose time the old report would count toward a project only linked in
// their text, and the new report toward nothing: the link is part of the title now. They have no
// entries yet, so the conversion leaves them; the list is for deciding which should get a ⭕.
function textOnly(vault, oldTr, newTr, index, converted) {
    const out = [];
    for (const [p, { text }] of vault.notes) {
        if (!p.startsWith(`${PLANNER}/`)) continue;
        const bare = (converted.get(p) ?? text).split("\n").map((l) => l.replace(/\r$/, ""));
        const { hidden, visible } = newTr.scan(bare);
        const ctx = contexts(newTr, visible);
        for (const [i, line] of visible.entries()) {
            if (hidden[i] || !/^\s*[-*+]\s+\[[ /]\]/.test(line)) continue;
            const was = lookup(oldTr, visible, ctx[i], i, p, index);
            if (was && was !== lookup(newTr, visible, ctx[i], i, p, index)) out.push({ path: p, line: i + 1, text: line, project: was });
        }
    }
    return out;
}

const quote = (s) => s.replace(/\t/g, "⇥");

// The dry run's report, in Markdown: what changes, the disagreements, what was skipped, the check
export function report({ changes, disagreements, skipped, moved, counted, textOnly = [] }) {
    const files = new Set(changes.map((c) => c.path)).size;
    const added = changes.filter((c) => !/\|(?:⭕|🗃)/u.test(c.before)).length;
    const out = [
        `**${changes.length} lines in ${files} notes:** ${added} get a ⭕ or 🗃️, ${changes.length - added} have theirs moved before the note link.`,
        "",
        `**Hours check:** ${counted} entries and events counted; ${moved.length ? `${moved.length} would move (listed below)` : "none moves"}.`,
        "",
        "## Lines that change",
        "",
        "```",
        ...changes.flatMap((c) => [`${c.path}:${c.line}`, `  - ${quote(c.before.trim())}`, `  + ${quote(c.after.trim())}`]),
        "```",
        "",
        "## Where the line's project isn't where its note is filed",
        "",
        disagreements.length ? "Each counts toward the line's project, as it did before; the report lists it under Problems until one of them changes." : "None.",
        "",
        ...disagreements.map((d) => `- \`${d.path.split("/").pop().replace(/\.md$/, "")}:${d.line}\` counts toward ${d.project.split("/").pop().replace(/\.md$/, "")}; its note \`${d.note.split("/").pop().replace(/\.md$/, "")}\` is filed in ${d.filed.split("/").pop().replace(/\.md$/, "")}`),
        "",
        "## Left alone",
        "",
        skipped.length ? "" : "None.",
        ...skipped.map((s) => `- \`${s.path.split("/").pop().replace(/\.md$/, "")}:${s.line}\` ${s.why}: \`${quote(s.text.trim())}\``),
        "",
    ];
    out.push("## Open tasks whose project is only in their text", "",
        textOnly.length ? "The old report counted their time toward a project linked in the text; the new one reads only the links that end a line. Nothing is logged under them yet, so they're left as they are: give one a ⭕ (AddProjectLink) if its time should go there." : "None.", "");
    for (const t of textOnly) out.push(`- \`${t.path.split("/").pop().replace(/\.md$/, "")}:${t.line}\` → ${t.project.split("/").pop().replace(/\.md$/, "")}: \`${quote(t.text.trim())}\``);
    if (textOnly.length) out.push("");
    if (moved.length) {
        out.push("## Entries that would change (edit these lines by hand, then run it again)", "");
        const name = (p) => (p ? p.split("/").pop().replace(/\.md$/, "") : "Unassigned");
        const side = (e) => (e ? `${name(e.project)}, ${e.minutes} min${e.free ? " 🆓" : ""}` : "not counted");
        for (const m of moved) out.push(`- \`${name(m.path)}:${m.line}\` ${side(m.before)} → ${side(m.after)}`);
        out.push("");
    }
    return out.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("addProjectLinks.mjs")) {
    const args = process.argv.slice(2);
    const write = args.includes("--write");
    const oldAt = args.indexOf("--old");
    const root = args.find((a, i) => !a.startsWith("--") && (oldAt < 0 || i !== oldAt + 1)) ?? ROOT;
    const oldPath = oldAt >= 0 ? args[oldAt + 1] : path.join(root, "Config/Scripts/CustomJS/timeReport.js");
    const oldTr = load(oldPath, "TimeReport");
    if (typeof oldTr.lineLinks === "function") {
        console.error(`${oldPath} already reads only the links that end a line (OBS-90), so it can't say what the report counted before. Run this before UpdateObsidianPM installs OBS-90, or pass --old with the timeReport.js from before.`);
        process.exit(2);
    }
    const newTr = loadTimeReport();
    const tasks = load(path.join(ROOT, "plugin/src/classes/addTaskNote.js"), "AddTaskNote");
    const result = convert(readVault(root), oldTr, newTr, tasks);
    console.log(report(result));
    if (write) {
        if (spawnSync("pgrep", ["-x", "Obsidian"]).status === 0) {
            console.error("Not written: quit Obsidian first, so the startup report and the calendar sync can't write in between.");
            process.exit(1);
        }
        if (result.moved.length) {
            console.error("Not written: some entries would move. See above.");
            process.exit(1);
        }
        for (const [p, text] of result.notes) fs.writeFileSync(path.join(root, p), text);
        console.error(`Wrote ${result.notes.size} notes.`);
    }
}
