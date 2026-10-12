class Billing {
    // What's been billed, and where each time entry stands (OBS-5). An invoice note keeps its own copy
    // of every entry it bills, in a folded "Billed entries" section at its end. This class writes and
    // reads that table, and answers from it: which entries are billed and on which invoice, what a new
    // invoice would bill, and what changed in the daily notes since an invoice was made. Daily notes
    // are only read, and nothing else records billing, so the two can't disagree.
    //
    // An entry is known by its daily note's date and its start and end in minutes after that day's
    // midnight (an end past midnight is over 1440): "2026-09-11 780 870". Billed means it's in the
    // Billed entries of an invoice that isn't canceled; drafts count, so two drafts can't share an entry.
    // An invoice whose table can't be read in full stops that project's invoicing rather than letting
    // its entries look unbilled.
    //
    // Pure: nothing here touches `app`. `tr` is a TimeReport, for its parsing, rounding and project
    // lookups; `index` answers questions about notes as TimeReport's does.
    // The Billed entries section: a heading, then a bold row per date and that day's entries under it,
    // as the timesheets show them (OBS-145)
    static HEADING = "## Billed entries";
    static HEAD = ["Date", "Time", "Project", "Task", "Notes", "Rate", "Hours"];
    // The folded callout invoices were made with before OBS-145, still read so they keep billing
    static CALLOUT = "pm-billed";
    static CALLOUT_HEAD = ["Date", "Start", "End", "Minutes", "Hours", "Rate", "Project", "Task", "Note"];
    // An invoice's status property, its own so it never mixes with the projects' `status` (OBS-117)
    static STATUS = "invoice_status";

    key(e) {
        return `${e.date} ${e.start} ${e.end}`;
    }

    day(date) {
        return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 864e5;
    }

    date(n) {
        return new Date(n * 864e5).toISOString().slice(0, 10);
    }

    // A frontmatter date as YYYY-MM-DD, or null: "2026-09-02", "2026-09-02T09:00", a real day only
    isoDate(value) {
        const m = String(value ?? "").trim().match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
        return m && !Number.isNaN(this.day(m[1])) && this.date(this.day(m[1])) === m[1] ? m[1] : null;
    }

    // A checkbox property: true, or "true" / "yes" typed by hand
    truthy(value) {
        return value === true || /^(true|yes)$/i.test(String(value ?? "").trim());
    }

    // Text for a table cell: one line, every | escaped, and a #tag or an HTML tag quoted from a task
    // or note shown as text, so it can't tag the invoice or draw anything (as TimeReport.tableText)
    tableText(text) {
        return String(text ?? "").replace(/\s+/g, " ").trim().replace(/(?<!\\)\|/g, "\\|")
            .replace(/(^|\s)#(?=[^\s#])/g, "$1\\#").replace(/</g, "&lt;");
    }

    // Text as a Billed entries cell reads back: defused, on one line, pipes unescaped. Task and note
    // text is compared this way, so a table round trip is never a change.
    stored(tr, text) {
        return this.tableText(tr.defuse(text)).replace(/\\\|/g, "|");
    }

    // A table row's cells, `\|` read back as `|`. A `|` inside a [[link]] belongs to the link even when
    // its `\` is gone: moving a note with the Advanced Rename and Delete Handler plugin strips it from
    // every link in a table, and the row must still read (OBS-117).
    cells(line) {
        let s = line.trim();
        if (s.startsWith("|")) s = s.slice(1);
        if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
        const out = [];
        let cell = "", inLink = false;
        for (let i = 0; i < s.length; i++) {
            if (!inLink && s.startsWith("[[", i) && s.indexOf("]]", i + 2) !== -1) { inLink = true; cell += "[["; i++; continue; }
            if (inLink && s.startsWith("]]", i)) { inLink = false; cell += "]]"; i++; continue; }
            if (s[i] === "|" && s[i - 1] !== "\\" && !inLink) { out.push(cell); cell = ""; continue; }
            cell += s[i];
        }
        out.push(cell);
        return out.map((c) => c.trim().replace(/\\\|/g, "|"));
    }

    // ---------------------------------------------------------------- the Billed entries table

    // The Billed entries section for `rows` ({ date, start, end, minutes, billed, cents, project (a
    // path), task, note }): the heading, then a bold row per date with the day's hours, and that day's
    // entries under it without the date, oldest first. `linkText(path)` is the link text for a project.
    // Task and note are defused, so text quoted from a daily note can't open a comment in the invoice.
    billedLines(rows, tr, linkText) {
        const t = (s) => this.tableText(tr.defuse(s));
        const row = (c) => `| ${c.join(" | ")} |`;
        const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
        const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.end - b.end);
        const out = [Billing.HEADING, "", row(Billing.HEAD), "| --- | --- | --- | --- | --- | --: | --: |"];
        for (const date of new Set(sorted.map((r) => r.date))) {
            const day = sorted.filter((r) => r.date === date);
            out.push(row([`**[[${date}\\|${tr.dayName(date).slice(0, 3)} ${md(date)}]]**`, "", "", "", "", "", `**${tr.hours(day.reduce((n, r) => n + r.billed, 0))}**`]));
            for (const r of day) {
                out.push(row(["", `${tr.formatTime(r.start)} - ${tr.formatTime(r.end)}`, r.project ? `[[${linkText(r.project)}]]` : "",
                    t(r.task), t(r.note), (r.cents / 100).toFixed(2), tr.hours(r.billed)]));
            }
        }
        return out;
    }

    // The rows of an invoice's Billed entries: { rows, bad: [{ line, text }], found, head, both }. `head`
    // says whether the column names were there, and `both` that the note has two tables (two sections,
    // or the section and an old callout), whose rows all count. `project` comes back as link text, to
    // resolve with index.linkDest from the invoice's path.
    readBilled(text, tr) {
        const lines = String(text ?? "").split(/\r?\n/);
        const section = this.readSection(lines, tr), callout = this.readCallout(lines, tr);
        return {
            rows: [...section.rows, ...callout.rows], bad: [...section.bad, ...callout.bad],
            found: section.found || callout.found,
            head: (section.found || callout.found) && (!section.found || section.head) && (!callout.found || callout.head),
            both: (section.found && callout.found) || section.again,
        };
    }

    // The line that heads the Billed entries section, whatever its case
    isHeading(line) {
        return /^##\s+billed entries\s*$/i.test(String(line).trim());
    }

    // The Billed entries section, from its heading to the end of the note. Each entry takes its date
    // from the date row above it, so the date rows are checked as strictly as the entries: a date row
    // has its date and its hours and nothing else, and its hours are what its entries add up to. A day
    // that doesn't add up (a date row deleted, an entry dragged under another day; its date row is the
    // one that doesn't read), an entry with no date row above it, a date row holding more than its date
    // and hours, and a row after the table has ended don't read. Rows of a day that doesn't add up still count as billed: the
    // invoice is a Problem until it's fixed, and nothing it may have billed looks unbilled meanwhile.
    // `again` is a second Billed entries heading.
    readSection(lines, tr) {
        const rows = [], bad = [];
        const at = lines.findIndex((l) => this.isHeading(l));
        if (at === -1) return { rows, bad, found: false, head: false, again: false };
        let head = false, first = true, inTable = false, ended = false, again = false, day = null;
        const close = () => {
            if (!day) return;
            rows.push(...day.rows);
            // A row of its own that didn't read already says so
            if (!day.unread && (!day.rows.length || day.minutes !== day.rows.reduce((n, r) => n + r.billed, 0))) bad.push(day.at);
            day = null;
        };
        for (let i = at + 1; i < lines.length; i++) {
            const body = lines[i].trim();
            // A second section (a paste, a sync conflict) reads as a table of its own, so its rows count too
            if (this.isHeading(body)) { close(); again = true; inTable = false; ended = false; first = true; continue; }
            if (!body.startsWith("|")) { if (inTable) ended = true; continue; }
            if (ended) { bad.push({ line: i + 1, text: body }); continue; }
            inTable = true;
            const cells = this.cells(body);
            if (first) {
                first = false;
                if (cells[0].toLowerCase() === "date") {
                    head = cells.length === Billing.HEAD.length && cells.every((c, n) => c.toLowerCase() === Billing.HEAD[n].toLowerCase());
                    continue;
                }
            }
            if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
            // An empty row (Enter in the table) is nothing; a cleared entry still leaves its day short
            if (cells.every((c) => c === "")) continue;
            // A row with a date starts that day, even when it holds more than a date row should: it
            // doesn't read then, but the entries under it stay on its date, not the day before
            const date = cells[0].match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
            if (date && this.isoDate(date)) {
                close();
                const clean = cells.length === Billing.HEAD.length && [1, 2, 3, 4, 5].every((n) => cells[n] === "");
                const hours = Number(String(cells[6] ?? "").replace(/\*/g, ""));
                day = { date, minutes: cells[6] && Number.isFinite(hours) ? Math.round(hours * 60) : null, rows: [], at: { line: i + 1, text: body }, unread: !clean };
                if (!clean) bad.push({ line: i + 1, text: body });
                continue;
            }
            const row = day && cells[0] === "" ? this.readEntry(cells, day.date, tr) : null;
            if (row) day.rows.push(row);
            else {
                bad.push({ line: i + 1, text: body });
                if (day) day.unread = true;
            }
        }
        close();
        return { rows, bad, found: true, head, again };
    }

    // An entry row of the section, on `date`, or null: exactly the table's cells, and a project, since
    // a row that doesn't say whose time it was can't show that it moved to another project since
    readEntry(cells, date, tr) {
        if (cells.length !== Billing.HEAD.length || !date || !this.isoDate(date)) return null;
        const time = cells[1].match(/^(\S+)\s*[-–]\s*(\S+)$/);
        if (!time) return null;
        const row = this.times(date, time[1], time[2], tr);
        if (!row || cells[2] === "" || cells[5] === "" || cells[6] === "") return null;
        const rate = Number(cells[5].replace(/[$,]/g, "")), hours = Number(cells[6]);
        if (![hours, rate].every(Number.isFinite)) return null;
        const project = cells[2].match(/\[\[([^\]|#]+)/)?.[1]?.trim() ?? cells[2];
        return { ...row, billed: Math.round(hours * 60), cents: Math.round(rate * 100), project, task: cells[3], note: cells[4] };
    }

    // { date, start, end, minutes } from a start and an end as written, an end past midnight over 1440
    // (pm to am), or null
    times(date, startText, endText, tr) {
        const start = tr.minutes(startText);
        let end = tr.minutes(endText);
        if (start === null || end === null) return null;
        if (end <= start) {
            if (/pm$/i.test(startText) && /am$/i.test(endText)) end += 1440;
            else return null;
        }
        return { date, start, end, minutes: end - start };
    }

    // The old folded callout, read as it always was
    readCallout(lines, tr) {
        const opener = new RegExp(`^>\\s*\\[!${Billing.CALLOUT}\\]`, "i");
        const at = lines.findIndex((l) => opener.test(l.trim()));
        const rows = [], bad = [];
        if (at === -1) return { rows, bad, found: false, head: false };
        let head = false, first = true;
        for (let i = at + 1; i < lines.length && /^\s*>/.test(lines[i]); i++) {
            const body = lines[i].replace(/^\s*>\s?/, "").trim();
            if (!body.startsWith("|")) continue;
            const cells = this.cells(body);
            if (first && cells[0].toLowerCase() === "date") { head = true; first = false; continue; }
            first = false;
            if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
            const row = this.readRow(cells, tr);
            if (row) rows.push(row);
            else bad.push({ line: i + 1, text: body });
        }
        return { rows, bad, found: true, head };
    }

    // A row of the old callout, or null
    readRow(cells, tr) {
        if (cells.length < Billing.CALLOUT_HEAD.length) return null;
        const date = cells[0].match(/(\d{4}-\d{2}-\d{2})/)?.[1];
        if (!date || !this.isoDate(date)) return null;
        const row = this.times(date, cells[1], cells[2], tr);
        if (!row || cells[3] === "" || cells[4] === "" || cells[5] === "") return null;
        const minutes = Number(cells[3]), hours = Number(cells[4]), rate = Number(cells[5].replace(/[$,]/g, ""));
        if (![minutes, hours, rate].every(Number.isFinite)) return null;
        const project = cells[6].match(/\[\[([^\]|#]+)/)?.[1]?.trim() ?? (cells[6] || null);
        return { ...row, minutes, billed: Math.round(hours * 60), cents: Math.round(rate * 100), project, task: cells[7], note: cells[8] };
    }

    // ---------------------------------------------------------------- invoices

    // An invoice note, read. `status` is its `invoice_status` (OBS-117), else the `status` of an invoice
    // made before: lowercase, "canceled" for either spelling, "draft" when blank; any other word still
    // bills. `project` is the project an invoice made before OBS-114 names in `project` (fixed when it
    // was made, while its `area` may have been rewritten by a move since), else the one its `area` links
    // to (how invoices are written now), else the project its folder is in; each row's `projectPath` is where its project
    // link points. `problem` says why the invoice can't be trusted, or is null: its frontmatter doesn't
    // read (`error`), it's lost its `invoice` tag (`tagged` false: found by its Billed entries where
    // invoices are filed), no table, a row that doesn't read, no column names, no rows, or rows that
    // don't add up to its `hours` and `total`. Its rows still count as billed either way.
    readInvoice({ path, props = {}, text = "", tagged = true, error = null }, tr, index) {
        const p = (name) => tr.prop(props ?? {}, name);
        const filled = (v) => v !== undefined && v !== null && String(v).trim() !== "";
        const raw = String([p(Billing.STATUS), p("status")].find(filled) ?? "").trim().toLowerCase();
        const status = raw === "cancelled" ? "canceled" : raw || "draft";
        const linkedProject = (name) => {
            const link = String([].concat(p(name) ?? [])[0] ?? "").match(/\[\[([^\]|#]+)/)?.[1]?.trim();
            const dest = link ? index.linkDest(link, path) : null;
            return dest && tr.counts(dest, index) ? dest : null;
        };
        const project = linkedProject("project") ?? linkedProject("area") ?? tr.projectOfNote(path, index);
        const { rows, bad, found, head, both } = this.readBilled(text, tr);
        for (const r of rows) r.projectPath = r.project ? index.linkDest(r.project, path) : null;
        const minutes = rows.reduce((s, r) => s + r.billed, 0);
        const cents = this.rows(rows).reduce((s, r) => s + r.amount, 0);
        const given = (name) => { const v = p(name); return v === undefined || v === null || String(v).trim() === "" ? null : Number(v); };
        const hours = given("hours"), total = given("total");
        const n = bad.length;
        const problem = error ? "has frontmatter that doesn't read"
            : !tagged ? "isn't tagged `invoice` any more"
            : !found ? "has no Billed entries table"
            : both ? "has two Billed entries tables"
            : n ? `has ${n === 1 ? "a Billed entries row that doesn't" : `${n} Billed entries rows that don't`} read`
            : !head ? "has a Billed entries table without its column names"
            : !rows.length ? "has no rows in its Billed entries"
            : hours !== null && (!Number.isFinite(hours) || Math.round(hours * 60) !== minutes) ? `has Billed entries that add up to ${tr.hours(minutes)} hours, not its \`hours\` (${p("hours")})`
            : total !== null && (!Number.isFinite(total) || Math.round(total * 100) !== cents) ? `has Billed entries that add up to ${tr.money(cents)}, not its \`total\` (${p("total")})`
            : null;
        return {
            path, name: tr.basename(path), number: String(p("number") ?? tr.basename(path)), status,
            paid: this.isoDate(p("paid")), invoiceDate: this.isoDate(p("invoice_date")),
            periodStart: this.isoDate(p("period_start")), periodEnd: this.isoDate(p("period_end")), project, rows, bad, problem,
            // As the invoice states them, for the project's list of invoices (null when blank or not a number)
            hours: Number.isFinite(hours) ? hours : null, total: Number.isFinite(total) ? total : null,
        };
    }

    // What's billed: byKey (key → { invoice, row }), byDate (date → [{ invoice, row }]), invoices (the
    // live ones), and twice (a key already billed, on another invoice or on the same one:
    // [{ row, invoices: [first, second] }]). Canceled invoices bill nothing; `except` leaves one out
    // (a draft being rebuilt).
    ledger(invoices, { except = null } = {}) {
        const byKey = new Map(), byDate = new Map(), twice = [], live = [];
        for (const invoice of invoices) {
            if (invoice.path === except || invoice.status === "canceled") continue;
            live.push(invoice);
            for (const row of invoice.rows) {
                const k = this.key(row);
                const had = byKey.get(k);
                if (had) { twice.push({ row, invoices: [had.invoice, invoice] }); continue; }
                const hit = { invoice, row };
                byKey.set(k, hit);
                if (!byDate.has(row.date)) byDate.set(row.date, []);
                byDate.get(row.date).push(hit);
            }
        }
        return { byKey, byDate, twice, invoices: live };
    }

    // The next invoice number: one past the highest `1001-HBR`-style number (whatever follows the
    // dash), canceled ones included, or past `last` (Invoice Settings' `last_number`) when that's
    // higher, so a deleted invoice's number is never used again. Null for the very first, with no `last`.
    nextNumber(invoices, last = null) {
        const n = invoices.map((i) => String(i.number).match(/^(\d+)-(?!\d{2}-\d{2}$)/)?.[1]).filter(Boolean).map(Number);
        if (Number.isInteger(last) && last >= 0) n.push(last);
        return n.length ? Math.max(...n) + 1 : null;
    }

    // ---------------------------------------------------------------- where invoices are filed (OBS-112)

    // Invoice Settings' `folder` as a vault path: { folder, error }, with "" for none. Outer and
    // doubled slashes go. A part that's blank, `.`, `..`, starts with a dot or has spaces around it,
    // a character a link or a file name can't hold, a value that isn't one line of text, or a folder
    // inside `Config` or `Archive` is an error, so an invoice (or the Invoices base, which
    // UpdateObsidianPM places the same way) never lands outside the vault, in a hidden folder, or
    // where a base can't list it.
    folderOf(raw) {
        if (raw === undefined || raw === null) return { folder: "", error: null };
        const shown = typeof raw === "string" ? raw.trim() : JSON.stringify(raw);
        const bad = { folder: "", error: `isn't a folder in the vault (${shown})` };
        if (typeof raw !== "string" || /[\u0000-\u001f\u007f]/.test(raw)) return bad;
        const folder = raw.trim().replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
        if (!folder) return { folder: "", error: null };
        const parts = folder.split("/");
        if (/[\\:*?"<>|[\]#^]/.test(folder) || parts.some((p) => !p.trim() || p !== p.trim() || p.startsWith("."))) return bad;
        // The system's folder and the archive are often excluded, and a base doesn't list what's excluded
        if (["config", "archive"].includes(parts[0].toLowerCase())) return { folder: "", error: `is inside ${parts[0]}, where invoices don't belong (${shown})` };
        return { folder, error: null };
    }

    // Whether a note has Billed entries: the heading with any table row after it, or a line that opens
    // the old callout, as readBilled finds them; not the words anywhere (a note about invoices that
    // mentions them isn't one). Any row is enough, column names or not, text between them or not: a
    // table that came apart from its heading is a Problem, where missing it would let its entries be
    // billed again. A heading with no table under it bills nothing.
    hasBilled(text) {
        const lines = String(text ?? "").split(/\r?\n/);
        const at = lines.findIndex((l) => this.isHeading(l));
        return (at !== -1 && lines.slice(at + 1).some((l) => l.trim().startsWith("|")))
            || new RegExp(`^>\\s*\\[!${Billing.CALLOUT}\\]`, "im").test(String(text ?? ""));
    }

    // Where invoices are filed: a note in a folder named `invoices`, in any case, or anywhere under
    // `folder` (whole folder names, any case). TimeReport counts an untagged note there as an
    // invoice when it still has its Billed entries.
    inInvoiceFolder(path, folder = "") {
        const parts = String(path).split("/");
        if (parts.length > 1 && parts.at(-2).toLowerCase() === "invoices") return true;
        return !!folder && String(path).toLowerCase().startsWith(`${folder.toLowerCase()}/`);
    }

    // ---------------------------------------------------------------- entries

    // Where an entry stands:
    //   billed    its key is on an invoice, for the same project
    //   changed   a billed row overlaps it without matching it (a billed entry edited since), or has
    //             its key on another project (re-pointed since, or a different entry at the same times)
    //   before    on or before `through`, the project's billed_through
    //   open      none of these
    // Overlaps are checked on the day before and after too, for entries that cross midnight; touching
    // (one ends when the other starts) isn't overlapping.
    standing(e, ledger, through = null) {
        const hit = ledger.byKey.get(this.key(e));
        if (hit) return hit.row.projectPath && e.project && hit.row.projectPath !== e.project ? { kind: "changed", ...hit } : { kind: "billed", ...hit };
        const base = this.day(e.date) * 1440;
        const from = base + e.start, to = base + e.end;
        for (const d of [-1, 0, 1]) {
            for (const h of ledger.byDate.get(this.date(this.day(e.date) + d)) ?? []) {
                const hb = this.day(h.row.date) * 1440;
                if (hb + h.row.start < to && from < hb + h.row.end) return { kind: "changed", ...h };
            }
        }
        if (through && e.date <= through) return { kind: "before", through };
        return { kind: "open" };
    }

    // A project's billed_through, or its nearest parent's: { date, from } when set, { date: null, from,
    // bad } when set to something that isn't a date, { date: null } when nothing up the chain sets it.
    // A parent's date covers its sub-projects, as its rate does, unless they set their own.
    billedThrough(project, tr, index) {
        const seen = new Set();
        for (let p = project; p && !seen.has(p); p = tr.parentProject(p, index)) {
            seen.add(p);
            const raw = tr.prop(index.props?.(p) ?? {}, "billed_through");
            if (raw === undefined || raw === null || String(raw).trim() === "") continue;
            const date = this.isoDate(raw);
            return date ? { date, from: p } : { date: null, from: p, bad: String(raw) };
        }
        return { date: null };
    }

    // The projects a project's invoices and timesheet cover: itself, and every project below it when
    // its `include_subprojects` checkbox is on
    scope(project, model, tr, index) {
        const on = this.truthy(tr.prop(index.props?.(project) ?? {}, "include_subprojects"));
        return on ? tr.subtree(project, model.parent) : new Set([project]);
    }

    hourly(project, model) {
        const m = model.money.get(project);
        return !!m && m.type === "hourly" && !!m.rate;
    }

    // Entries by date, for changes(); built once and passed in when checking many invoices
    byDate(model) {
        const out = new Map();
        for (const e of model.entries) {
            if (!out.has(e.date)) out.set(e.date, []);
            out.get(e.date).push(e);
        }
        return out;
    }

    // Whether an invoice touches `scope`: its project, or a row's project, is in it (or can't be told)
    touches(invoice, scope) {
        return !invoice.project || scope.has(invoice.project) || invoice.rows.some((r) => !r.projectPath || scope.has(r.projectPath));
    }

    // Billed entries that changed without overlapping their billed times, so they look unbilled:
    // held: Map(entry → { invoice, row, why }), why "moved" (to another day) or "retimed" (new times on
    // the same day); changed: [{ invoice, change }], every change that isn't wording; byInvoice:
    // Map(invoice → its changes). Worked out once for all live invoices, for the timesheets and a new
    // invoice alike, so the two never disagree.
    holds(model, tr, index, ledger, { byDate = this.byDate(model) } = {}) {
        const held = new Map(), changed = [], byInvoice = new Map();
        for (const invoice of ledger.invoices ?? []) {
            const list = this.changes(invoice, model, tr, index, ledger, { byDate, late: false }).changes;
            byInvoice.set(invoice, list);
            for (const change of list) {
                if (change.kind === "wording") continue;
                changed.push({ invoice, change });
                const e = change.entry;
                if (!e || held.has(e) || this.standing(e, ledger).kind !== "open") continue;
                if (change.kind === "moved") held.set(e, { invoice, row: change.row, why: "moved" });
                if (change.kind === "times") held.set(e, { invoice, row: change.row, why: "retimed" });
            }
        }
        return { held, changed, byInvoice };
    }

    // What a new invoice for `project` would bill, through `through` (YYYY-MM-DD):
    //   entries    billable, ended, hourly, unbilled entries in scope, oldest first
    //   heldBack   [{ entry, invoice, row, why }], why one of:
    //                changed    it overlaps a billed row, or has a billed row's key on another project
    //                moved      a billed row's task and times, now on another day
    //                retimed    a billed row's day, project and task, whose billed times are gone
    //                duplicate  the same day and times as an entry already on this invoice
    //   changed    [{ invoice, change }]: billed entries in scope that changed since their invoice
    //              (drafts included), for the confirmation's Fix first
    //   notHourly  projects in scope with billable time that isn't billed by the hour
    //   problems   the model's Problems in scope, from the first entry considered (running clocks from
    //              any day) through `through`, running clocks first
    //   projectProblems  the project-level ones in scope (a rate that isn't a number, an entry on two
    //              invoices), without the invoice changes `changed` already lists
    //   before     how many entries billed_through covers
    //   bad        [{ project, value }] a billed_through that isn't a date, or [{ invoice, problem }] an
    //              invoice in scope whose Billed entries can't be trusted: invoicing is refused
    //   cap        { used, cap } in minutes when billable time through `through` passes the cap
    select(model, tr, index, { project, through, ledger }) {
        if (!this.isoDate(through)) throw new Error(`Billing.select: "${through}" isn't a date`);
        const scope = this.scope(project, model, tr, index);
        const entries = [], heldBack = [], notHourly = new Set(), bad = [];
        const thru = new Map();
        let before = 0, first = null;
        for (const p of scope) {
            const b = this.billedThrough(p, tr, index);
            thru.set(p, b.date);
            if (b.bad && !bad.some((x) => x.project === b.from)) bad.push({ project: b.from, value: b.bad });
        }
        for (const invoice of ledger.invoices ?? []) {
            if (invoice.problem && this.touches(invoice, scope)) bad.push({ invoice, problem: invoice.problem });
        }
        const keys = new Set();
        for (const e of model.entries) {
            if (!scope.has(e.project) || e.date > through || !e.billable) continue;
            if (!this.hourly(e.project, model)) { notHourly.add(e.project); continue; }
            const s = this.standing(e, ledger, thru.get(e.project));
            if (s.kind === "billed") continue;
            if (s.kind === "before") { before++; continue; }
            if (first === null || e.date < first) first = e.date;
            if (s.kind === "changed") { heldBack.push({ entry: e, invoice: s.invoice, row: s.row, why: "changed" }); continue; }
            if (keys.has(this.key(e))) { heldBack.push({ entry: e, invoice: null, row: null, why: "duplicate" }); continue; }
            keys.add(this.key(e));
            entries.push(e);
        }
        // Billed rows that moved or were retimed without overlapping: their entries look open, but
        // they were billed. Hold them back and say which invoice has them.
        const { held, changed: all } = this.holds(model, tr, index, ledger);
        for (let i = entries.length - 1; i >= 0; i--) {
            const h = held.get(entries[i]);
            if (h) heldBack.push({ entry: entries.splice(i, 1)[0], ...h });
        }
        const changed = all.filter(({ invoice }) => this.touches(invoice, scope));
        const order = (a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.end - b.end;
        entries.sort(order);
        heldBack.sort((a, b) => order(a.entry, b.entry));
        const running = (p) => (p.kind === "open" ? 0 : 1);
        const floor = first ?? through;
        const problems = model.problems
            .filter((p) => p.date <= through && (p.date >= floor || p.kind === "open") && (p.projects ?? []).some((x) => scope.has(x)))
            .sort((a, b) => running(a) - running(b) || a.date.localeCompare(b.date) || a.line - b.line);
        const projectProblems = model.projectProblems.filter((p) => scope.has(p.project) && !p.invoice);
        // The cap covers the project and every project below it, as on its note
        const m = model.money.get(project) ?? {};
        let cap = null;
        if (m.capMinutes) {
            const all = tr.subtree(project, model.parent);
            const used = model.entries.filter((e) => all.has(e.project) && e.billable && e.date <= through)
                .reduce((sum, e) => sum + tr.rounded(e.minutes), 0);
            if (used > m.capMinutes) cap = { used, cap: m.capMinutes };
        }
        return { scope, entries, heldBack, changed, notHourly: [...notHourly].sort(), problems, projectProblems, before, bad, cap };
    }

    // Billed entries rows for `entries`, at each entry's project's hourly rate
    snapshot(entries, model, tr) {
        return entries.map((e) => ({
            date: e.date, start: e.start, end: e.end, minutes: e.minutes, billed: tr.rounded(e.minutes),
            cents: Math.round(model.money.get(e.project).rate * 100), project: e.project, task: e.task ?? "", note: e.note ?? "",
        }));
    }

    // The invoice's lines: a row per date and rate, oldest first (higher rate first on a date), each
    // its rounded minutes added up, the amount in cents, and its tasks in order. TimeReport's totals
    // price time the same way, a day and a rate at a time.
    rows(billed) {
        const groups = new Map();
        for (const r of billed) {
            const k = `${r.date} ${r.cents}`;
            if (!groups.has(k)) groups.set(k, { date: r.date, cents: r.cents, minutes: 0, tasks: [] });
            const g = groups.get(k);
            g.minutes += r.billed;
            if (r.task && !g.tasks.includes(r.task)) g.tasks.push(r.task);
        }
        return [...groups.values()]
            .map((g) => ({ ...g, amount: Math.round((g.minutes * g.cents) / 60) }))
            .sort((a, b) => a.date.localeCompare(b.date) || b.cents - a.cents);
    }

    // What changed since `invoice` was made. changes: [{ row, kind, entry }], kind:
    //   free        same times, now 🆓 or non-billable
    //   unassigned  same times, now on no project
    //   project     same times, now on another project
    //   wording     same times, the task or note reads differently (not a change in billing)
    //   times       an entry of the same project or task overlaps it (across midnight too), or the only
    //               unbilled entry of its project and task that day has new times
    //   moved       the only unbilled entry with its task and times within three days, on another day
    //   gone        none of these (with several candidates for a move or a retime, a recurring meeting
    //               say, it's gone rather than a guess)
    // A row for a project that's been archived since is left alone: its entries are out of the model.
    // late: entries in the invoice's scope and period, billable and hourly, on no invoice and not
    // covered by billed_through.
    changes(invoice, model, tr, index, ledger, { byDate = this.byDate(model), late: wantLate = true } = {}) {
        const abs = (x) => [this.day(x.date) * 1440 + x.start, this.day(x.date) * 1440 + x.end];
        const out = [];
        const open = (e) => !ledger.byKey.has(this.key(e));
        for (const row of invoice.rows) {
            if (row.projectPath && tr.isArchived(row.projectPath)) continue;
            const same = (byDate.get(row.date) ?? []).find((e) => e.start === row.start && e.end === row.end);
            if (same) {
                if (!same.project) out.push({ row, kind: "unassigned", entry: same });
                else if (!same.billable) out.push({ row, kind: "free", entry: same });
                else if (row.projectPath && same.project !== row.projectPath) out.push({ row, kind: "project", entry: same });
                else if (this.stored(tr, same.task) !== row.task || this.stored(tr, same.note) !== row.note) out.push({ row, kind: "wording", entry: same });
                continue;
            }
            const [rf, rt] = abs(row);
            const near = [-1, 0, 1].flatMap((d) => byDate.get(this.date(this.day(row.date) + d)) ?? []);
            const over = near.find((e) => {
                const [f, t] = abs(e);
                return f < rt && rf < t && ((row.projectPath && e.project === row.projectPath) || this.stored(tr, e.task) === row.task);
            });
            if (over) { out.push({ row, kind: "times", entry: over }); continue; }
            // Exact times on another day are the stronger sign, so a move is looked for first
            const moved = [-3, -2, -1, 1, 2, 3].flatMap((d) => byDate.get(this.date(this.day(row.date) + d)) ?? [])
                .filter((e) => e.start === row.start && e.end === row.end && open(e) && this.stored(tr, e.task) === row.task);
            if (moved.length === 1) { out.push({ row, kind: "moved", entry: moved[0] }); continue; }
            const retimed = (byDate.get(row.date) ?? []).filter((e) => open(e) && e.billable && row.projectPath && e.project === row.projectPath
                && this.stored(tr, e.task) === row.task);
            out.push(retimed.length === 1 ? { row, kind: "times", entry: retimed[0] } : { row, kind: "gone" });
        }
        const scope = wantLate && invoice.project ? this.scope(invoice.project, model, tr, index) : new Set();
        const late = !wantLate || !invoice.periodStart || !invoice.periodEnd ? [] : model.entries.filter((e) => scope.has(e.project) && e.billable
            && this.hourly(e.project, model) && e.date >= invoice.periodStart && e.date <= invoice.periodEnd
            && this.standing(e, ledger, this.billedThrough(e.project, tr, index).date).kind === "open");
        return { changes: out, late };
    }
}
