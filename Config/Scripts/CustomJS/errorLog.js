// The error log (OBS-218): every Problem the system found, in one note, `Config/Error Log.md`, one
// line per kind of Problem per note (`- Bad formatting (2) · [[2026-09-16]]`), linking the note to
// start from. The detail stays in the reports' Problems callouts; the log is the index across the
// system. Each command that finds
// Problems (the time report, the calendar sync) rewrites its own section whole on every run, so a
// fixed Problem leaves the log the next time that command runs; a section is only written when its
// list changed. A run that finds a line the log didn't have, or a higher count, shows one toast
// naming the new lines, with a link to the log (View Error Logs opens it too).
class ErrorLog {
    static PATH = "Config/Error Log.md";
    // The sections, in the order the note has them
    static SECTIONS = ["Time report", "Calendar sync"];
    // Every kind, in the order a section lists them: billing first, then time entries, then
    // projects' settings, then tasks (Brian, 2026-10-29); the calendar sync's own at the end
    static KINDS = [
        "Billed entry missing", "Billed times changed", "Billed entry on another project", "Billed entry now 🆓",
        "Billed entry on no project", "Billed entry on a line with two projects", "Entry on two invoices", "Billed entries need fixing",
        "Overlapping time entries", "Bad formatting", "No end time", "Ends before it starts", "Starts and ends at the same time",
        "12 hours or more", "Misplaced 🆓", "Time not under a task or event", "Time under a plain bullet",
        "Unmatched time marker", "Unclosed code block or comment",
        "No rate_type", "Rate isn't a number", "Hourly with no rate", "Rate under a non-billable parent",
        "Area with a rate and no rate_type", "Earned date problem", "Projects inside each other",
        "Line and note name different projects", "Project setting",
        "Task lines disagree",
        "Held back changes", "Skipped lines",
    ];
    // An entry Problem's kind (TimeReport.parseNote, build, the task checks)
    static ENTRY = {
        overlap: "Overlapping time entries", format: "Bad formatting", open: "No end time", order: "Ends before it starts",
        zero: "Starts and ends at the same time", long: "12 hours or more", free: "Misplaced 🆓",
        anchor: "Time not under a task or event", plain: "Time under a plain bullet", markers: "Unmatched time marker",
        unclosed: "Unclosed code block or comment", task: "Task lines disagree",
    };
    // A billed row's change (Billing.changes)
    static CHANGE = {
        gone: "Billed entry missing", times: "Billed times changed", project: "Billed entry on another project",
        free: "Billed entry now 🆓", unassigned: "Billed entry on no project", disputed: "Billed entry on a line with two projects",
    };
    // A project's own Problem, by how its message starts (TimeReport.build and moneyOf)
    static SETTING = [
        [/^has no `rate_type`/, "No rate_type"],
        [/^has a `rate` that isn't a positive number/, "Rate isn't a number"],
        [/^is hourly but has no `rate`/, "Hourly with no rate"],
        [/^has its own `rate` but inherits `non-billable`/, "Rate under a non-billable parent"],
        [/^has a `rate` and no `rate_type`/, "Area with a rate and no rate_type"],
        [/`earned`/, "Earned date problem"],
    ];

    basename(path) {
        return String(path ?? "").split("/").pop().replace(/\.md$/, "");
    }

    // The time report's Problems as [{ kind, link, name }], one per Problem. `link(path)` is the
    // report's link to a note. Invoices come from the model's billing, every one that isn't canceled,
    // whether or not it names a project; their lines link the project's note, whose Problems callout
    // names the invoice and links the daily note to fix (Brian, 2026-10-29), else the invoice. A task Problem is listed once, at its line's note, not again
    // under each project; time with no project isn't a Problem here: errands have none on purpose.
    fromModel(model, link) {
        const out = [];
        const add = (kind, path) => { if (path) out.push({ kind, link: link(path), name: this.basename(path) }); };
        for (const p of model.problems ?? []) add(ErrorLog.ENTRY[p.kind] ?? "Bad formatting", p.note ?? p.path);
        const b = model.billing;
        const home = (invoice) => invoice.project ?? invoice.path;
        for (const invoice of b?.invoices ?? []) if (invoice.problem && invoice.status !== "canceled") add("Billed entries need fixing", home(invoice));
        for (const [invoice, list] of b?.byInvoice ?? []) {
            for (const c of list) if (c.kind !== "wording") add(ErrorLog.CHANGE[c.kind] ?? "Billed times changed", home(invoice));
        }
        for (const twice of b?.ledger?.twice ?? []) add("Entry on two invoices", twice.invoices[1].project ?? twice.invoices[0].project ?? twice.invoices[1].path);
        // A task Problem on a line in a note that isn't a day is copied onto each of its projects: once
        const seen = new Set();
        for (const p of model.projectProblems ?? []) {
            if (p.invoice || p.twice) continue;
            if (p.kind === "task") {
                const k = `${p.path}:${p.line}:${p.message}`;
                if (p.path && !seen.has(k)) { seen.add(k); add("Task lines disagree", p.path); }
                continue;
            }
            if (p.conflict) add("Line and note name different projects", p.project);
            else if (p.message) add(ErrorLog.SETTING.find(([re]) => re.test(p.message))?.[1] ?? "Project setting", p.project);
            else add("Projects inside each other", p.project);
        }
        return this.group(out);
    }

    // [{ kind, link, name }] as one line's worth each, [{ kind, link, name, count }], in the log's order
    group(items) {
        const byKey = new Map();
        for (const i of items) {
            const k = this.key(i);
            if (byKey.has(k)) byKey.get(k).count++;
            else byKey.set(k, { ...i, count: 1 });
        }
        const rank = (kind) => { const r = ErrorLog.KINDS.indexOf(kind); return r === -1 ? ErrorLog.KINDS.length : r; };
        return [...byKey.values()].sort((a, b) => rank(a.kind) - rank(b.kind) || a.name.localeCompare(b.name) || a.link.localeCompare(b.link));
    }

    key(g) {
        return `${g.kind} · ${g.link}`;
    }

    // A section of the note: its heading, when it last changed and how many are open, and its lines
    render(section, groups, stamp) {
        const open = groups.reduce((n, g) => n + g.count, 0);
        const lines = [`## ${section}`, "", `Updated ${stamp} · ${open ? `${open} open` : "nothing to fix"}`];
        if (groups.length) lines.push("", ...groups.map((g) => `- ${g.kind}${g.count > 1 ? ` (${g.count})` : ""} · ${g.link}`));
        return lines.join("\n");
    }

    // The note's sections as Map(section → { body, lines: Map(key → count) })
    sections(text) {
        const out = new Map();
        const body = this.split(text).body;
        const parts = body.split(/^(?=## )/m).filter((p) => p.startsWith("## "));
        for (const part of parts) {
            const name = part.slice(3).split(/\r?\n/)[0].trim();
            const lines = new Map();
            for (const l of part.split(/\r?\n/)) {
                const m = l.match(/^- (.+?)(?: \((\d+)\))? · (.+)$/);
                if (m) lines.set(`${m[1]} · ${m[3]}`, m[2] ? Number(m[2]) : 1);
            }
            out.set(name, { body: part.trimEnd(), lines });
        }
        return out;
    }

    // The note's frontmatter (with its closing ---) and what follows it
    split(text) {
        const m = String(text ?? "").match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
        return m ? { front: m[0].replace(/\r?\n$/, ""), body: String(text).slice(m[0].length) } : { front: "", body: String(text ?? "") };
    }

    // The whole note with `section` set to `body`, the sections in their order, and anything you wrote
    // above the first section kept
    place(text, section, body, id = null) {
        const { front, body: rest } = this.split(text);
        const at = rest.search(/^## /m);
        const top = (at === -1 ? rest : rest.slice(0, at)).trim();
        const have = this.sections(text);
        const parts = ErrorLog.SECTIONS.map((s) => (s === section ? body : have.get(s)?.body)).filter(Boolean);
        for (const [s, v] of have) if (!ErrorLog.SECTIONS.includes(s)) parts.push(v.body);
        const head = front || (id ? `---\nid: ${id}\ntags:\n---` : "");
        return [head, top, parts.join("\n\n")].filter(Boolean).join("\n\n") + "\n";
    }

    // The groups that are new since `text` was written: not in its section, or more of them, each
    // with `added`, how many more
    fresh(text, section, groups) {
        const old = this.sections(text).get(section)?.lines ?? new Map();
        return groups.filter((g) => (old.get(this.key(g)) ?? 0) < g.count).map((g) => ({ ...g, added: g.count - (old.get(this.key(g)) ?? 0) }));
    }

    // Whether `section` already lists exactly `groups`
    same(text, section, groups) {
        const old = this.sections(text).get(section)?.lines;
        if (!old || old.size !== groups.length) return false;
        return groups.every((g) => old.get(this.key(g)) === g.count);
    }

    // The toast's words for a run's new lines
    toastText(source, fresh) {
        const count = (list) => list.reduce((s, g) => s + (g.added ?? g.count), 0);
        const n = count(fresh);
        const named = fresh.slice(0, 3).map((g) => `${g.kind}${(g.added ?? g.count) > 1 ? ` ×${g.added ?? g.count}` : ""} (${g.name})`);
        const more = fresh.length > 3 ? `, and ${count(fresh.slice(3))} more` : "";
        return `${source}: ${n} new problem${n === 1 ? "" : "s"}: ${named.join(", ")}${more}.`;
    }

    // Writes `section` from this run's groups, when its list changed, and returns the new ones. Only
    // a device that may create the note does when it's missing (the desktop, as for periodic notes).
    async write(section, groups, { create = false } = {}) {
        const file = app.vault.getFileByPath(ErrorLog.PATH);
        if (!file && !create) return [];
        const before = file ? await app.vault.read(file) : "";
        const fresh = this.fresh(before, section, groups);
        if (file && this.same(before, section, groups)) return fresh;
        const body = this.render(section, groups, window.moment().format("M/D h:mma"));
        if (file) {
            await app.vault.process(file, (text) => this.place(text, section, body));
        } else {
            const folder = ErrorLog.PATH.split("/").slice(0, -1).join("/");
            if (folder && !app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder);
            await app.vault.create(ErrorLog.PATH, this.place("", section, body, window.moment().format("YYYYMMDDHHmmssSS")));
        }
        return fresh;
    }

    // One toast for a run's new lines, with a link to the log
    toast(source, fresh) {
        if (!fresh.length) return;
        const words = this.toastText(source, fresh);
        new Notice(createFragment((f) => {
            f.appendText(`${words} `);
            f.createEl("a", { text: "View Error Logs", href: "#" }).addEventListener("click", (e) => {
                e.preventDefault();
                this.open();
            });
        }), 0);
    }

    // Opens the log in the pane you're in
    async open() {
        const file = app.vault.getFileByPath(ErrorLog.PATH);
        if (!file) { new Notice("No error log yet: the time report makes it, on the desktop"); return; }
        await app.workspace.getLeaf(false).openFile(file);
    }
}
