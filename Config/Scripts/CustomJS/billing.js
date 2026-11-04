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
        return String(text ?? "").replace(/\s+/g, " ").trim().replace(/(?<!\\)((?:\\\\)*)\|/g, "$1\\|")
            .replace(/(^|\s)#(?=[^\s#])/g, "$1\\#").replace(/</g, "&lt;");
    }

    // Text as a Billed entries cell reads back: defused, on one line, pipes unescaped. Task and note
    // text is compared this way, so a table round trip is never a change.
    stored(tr, text) {
        return this.tableText(tr.defuse(text)).replace(/\\\|/g, "|");
    }

    // Whether `text` from a daily note reads as `cell`, a Billed entries cell: compared as stored, without
    // the zero-width spaces defuse puts in, since what it escapes can change (OBS-238 left the report's
    // freeze comments whole, which an invoice made before escaped)
    readsAs(tr, text, cell) {
        const bare = (t) => String(t ?? "").replace(/\u200B/g, "");
        return bare(this.stored(tr, text)) === bare(cell);
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

    // A cell's text as it shows: without the %% comments that close in it
    shown(cell) {
        return String(cell ?? "").replace(/%%.*?%%/g, " ").replace(/\s+/g, " ").trim();
    }

    // ---------------------------------------------------------------- the Billed entries table

    // The Billed entries section for `rows` ({ date, start, end, minutes, billed, cents, project (a
    // path), task, note }): the heading, then a bold row per date with the day's hours, and that day's
    // entries under it without the date, oldest first. `linkText(path)` is the link text for a project.
    // Task and note are defused, so text quoted from a daily note can't open a comment in the invoice.
    billedLines(rows, tr, linkText) {
        const t = (s) => this.tableText(tr.defuse(s));
        const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
        const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.end - b.end);
        const out = [];
        for (const date of new Set(sorted.map((r) => r.date))) {
            const day = sorted.filter((r) => r.date === date);
            out.push([`**[[${date}\\|${tr.dayName(date).slice(0, 3)} ${md(date)}]]**`, "", "", "", "", "", `**${tr.hours(day.reduce((n, r) => n + r.billed, 0))}**`]);
            for (const r of day) {
                out.push(["", `${tr.formatTime(r.start)} - ${tr.formatTime(r.end)}`, r.project ? `[[${linkText(r.project)}]]` : "",
                    t(r.task), t(r.note), (r.cents / 100).toFixed(2), tr.hours(r.billed)]);
            }
        }
        // Padded as Obsidian pads it (TimeReport.table), so clicking into it doesn't change the invoice
        return [Billing.HEADING, "", ...tr.table(Billing.HEAD, [null, null, null, null, null, "right", "right"], out)];
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
                // The header as it shows: a comment in it, such as a freeze for Selectable Tables (OBS-238), draws as nothing
                const named = cells.map((c) => this.shown(c));
                if (named[0].toLowerCase() === "date") {
                    head = named.length === Billing.HEAD.length && named.every((c, n) => c.toLowerCase() === Billing.HEAD[n].toLowerCase());
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
            if (first && this.shown(cells[0]).toLowerCase() === "date") { head = true; first = false; continue; }
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
    // was made, while its `parent` may have been rewritten by a move since), else the one its `parent` links
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
        const linkedTo = (value) => {
            const link = String([].concat(value ?? [])[0] ?? "").match(/\[\[([^\]|#]+)/)?.[1]?.trim();
            const dest = link ? index.linkDest(link, path) : null;
            return dest && tr.counts(dest, index) ? dest : null;
        };
        // `project` before OBS-117; then `parent`, or `area` before OBS-175, read as the report reads it
        const project = linkedTo(p("project")) ?? linkedTo(tr.parentValue(props ?? {})) ?? tr.projectOfNote(path, index);
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
            // `unread`: its status can't be read, so it isn't taken for a draft. One that lost its tag but still
            // states a status is read by it.
            path, name: tr.basename(path), number: String(p("number") ?? tr.basename(path)), status, unread: !!error || (!tagged && !raw),
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
    //   open      none of these
    // Overlaps are checked on the day before and after too, for entries that cross midnight; touching
    // (one ends when the other starts) isn't overlapping.
    standing(e, ledger) {
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
        return { kind: "open" };
    }

    // The projects a project's invoices and timesheet cover: itself, and every project below it when
    // its `include_subprojects` checkbox is on
    // A live project's leave out its archived sub-projects, which are never invoiced (OBS-213).
    scope(project, model, tr, index) {
        const on = this.truthy(tr.prop(index.props?.(project) ?? {}, "include_subprojects"));
        return on ? new Set([...tr.subtree(project, model.parent)].filter((p) => tr.isArchived(p) === tr.isArchived(project))) : new Set([project]);
    }

    // The entries Billing can bill: every one but an archived project's (OBS-213)
    entries(model) {
        return model.entries.filter((e) => !e.archived);
    }

    hourly(project, model) {
        const m = model.money.get(project);
        return !!m && m.type === "hourly" && !!m.rate;
    }

    // Entries by date, for changes(); built once and passed in when checking many invoices. `live`, for
    // every row but an archived project's: the entries as read before OBS-213 (TimeReport.build's
    // billingEntries); `archived`, the report's archived entries (OBS-213); `all`, for an archived
    // project's rows: the archived entries, then the live ones, so its billed time now on a live
    // project's line at its day and times says so (OBS-215).
    byDate(model) {
        const group = (list) => {
            const out = new Map();
            for (const e of list) {
                if (!out.has(e.date)) out.set(e.date, []);
                out.get(e.date).push(e);
            }
            return out;
        };
        const live = model.billingEntries ?? this.entries(model);
        // A disputed line's archived entries too, so its billed row says it has two projects
        const archived = [...model.entries, ...(model.disputed ?? [])].filter((e) => e.archived);
        // Each line once: a live copy of an archived entry (`report` set) is there already as itself
        return { live: group(live), archived: group(archived), all: group([...archived, ...live.filter((e) => !e.report)]) };
    }

    // The projects `invoice`'s rows bill: each row's project link, or where that names no project, the
    // project of the entry at its day and times, counted or not, archived or live
    rowProjects(invoice, model, tr, index) {
        const out = new Set();
        const entries = [...model.entries, ...(model.disputed ?? [])];
        for (const r of invoice.rows) {
            if (r.projectPath && tr.counts(r.projectPath, index)) out.add(r.projectPath);
            else for (const e of entries) if (e.project && e.date === r.date && e.start === r.start && e.end === r.end) out.add(e.project);
        }
        return [...out];
    }

    // Whether an invoice touches `scope`: its project, or a row's project, is in it (or can't be told)
    touches(invoice, scope) {
        return !invoice.project || scope.has(invoice.project) || invoice.rows.some((r) => !r.projectPath || scope.has(r.projectPath));
    }

    // Every live invoice's changes, worked out once, for the timesheets and a new invoice alike, so the
    // two never disagree: changed: [{ invoice, change }], every change that isn't wording; byInvoice:
    // Map(invoice → its changes). Nothing is held back on a guess (OBS-215): a billed entry that isn't
    // at its day and times, or overlapping them, is gone.
    invoiceChanges(model, tr, index, ledger, { byDate = this.byDate(model) } = {}) {
        const changed = [], byInvoice = new Map();
        for (const invoice of ledger.invoices ?? []) {
            const list = this.changes(invoice, model, tr, index, ledger, { byDate, late: false }).changes;
            byInvoice.set(invoice, list);
            for (const change of list) if (change.kind !== "wording") changed.push({ invoice, change });
        }
        return { changed, byInvoice };
    }

    // What a new invoice for `project` would bill, through `through` (YYYY-MM-DD):
    //   entries    billable, ended, hourly, unbilled entries in scope, oldest first
    //   heldBack   [{ entry, invoice, row, why }], why one of:
    //                changed    it overlaps a billed row, or has a billed row's key on another project
    //                duplicate  the same day and times as an entry already on this invoice
    //   changed    [{ invoice, change }]: billed entries in scope that changed since their invoice
    //              (drafts included), and every gone billed entry on any invoice, since its time could
    //              be anywhere now (OBS-215), for the confirmation's Fix first
    //   notHourly  projects in scope with billable time that isn't billed by the hour
    //   problems   the model's Problems in scope, from the first entry considered (running clocks and
    //              time under a sub-task from any day: neither is an entry to consider) through `through`,
    //              running clocks first
    //   projectProblems  the project-level ones in scope (a rate that isn't a number, an entry on two
    //              invoices), without the invoice changes `changed` already lists
    //   bad        [{ invoice, problem }] an invoice in scope whose Billed entries can't be trusted:
    //              invoicing is refused
    //   cap        { used, cap } in minutes when billable time through `through` passes the cap
    select(model, tr, index, { project, through, ledger }) {
        if (!this.isoDate(through)) throw new Error(`Billing.select: "${through}" isn't a date`);
        // An archived project's time is never invoiced (OBS-213)
        const scope = new Set([...this.scope(project, model, tr, index)].filter((p) => !tr.isArchived(p)));
        const entries = [], heldBack = [], notHourly = new Set(), bad = [];
        let first = null;
        for (const invoice of ledger.invoices ?? []) {
            if (invoice.problem && this.touches(invoice, scope)) bad.push({ invoice, problem: invoice.problem });
        }
        const keys = new Set();
        for (const e of this.entries(model)) {
            if (!scope.has(e.project) || e.date > through || !e.billable) continue;
            if (!this.hourly(e.project, model)) { notHourly.add(e.project); continue; }
            const s = this.standing(e, ledger);
            if (s.kind === "billed") continue;
            if (first === null || e.date < first) first = e.date;
            if (s.kind === "changed") { heldBack.push({ entry: e, invoice: s.invoice, row: s.row, why: "changed" }); continue; }
            if (keys.has(this.key(e))) { heldBack.push({ entry: e, invoice: null, row: null, why: "duplicate" }); continue; }
            keys.add(this.key(e));
            entries.push(e);
        }
        const { changed: all } = this.invoiceChanges(model, tr, index, ledger);
        const changed = all.filter(({ invoice, change }) => this.touches(invoice, scope) || change.kind === "gone");
        const order = (a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.end - b.end;
        entries.sort(order);
        heldBack.sort((a, b) => order(a.entry, b.entry));
        const running = (p) => (p.kind === "open" ? 0 : 1);
        const floor = first ?? through;
        const problems = model.problems
            .filter((p) => p.date <= through && (p.date >= floor || p.kind === "open" || p.kind === "subtime") && (p.projects ?? []).some((x) => scope.has(x)))
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
        return { scope, entries, heldBack, changed, notHourly: [...notHourly].sort(), problems, projectProblems, bad, cap };
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
    //   disputed    same times, now on a line that disagrees with itself
    //   subtask     same times, now under a sub-task
    //   wording     same times, the task or note reads differently (not a change in billing)
    //   times       an entry of the same project or task overlaps it (across midnight too)
    //   gone        none of these. Nothing on another day or at other times is taken for it: without
    //               evidence in the notes that's a guess, so the row is gone, a Problem (OBS-215)
    // A row for an archived project is checked against the archived entries, then the live ones; any
    // other against the entries as Billing reads them, as before OBS-213.
    // late: entries in the invoice's scope and period, billable and hourly, on no invoice; never for an
    // archived project, whose time is never invoiced.
    changes(invoice, model, tr, index, ledger, { byDate = this.byDate(model), late: wantLate = true } = {}) {
        const abs = (x) => [this.day(x.date) * 1440 + x.start, this.day(x.date) * 1440 + x.end];
        const out = [];
        for (const row of invoice.rows) {
            const pool = row.projectPath && tr.isArchived(row.projectPath) ? byDate.all : byDate.live;
            const exact = (pool.get(row.date) ?? []).filter((e) => e.start === row.start && e.end === row.end);
            // A live entry first: a copy at the same times is an archived or disputed line's
            const same = exact.find((e) => !e.report && !e.disputed) ?? exact[0];
            // Billed time whose line now names two projects, or that's now under a sub-task, so it isn't
            // counted (Brian, 2026-10-28 and 2026-10-30)
            if (same?.disputed) { out.push({ row, kind: same.subTask ? "subtask" : "disputed", entry: same.report ?? same }); continue; }
            // Billed time whose line's ⭕ now names an archived project
            if (same?.report) { out.push({ row, kind: "project", entry: same.report }); continue; }
            if (same) {
                if (!same.project) out.push({ row, kind: "unassigned", entry: same });
                else if (!same.billable) out.push({ row, kind: "free", entry: same });
                else if (row.projectPath && same.project !== row.projectPath) out.push({ row, kind: "project", entry: same });
                else if (!this.readsAs(tr, same.task, row.task) || !this.readsAs(tr, same.note, row.note)) out.push({ row, kind: "wording", entry: same });
                continue;
            }
            const [rf, rt] = abs(row);
            const near = [-1, 0, 1].flatMap((d) => pool.get(this.date(this.day(row.date) + d)) ?? []);
            const over = near.find((e) => {
                const [f, t] = abs(e);
                return f < rt && rf < t && ((row.projectPath && e.project === row.projectPath) || this.readsAs(tr, e.task, row.task));
            });
            if (over) { out.push({ row, kind: "times", entry: over.report ?? over }); continue; }
            // Not found among the entries it could be: one with its times that counts toward an archived
            // project now says where the time went
            const archivedNow = row.projectPath && !tr.isArchived(row.projectPath)
                ? (byDate.archived.get(row.date) ?? []).find((e) => e.start === row.start && e.end === row.end) : null;
            out.push(archivedNow ? { row, kind: "project", entry: archivedNow } : { row, kind: "gone" });
        }
        const scope = wantLate && invoice.project ? this.scope(invoice.project, model, tr, index) : new Set();
        const late = !wantLate || !invoice.periodStart || !invoice.periodEnd || tr.isArchived(invoice.project) ? [] : this.entries(model).filter((e) => scope.has(e.project) && e.billable
            && this.hourly(e.project, model) && e.date >= invoice.periodStart && e.date <= invoice.periodEnd
            && this.standing(e, ledger).kind === "open");
        return { changes: out, late };
    }
}
