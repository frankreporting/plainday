class Billing {
    // What's been billed, and where each time entry stands (OBS-5). An invoice note keeps its own copy
    // of every entry it bills, in a folded "Billed entries" callout at its end. This class writes and
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
    static CALLOUT = "pm-billed";
    static HEAD = ["Date", "Start", "End", "Minutes", "Hours", "Rate", "Project", "Task", "Note"];

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

    // A table row's cells, `\|` read back as `|`
    cells(line) {
        let s = line.trim();
        if (s.startsWith("|")) s = s.slice(1);
        if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
        return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
    }

    // ---------------------------------------------------------------- the Billed entries table

    // The folded callout for `rows` ({ date, start, end, minutes, billed, cents, project (a path), task,
    // note }); `linkText(path)` is the link text for a project. Task and note are defused, so text
    // quoted from a daily note can't open a comment in the invoice.
    billedLines(rows, tr, linkText) {
        const t = (s) => this.tableText(tr.defuse(s));
        return [
            `> [!${Billing.CALLOUT}]- Billed entries`,
            `> | ${Billing.HEAD.join(" | ")} |`,
            "> | --- | --- | --- | --: | --: | --: | --- | --- | --- |",
            ...rows.map((r) => `> | [[${r.date}\\|${tr.shortDate(r.date)}]] | ${tr.formatTime(r.start)} | ${tr.formatTime(r.end)} | ${r.minutes} | `
                + `${tr.hours(r.billed)} | ${(r.cents / 100).toFixed(2)} | ${r.project ? `[[${linkText(r.project)}]]` : ""} | ${t(r.task)} | ${t(r.note)} |`),
        ];
    }

    // The rows of an invoice's Billed entries: { rows, bad: [{ line, text }], found, head }. `head` says
    // whether the column names were there. `project` comes back as link text, to resolve with
    // index.linkDest from the invoice's path.
    readBilled(text, tr) {
        const lines = String(text ?? "").split(/\r?\n/);
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

    readRow(cells, tr) {
        if (cells.length < Billing.HEAD.length) return null;
        const date = cells[0].match(/(\d{4}-\d{2}-\d{2})/)?.[1];
        const start = tr.minutes(cells[1]);
        let end = tr.minutes(cells[2]);
        if (!date || !this.isoDate(date) || start === null || end === null) return null;
        if (end <= start) {
            if (/pm$/i.test(cells[1]) && /am$/i.test(cells[2])) end += 1440;
            else return null;
        }
        if (cells[3] === "" || cells[4] === "" || cells[5] === "") return null;
        const minutes = Number(cells[3]), hours = Number(cells[4]), rate = Number(cells[5].replace(/[$,]/g, ""));
        if (![minutes, hours, rate].every(Number.isFinite)) return null;
        const project = cells[6].match(/\[\[([^\]|#]+)/)?.[1]?.trim() ?? (cells[6] || null);
        return { date, start, end, minutes, billed: Math.round(hours * 60), cents: Math.round(rate * 100), project, task: cells[7], note: cells[8] };
    }

    // ---------------------------------------------------------------- invoices

    // An invoice note, read. `status` is lowercase, "canceled" for either spelling, "draft" when blank;
    // any other word still bills. `project` is the path its `project` links to, else the project its
    // folder is in; each row's `projectPath` is where its project link points. `problem` says why the
    // invoice can't be trusted, or is null: its frontmatter doesn't read (`error`), it's lost its
    // `invoice` tag (`tagged` false: found by its Billed entries in an invoices/ folder), no table, a
    // row that doesn't read, no column names, no rows, or rows that don't add up to its `hours` and
    // `total`. Its rows still count as billed either way.
    readInvoice({ path, props = {}, text = "", tagged = true, error = null }, tr, index) {
        const p = (name) => tr.prop(props ?? {}, name);
        const raw = String(p("status") ?? "").trim().toLowerCase();
        const status = raw === "cancelled" ? "canceled" : raw || "draft";
        const link = String([].concat(p("project") ?? [])[0] ?? "").match(/\[\[([^\]|#]+)/)?.[1]?.trim();
        const linked = link ? index.linkDest(link, path) : null;
        const project = (linked && tr.counts(linked, index) ? linked : null) ?? tr.projectOfNote(path, index);
        const { rows, bad, found, head } = this.readBilled(text, tr);
        for (const r of rows) r.projectPath = r.project ? index.linkDest(r.project, path) : null;
        const minutes = rows.reduce((s, r) => s + r.billed, 0);
        const cents = this.rows(rows).reduce((s, r) => s + r.amount, 0);
        const given = (name) => { const v = p(name); return v === undefined || v === null || String(v).trim() === "" ? null : Number(v); };
        const hours = given("hours"), total = given("total");
        const n = bad.length;
        const problem = error ? "has frontmatter that doesn't read"
            : !tagged ? "isn't tagged `invoice` any more"
            : !found ? "has no Billed entries table"
            : n ? `has ${n === 1 ? "a Billed entries row that doesn't" : `${n} Billed entries rows that don't`} read`
            : !head ? "has a Billed entries table without its column names"
            : !rows.length ? "has no rows in its Billed entries"
            : hours !== null && (!Number.isFinite(hours) || Math.round(hours * 60) !== minutes) ? `has Billed entries that add up to ${tr.hours(minutes)} hours, not its \`hours\` (${p("hours")})`
            : total !== null && (!Number.isFinite(total) || Math.round(total * 100) !== cents) ? `has Billed entries that add up to ${tr.money(cents)}, not its \`total\` (${p("total")})`
            : null;
        return {
            path, name: tr.basename(path), number: String(p("number") ?? tr.basename(path)), status,
            sent: this.isoDate(p("sent")), paid: this.isoDate(p("paid")), invoiceDate: this.isoDate(p("invoice_date")),
            periodStart: this.isoDate(p("period_start")), periodEnd: this.isoDate(p("period_end")), project, rows, bad, problem,
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
    // dash), canceled ones included, or null for the very first
    nextNumber(invoices) {
        const n = invoices.map((i) => String(i.number).match(/^(\d+)-(?!\d{2}-\d{2}$)/)?.[1]).filter(Boolean).map(Number);
        return n.length ? Math.max(...n) + 1 : null;
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
