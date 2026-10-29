class Invoice {
    // Command "Invoice" (OBS-5): makes an invoice note from the time logged in daily notes, and moves
    // one along once it's made. Run on a project note (or pick a project), it asks "Bill through" a
    // date, shows what it would bill and what needs fixing first, and writes a draft into the folder
    // Invoice Settings names (`folder`, OBS-112), else into the project's invoices/ folder. Its number
    // is one past the highest ever given (`last_number` there, or the highest invoice note's number),
    // so a deleted invoice's number is never used again. Run on an invoice note, it offers what fits
    // the invoice's status: Rebuild or Mark sent for a draft, Check for changes, Mark paid or Cancel
    // invoice once it's sent.
    //
    // The note is the invoice: its properties say what the Invoices base lists (its status is
    // `invoice_status`, OBS-117, and its project is the one `parent` links to, OBS-114), its body is what
    // Export to PDF prints (laid out by pm-invoice.css, with no links in it), and a folded Billed
    // entries callout at its end, which doesn't print, is its own copy of every entry it bills
    // (Billing reads and writes it). Your details come from Config/Invoice Settings.md, which updates
    // leave alone; the client's code, billing name and address from the note the project's `client`
    // links to. They're copied in when the invoice is made, so a sent invoice never changes.
    //
    // Only the invoice note (and the client's `code` once, and the settings note) is written. Daily
    // notes are only read. The pure methods come first, tested with vm; everything that touches `app`
    // is at the bottom.
    static SETTINGS = "Config/Invoice Settings.md";
    static FOLDER = "invoices";
    // The highest `last_number`: invoice numbers have at most six digits
    static MAX_NUMBER = 999999;
    static CHECK = "pm-invoice-check";
    static CHECK_START = "%% invoice-check:start %%";
    static CHECK_END = "%% invoice-check:end %%";
    static CODE = /^[A-Z0-9]{2,8}$/;
    static HEADING = "## Billable hours";
    // Through this, everything logged is in scope: for the first unbilled entry after a date
    static LAST_DAY = "9999-12-31";
    // The invoice's status property, as Billing reads it (Billing.STATUS; a test keeps the two equal)
    static STATUS = "invoice_status";

    // ---------------------------------------------------------------- pure

    md(date) {
        return `${+date.slice(5, 7)}/${+date.slice(8, 10)}`;
    }

    // A line item's date: "9/14", or "9/14/26" when the invoice spans two years
    label(date, span) {
        return span ? `${this.md(date)}/${date.slice(2, 4)}` : this.md(date);
    }

    // "9/12/2026", as the header prints the invoice date
    dateText(date) {
        return `${this.md(date)}/${date.slice(0, 4)}`;
    }

    escape(text) {
        return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    // A list property, or a string with one item per line: trimmed, blanks dropped
    list(value) {
        return [].concat(value ?? []).flatMap((v) => String(v ?? "").split(/\r?\n/)).map((v) => v.trim()).filter(Boolean);
    }

    // Your details, from the settings note's properties. `ok` once there's at least a name. `folder` is
    // where new invoices go ("" for the project's own invoices/ folder) and `lastNumber` the highest
    // number ever given (null when blank), from `folder` and `last_number` (OBS-112); `problem` says
    // what's wrong with either, which stops a new invoice but not a rebuild.
    readSettings(props = {}, billing) {
        const text = (v) => String(v ?? "").trim();
        const name = text(props.name);
        const folder = billing.folderOf(props.folder);
        const last = this.lastNumberOf(props.last_number);
        const problem = folder.error ? `\`folder\` ${folder.error}` : last.error ? `\`last_number\` ${last.error}` : null;
        return { name, address: this.list(props.address), terms: text(props.terms), paymentNote: text(props.payment_note),
            folder: folder.folder, lastNumber: last.number, problem, ok: !!name };
    }

    // `last_number`: a whole number from 0 to 999999, as a number or as digits, or null when blank
    lastNumberOf(raw) {
        if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) return { number: null, error: null };
        const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
        if (Number.isInteger(n) && n >= 0 && n <= Invoice.MAX_NUMBER) return { number: n, error: null };
        return { number: null, error: `isn't a whole number from 0 to ${Invoice.MAX_NUMBER} (${typeof raw === "string" ? raw.trim() : JSON.stringify(raw)})` };
    }

    // The note a project bills: its own `client`, else the nearest parent's. { path, name, code,
    // billingName, address } or { error }. `code` is upper-cased, "" when not set yet.
    readClient(project, tr, index) {
        let raw = null, from = null;
        const seen = new Set();
        for (let p = project; p && !seen.has(p); p = tr.parentProject(p, index)) {
            seen.add(p);
            const v = [].concat(tr.prop(index.props?.(p) ?? {}, "client") ?? [])[0];
            if (v !== undefined && v !== null && String(v).trim() !== "") { raw = String(v).trim(); from = p; break; }
        }
        if (!raw) return { error: `${tr.basename(project)} has no \`client\`; link the client's note from the project first` };
        const target = raw.match(/\[\[([^\]|#]+)/)?.[1]?.trim() ?? raw;
        const path = index.linkDest(target, from);
        if (!path) return { error: `The client ${raw} isn't a note yet; create it, then run Invoice again` };
        const props = index.props?.(path) ?? {};
        const name = tr.basename(path);
        return {
            path, name,
            code: String(tr.prop(props, "code") ?? "").trim().toUpperCase(),
            billingName: String(tr.prop(props, "billing_name") ?? "").trim() || name,
            address: this.list(tr.prop(props, "address")),
        };
    }

    // A code to suggest for a client: the first letters of its words, or its first three letters
    suggestCode(name) {
        const words = String(name).replace(/^@/, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
        const initials = words.map((w) => w[0]).join("").toUpperCase();
        return (words.length > 1 ? initials : (words[0] ?? "INV").slice(0, 3).toUpperCase()).slice(0, 8);
    }

    nameFor(number, code) {
        return `${number}-${code}`;
    }

    // The invoice's lines (Billing.rows) with their labels and descriptions: a description you typed
    // for that label and rate in `descriptions`, else the day's tasks
    lines(billed, billing, tr, descriptions = new Map()) {
        const rows = billing.rows(billed);
        const span = rows.length > 0 && rows[0].date.slice(0, 4) !== rows.at(-1).date.slice(0, 4);
        return rows.map((r) => {
            const label = this.label(r.date, span);
            const rate = tr.money(r.cents);
            return { ...r, label, rate, description: descriptions.get(`${label} ${rate}`) ?? billing.tableText(tr.defuse(r.tasks.join(", "))) };
        });
    }

    // The note's frontmatter, as lines between the --- markers
    frontmatter(d, tr) {
        const q = (s) => JSON.stringify(String(s));
        return [
            "---",
            `id: ${d.id}`,
            "aliases:",
            `  - ${q(`Invoice ${d.name}`)}`,
            "tags:",
            "  - invoice",
            "cssclasses:",
            "  - pm-invoice",
            `parent: ${q(d.parent)}`,
            `${Invoice.STATUS}: ${d.status}`,
            `number: ${q(d.name)}`,
            `client: ${q(`[[${d.clientLink}]]`)}`,
            `invoice_date: ${d.invoiceDate}`,
            `period_start: ${d.periodStart}`,
            `period_end: ${d.periodEnd}`,
            `hours: ${tr.hours(d.minutes)}`,
            `total: ${(d.cents / 100).toFixed(2)}`,
            `paid: ${d.paid ?? ""}`.trimEnd(),
            "---",
        ];
    }

    // What prints: the header, Billable hours and the payment note; then the Billed entries, which
    // don't. Nothing printed is a link. `d.check` (lines) goes first, between its markers.
    body(d, tr, billing) {
        const e = (s) => this.escape(tr.defuse(s));
        const lines = (list) => list.map(e).join("<br>");
        const fact = (label, value, strong = false) => `<p><span class="pm-invoice-label">${label}</span><br>${strong ? `<strong>${e(value)}</strong>` : e(value)}</p>`;
        const items = this.lines(d.billed, billing, tr, d.descriptions);
        const facts = [
            ...(d.requestedBy ? [fact("Requested by", d.requestedBy)] : []),
            ...(d.projectId ? [fact("Project ID", d.projectId)] : []),
            ...(d.terms ? [fact("Terms", d.terms)] : []),
            fact("Total hours", tr.hours(d.minutes), true),
            fact("Total due", tr.money(d.cents), true),
        ];
        const out = [
            ...(d.check ?? []),
            `# Invoice No. ${d.name}`,
            "",
            "<div class=\"pm-invoice-parties\">",
            `<div class="pm-invoice-party"><p class="pm-invoice-name">${e(d.from.name)}</p>${d.from.address.length ? `<p>${lines(d.from.address)}</p>` : ""}</div>`,
            `<div class="pm-invoice-facts">${fact("Invoice date", this.dateText(d.invoiceDate))}</div>`,
            "</div>",
            "<div class=\"pm-invoice-parties\">",
            `<div class="pm-invoice-party"><p class="pm-invoice-label">Bill to</p><p class="pm-invoice-name">${e(d.billTo.name)}</p>${d.billTo.address.length ? `<p>${lines(d.billTo.address)}</p>` : ""}</div>`,
            `<div class="pm-invoice-facts">${facts.join("")}</div>`,
            "</div>",
            "",
            Invoice.HEADING,
            "",
            "| Line item | Qty | Rate | Amount |",
            "| --- | --: | --: | --: |",
            ...items.map((r) => `| ${r.label} — ${r.description} | ${tr.hours(r.minutes)} | ${r.rate} | ${tr.money(r.amount)} |`),
            `| **Total** | **${tr.hours(d.minutes)}** |  | **${tr.money(d.cents)}** |`,
            "",
            ...(d.paymentNote ? [tr.defuse(d.paymentNote), ""] : []),
            ...billing.billedLines(d.billed, tr, d.linkText),
        ];
        return out.join("\n") + "\n";
    }

    // The whole note. `d.minutes` and `d.cents` are filled in from the billed rows.
    noteText(d, tr, billing) {
        const rows = billing.rows(d.billed);
        const full = { ...d, minutes: rows.reduce((s, r) => s + r.minutes, 0), cents: rows.reduce((s, r) => s + r.amount, 0) };
        return `${this.frontmatter(full, tr).join("\n")}\n${this.body(full, tr, billing)}`;
    }

    // The descriptions in a note's Billable hours table: Map("9/14 $95.00" → description)
    descriptions(text, billing) {
        const out = new Map();
        const lines = String(text ?? "").split(/\r?\n/);
        const at = lines.findIndex((l) => l.trim() === Invoice.HEADING);
        if (at === -1) return out;
        for (let i = at + 1; i < lines.length; i++) {
            const t = lines[i].trim();
            if (!t) { if (out.size || i > at + 2) break; continue; }
            if (!t.startsWith("|")) break;
            const cells = billing.cells(t);
            const item = cells[0].match(/^(\d{1,2}\/\d{1,2}(?:\/\d{2})?) — (.*)$/);
            if (item) out.set(`${item[1]} ${cells[2]}`, item[2].replace(/\|/g, "\\|"));
        }
        return out;
    }

    // The descriptions to carry into a rebuilt draft: the ones you changed, not the defaults (the
    // day's tasks when the draft was made), so a description you never touched follows new tasks
    keepDescriptions(oldText, oldBilled, billing, tr) {
        const defaults = new Map(this.lines(oldBilled, billing, tr).map((r) => [`${r.label} ${r.rate}`, r.description]));
        const kept = new Map();
        for (const [k, v] of this.descriptions(oldText, billing)) {
            if (defaults.get(k) !== v) kept.set(k, v);
        }
        return kept;
    }

    // The check block: a callout between its markers, which doesn't print
    checkLines(title, items = []) {
        return [Invoice.CHECK_START, `> [!${Invoice.CHECK}] ${title}`, ...items.map((i) => `> - ${i}`), Invoice.CHECK_END];
    }

    // Where the frontmatter ends: the line index of its closing ---, or -1 with none
    frontmatterEnd(lines) {
        if (lines[0]?.trimEnd() !== "---") return -1;
        return lines.findIndex((l, i) => i > 0 && l.trimEnd() === "---");
    }

    // The note with its check block replaced by `lines`, or removed when `lines` is null; a new one goes
    // right after the frontmatter. Everything else stays as it was.
    placeCheck(text, lines) {
        const nl = String(text).includes("\r\n") ? "\r\n" : "\n";
        const all = String(text).split(/\r?\n/);
        const start = all.findIndex((l) => l.trim() === Invoice.CHECK_START);
        const end = start === -1 ? -1 : all.findIndex((l, i) => i > start && l.trim() === Invoice.CHECK_END);
        if (start !== -1 && end !== -1) all.splice(start, end - start + 1, ...(lines ?? []));
        else if (lines) all.splice(this.frontmatterEnd(all) + 1, 0, ...lines);
        return all.join(nl);
    }

    // The note with frontmatter keys set to plain values (a status, a date, a number), each on its own
    // line; a key it doesn't have yet goes last. Null when the note has no frontmatter.
    setProps(text, props) {
        const nl = String(text).includes("\r\n") ? "\r\n" : "\n";
        const lines = String(text).split(/\r?\n/);
        let end = this.frontmatterEnd(lines);
        if (end === -1) return null;
        for (const [key, value] of Object.entries(props)) {
            const line = `${key}: ${value ?? ""}`.trimEnd();
            const at = lines.findIndex((l, i) => i > 0 && i < end && new RegExp(`^${this.escapeKey(key)}\\s*:`, "i").test(l));
            if (at === -1) { lines.splice(end, 0, line); end++; continue; }
            let next = at + 1;
            while (next < end && /^\s+\S|^-\s/.test(lines[next])) next++;   // a list under the key goes too
            lines.splice(at, next - at, line);
            end -= next - at - 1;
        }
        return lines.join(nl);
    }

    // The frontmatter without `keys` (and any list under one), or null when there's none
    removeProps(text, keys) {
        const nl = String(text).includes("\r\n") ? "\r\n" : "\n";
        const lines = String(text).split(/\r?\n/);
        let end = this.frontmatterEnd(lines);
        if (end === -1) return null;
        for (const key of keys) {
            const at = lines.findIndex((l, i) => i > 0 && i < end && new RegExp(`^${this.escapeKey(key)}\\s*:`, "i").test(l));
            if (at === -1) continue;
            let next = at + 1;
            while (next < end && /^\s+\S|^-\s/.test(lines[next])) next++;
            lines.splice(at, next - at);
            end -= next - at;
        }
        return lines.join(nl);
    }

    // The date the invoice prints in its header, set to `date`; the rest of the note as it was
    setPrintedDate(text, date) {
        return String(text).replace(/(<span class="pm-invoice-label">Invoice date<\/span><br>)[^<]*/, (_, label) => `${label}${this.dateText(date)}`);
    }

    // A property name as a pattern that matches only itself
    escapeKey(key) {
        return String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    // An invoice's status set, with `props`. On an invoice made before OBS-117, its `status` line is
    // renamed where it stands; any other `status` is taken out, so the note never has two.
    setStatus(text, status, props = {}) {
        const lines = String(text).split(/\r?\n/);
        const end = this.frontmatterEnd(lines);
        if (end === -1) return null;
        const has = (key) => lines.some((l, i) => i > 0 && i < end && new RegExp(`^${this.escapeKey(key)}\\s*:`, "i").test(l));
        let base = String(text);
        if (!has(Invoice.STATUS) && has("status")) {
            const nl = base.includes("\r\n") ? "\r\n" : "\n";
            const at = lines.findIndex((l, i) => i > 0 && i < end && /^status\s*:/i.test(l));
            lines[at] = lines[at].replace(/^status(\s*:)/i, `${Invoice.STATUS}$1`);
            base = lines.join(nl);
        }
        const set = this.setProps(base, { [Invoice.STATUS]: status, ...props });
        return set === null ? null : this.removeProps(set, ["status"]);
    }

    // The note split at its frontmatter: { front: "---\n…\n---", body }
    split(text) {
        const nl = String(text).includes("\r\n") ? "\r\n" : "\n";
        const lines = String(text).split(/\r?\n/);
        const end = this.frontmatterEnd(lines);
        return end === -1 ? { front: "", body: String(text) } : { front: lines.slice(0, end + 1).join(nl), body: lines.slice(end + 1).join(nl) };
    }

    // What the check says about an invoice: Billing.changes, as list items
    changeItems(result, tr) {
        const when = (r) => `[[${r.date}|${tr.shortDate(r.date)}]] ${tr.formatTime(r.start)} - ${tr.formatTime(r.end)}`;
        const now = (c) => ({
            times: `now ${tr.formatTime(c.entry?.start)} - ${tr.formatTime(c.entry?.end)}`,
            free: "now 🆓",
            unassigned: "now on no project",
            project: `now on [[${tr.basename(c.entry?.project ?? "")}]]`,
            disputed: "now on a line with two projects, so it isn't counted",
            gone: `but now it's missing from [[${c.row.date}|the daily note]]; put it back there to settle it`,
            wording: "reads differently now (not a change in what's billed)",
        })[c.kind];
        return [
            ...result.changes.map((c) => `${c.kind === "gone" ? tr.missingRow(c.row) : when(c.row)} was billed, ${now(c)}`),
            ...result.late.map((e) => `Logged in this period after the invoice, not billed: ${when(e)} ${tr.tableText(e.task)}`),
        ];
    }

    // What a draft needs before it's sent: the Problems and held-back entries select() found. A gone
    // billed entry reads as on its project's note, and one on another project's invoice names that
    // project, since its time could be on this one now (OBS-215).
    // `others: false` leaves out another project's missing rows: the confirmation warns about them, as
    // the time being billed may be one, but a draft's note is no place for another client's invoice.
    beforeSendingItems(sel, tr, { others = true } = {}) {
        const when = (e) => `[[${e.date}|${tr.shortDate(e.date)}]] ${tr.formatTime(e.start)} - ${tr.formatTime(e.end)}`;
        const why = {
            changed: (h) => `overlaps ${tr.formatTime(h.row.start)} - ${tr.formatTime(h.row.end)}, billed on [[${h.invoice.name}]]`,
            duplicate: () => "repeats another entry at the same times",
        };
        // Named by the row's own project, else its invoice's: a parent's invoice bills its sub-projects' time
        const whose = ({ invoice, change }) => change.row.projectPath ?? invoice.project;
        const other = (c) => c.change.kind === "gone" && !!whose(c) && !sel.scope?.has(whose(c));
        const gone = (c) => {
            const line = tr.invoiceProblem(c, (p) => `[[${tr.basename(p)}]]`).replace(/^- /, "");
            return other(c) ? `${tr.basename(whose(c))}'s ${line}` : line;
        };
        return [
            ...sel.problems.filter((p) => tr.changesBilling(p)).map((p) => `[[${p.date}|${tr.shortDate(p.date)}]] line ${p.line}: \`${String(p.text).replace(/`/g, "'")}\` ${p.message}`),
            ...sel.changed.filter((c) => others || !other(c)).map((c) => (c.change.kind === "gone" ? gone(c) : `${when(c.change.row)} on [[${c.invoice.name}]] changed since it was billed (${c.change.kind})`)),
            ...sel.heldBack.map((h) => `Held back: ${when(h.entry)} ${why[h.why](h)}`),
        ];
    }

    // The settings note a first run makes: blanks to fill in, and a line saying what it's for (a body,
    // so Templater's new-file template leaves its frontmatter alone)
    settingsText(id) {
        return [
            "---",
            `id: ${id}`,
            "tags:",
            "name:",
            "address:",
            "terms: Net 30",
            "payment_note:",
            "folder:",
            "last_number: 1000",
            "---",
            "Your details for invoices. The Invoice command copies them into each new invoice: `name` and `address` (one line per item) head it, `terms` and `payment_note` close it. A project's own `terms` wins over these. This note is yours: updates leave it alone.",
            "",
            "`folder` is where new invoices go, like `Business/Invoices`; left blank, each goes into its project's `invoices/` folder. *Update Obsidian PM* puts the Invoices base there too. `last_number` is the highest invoice number given so far: the next invoice is one more than it, or than the highest invoice note's number if that's higher, and the Invoice command raises it each time, so a deleted invoice's number is never used again.",
            "",
        ].join("\n");
    }

    // ---------------------------------------------------------------- the command

    async invoke() {
        const tr = customJS.TimeReport, billing = customJS.Billing;
        if (!tr || !billing || !customJS.DatePrompt) { new Notice("Invoice: CustomJS is still loading; try again in a moment"); return; }
        try {
            const file = app.workspace.getActiveFile();
            if (file && this.isInvoice(file)) { await this.actions(file, tr, billing); return; }
            const index = tr.appIndex();
            if (!this.ready(tr, index)) return;
            const project = file && tr.counts(file.path, index) ? file.path : await this.pickProject(tr, billing, index);
            // An archived project's time is never invoiced (OBS-213)
            if (project && tr.isArchived(project)) { new Notice(`${tr.basename(project)} is archived, so it isn't invoiced`); return; }
            if (project) await this.create(project, tr, billing, index);
        } catch (e) {
            // The time report already said why it waits for the one-time conversion (OBS-208)
            if (e?.oldMarks) return;
            console.error("Invoice failed", e);
            new Notice(`Invoice failed: ${e.message}`);
        }
    }

    // The vault has been indexed: projects are known, and so is every invoice (otherwise the ledger
    // would be empty, and everything would look unbilled)
    ready(tr, index) {
        const cache = app.metadataCache;
        if ((cache.inProgressTaskCount ?? 0) > 0 || cache.initialized === false || !app.vault.getMarkdownFiles().some((f) => tr.counts(f.path, index))) {
            new Notice("Invoice: Obsidian is still indexing the vault; try again in a moment");
            return false;
        }
        return true;
    }

    // A note tagged `invoice` in its frontmatter
    isInvoice(file) {
        const fm = app.metadataCache.getFileCache(file)?.frontmatter;
        return !!fm && customJS.TimeReport.tagsOf({ frontmatter: fm }).includes("invoice");
    }

    // The projects with time to bill: those with an ended, billable, hourly entry on no invoice, and the
    // projects above them that invoice their sub-projects; and the flat fees with time and no `earned`
    async pickProject(tr, billing, index) {
        const working = new Notice("Working out what's unbilled…", 0);
        let model;
        try { ({ model } = await tr.currentModel({ index })); } finally { working.hide(); }
        const candidates = new Set();
        const money = new Map();
        const moneyOf = (p) => { if (!money.has(p)) money.set(p, tr.moneyOf(p, index).money); return money.get(p); };
        for (const e of billing.entries(model)) {
            if (!e.project || tr.isArchived(e.project)) continue;
            if (model.money.get(e.project)?.type === "flat") {
                // Every flat fee its time is part of that isn't earned yet: its own, and any set above it
                for (let p = e.project, seen = new Set(); p && !seen.has(p); p = tr.parentProject(p, index)) {
                    seen.add(p);
                    if (moneyOf(p).fee && !moneyOf(p).earned && !tr.isArchived(p)) candidates.add(p);
                }
                continue;
            }
            if (!e.billable || !billing.hourly(e.project, model)) continue;
            if (billing.standing(e, model.billing.ledger).kind !== "open") continue;
            candidates.add(e.project);
            for (let up = model.parent.get(e.project); up; up = model.parent.get(up)) {
                if (!tr.isArchived(up) && billing.scope(up, model, tr, index).has(e.project)) candidates.add(up);
            }
        }
        if (!candidates.size) { new Notice("Nothing unbilled on any project"); return null; }
        const aliasOf = (p) => [].concat(index.props(p)?.aliases ?? [])[0] || tr.basename(p);
        const items = [...candidates].sort((a, b) => aliasOf(a).localeCompare(aliasOf(b)));
        const { FuzzySuggestModal } = customJS.obsidian;
        return new Promise((resolve) => {
            let picked = null;
            const modal = new (class extends FuzzySuggestModal {
                getItems() { return items; }
                getItemText(p) { return aliasOf(p); }
                onChooseItem(p) { picked = p; }
                // Obsidian closes the modal before it reports the choice
                onClose() { setTimeout(() => resolve(picked), 0); }
            })(app);
            modal.setPlaceholder("Invoice which project? (Esc: cancel)");
            modal.open();
        });
    }

    // Makes a draft invoice for `project`; for a flat fee, records when it was earned instead
    async create(project, tr, billing, index) {
        if (tr.moneyOf(project, index).money.type === "flat") {
            // A flat project that invoices its sub-projects' time can do either
            const both = billing.truthy(tr.prop(index.props(project) ?? {}, "include_subprojects"));
            const pick = both ? await this.pickOne(["Record when its flat fee was earned", "Invoice its sub-projects' time"], `${tr.basename(project)}: which? (Esc: cancel)`) : 0;
            if (pick === null) return;
            if (pick === 0) { await this.earnFlat(project, tr, index); return; }
        }
        const settings = await this.settings(tr);
        if (!settings) return;
        if (settings.problem) { new Notice(`${settings.problem} in ${tr.basename(Invoice.SETTINGS)}; fix it there, then run Invoice again`, 0); return; }
        if (!settings.folder && tr.basename(tr.dirname(project)) !== tr.basename(project)) {
            new Notice(`${tr.basename(project)} isn't its folder's own note, so it has no invoices/ folder; set \`folder\` in ${tr.basename(Invoice.SETTINGS)} to file every invoice in one place`, 0);
            return;
        }
        const client = this.readClient(project, tr, index);
        if (client.error) { new Notice(client.error); return; }

        const through = await this.askDate("Bill through");
        if (!through) return;
        const working = new Notice("Working out what to bill…", 0);
        let model, sel;
        try {
            ({ model } = await tr.currentModel({ index }));
            sel = billing.select(model, tr, index, { project, through, ledger: model.billing.ledger });
        } finally { working.hide(); }
        if (!this.billable(project, model, sel, tr, billing, through)) return;
        // No number to count from: an older settings note, and no invoice yet (OBS-112)
        if (settings.lastNumber === null && billing.nextNumber(model.billing.invoices) === null) {
            await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath(Invoice.SETTINGS));
            new Notice("Set `last_number` here to the number before your first invoice (1000 to start at 1001), then run Invoice again", 0);
            return;
        }
        if (!(await this.confirm(project, through, sel, model, tr, billing))) return;

        if (client.code && !Invoice.CODE.test(client.code)) {
            new Notice(`The \`code\` on ${client.name} (${client.code}) isn't 2 to 8 letters or digits; fix it there, then run Invoice again`, 0);
            return;
        }
        const code = client.code || await this.askCode(client, tr);
        if (!code) return;
        // `last_number` as it is now: the prompts may have been open a while
        const now = await this.lastNumberNow(tr, billing);
        if (now.error) { new Notice(`\`last_number\` ${now.error} in ${tr.basename(Invoice.SETTINGS)}; fix it there, then run Invoice again`, 0); return; }
        const next = billing.nextNumber(model.billing.invoices, now.number);
        const name = this.nameFor(next, code);
        const folder = this.realFolder(settings.folder || `${tr.dirname(project)}/${Invoice.FOLDER}`);
        const path = `${folder}/${name}.md`;
        if (app.vault.getAbstractFileByPath(path)) { new Notice(`${name} already exists`); return; }

        const projectFile = app.vault.getFileByPath(project);
        const alias = [].concat(app.metadataCache.getFileCache(projectFile)?.frontmatter?.aliases ?? [])[0] || projectFile.basename;
        const linkText = (p) => { const f = app.vault.getFileByPath(p); return f ? app.metadataCache.fileToLinktext(f, path, true) : tr.basename(p); };
        const props = index.props(project) ?? {};
        const text = this.noteText({
            id: window.moment().format("YYYYMMDDHHmmssSS"), name, status: "draft",
            parent: `[[${linkText(project)}|${alias}]]`, clientLink: linkText(client.path),
            invoiceDate: window.moment().format("YYYY-MM-DD"), periodStart: sel.entries[0].date, periodEnd: through,
            from: settings, billTo: { name: client.billingName, address: client.address },
            projectId: String(tr.prop(props, "client_project_id") ?? "").trim(), requestedBy: String(tr.prop(props, "requested_by") ?? "").trim(),
            terms: String(tr.prop(props, "terms") ?? "").trim() || settings.terms, paymentNote: settings.paymentNote,
            billed: billing.snapshot(sel.entries, model, tr), linkText,
            check: this.beforeSending(sel, tr),
        }, tr, billing);
        await this.makeFolders(folder);
        const file = await app.vault.create(path, text);
        // Billed entries starts folded (OBS-145), saved before the note opens
        await this.foldBilled(file, text, billing);
        // Only once the note exists, so a failure before it can't skip a number
        await this.raiseLastNumber(next, name, tr);
        // Wait for the index to know it's an invoice, so a second run can't bill its entries again
        await this.indexed(file);
        await app.workspace.getLeaf(false).openFile(file);
        const hours = sel.entries.reduce((s, e) => s + tr.rounded(e.minutes), 0);
        new Notice(`${name}: a draft for ${tr.hours(hours)} hours`);
        await this.refreshReport();
    }

    // The note whose `rate` is the flat fee `project` is part of: itself, or the nearest project above
    // it that sets one; null when none does
    feeHolder(project, tr, index) {
        for (let p = project, seen = new Set(); p && !seen.has(p); p = tr.parentProject(p, index)) {
            seen.add(p);
            if (tr.moneyOf(p, index).money.fee) return p;
        }
        return null;
    }

    // A flat fee can't be invoiced yet (OBS-165). Until it can, Invoice asks when the fee was earned and
    // sets `earned` on the note that sets the fee: TimeReport counts the fee as that day's Earnings
    // (OBS-133). Run again, it changes the date.
    async earnFlat(project, tr, index) {
        const name = tr.basename(project);
        const holder = this.feeHolder(project, tr, index);
        if (!holder) { new Notice(`${name} is a flat fee with no \`rate\`; set its fee first`, 0); return; }
        if (holder !== project) { new Notice(`${name} is part of ${tr.basename(holder)}'s flat fee; run Invoice on ${tr.basename(holder)}`, 0); return; }
        const m = tr.moneyOf(holder, index).money;
        const fee = tr.money(Math.round(m.fee * 100)).replace(/\.00$/, "");
        const date = await this.askDate(m.earned ? `${name}'s ${fee} fee: earned on (now ${tr.shortDate(m.earned)})` : `${name}'s ${fee} fee: earned on`);
        if (!date) return;
        // A day still to come is fine (a fee invoiced ahead): the report counts it in its period now, and
        // the project's summary shows the date, so a year read wrong ("2/1" in October) is easy to see
        const file = app.vault.getFileByPath(holder);
        const read = this.nextChange(file);
        await app.fileManager.processFrontMatter(file, (fm) => {
            // The property as it's already spelled, if it is
            const key = Object.keys(fm).find((k) => k.toLowerCase() === "earned") ?? "earned";
            fm[key] = date;
        });
        // The report reads properties from the metadata cache, which can lag the edit
        await read;
        new Notice(`${name}: its ${fee} fee counts as earned on ${tr.shortDate(date)}`);
        await this.refreshReport();
    }

    // Resolves when the metadata cache next reads `file`, or after two seconds
    nextChange(file) {
        return new Promise((resolve) => {
            const done = () => { app.metadataCache.offref(ref); clearTimeout(timer); resolve(); };
            const ref = app.metadataCache.on("changed", (f) => { if (f === file) done(); });
            const timer = setTimeout(done, 2000);
        });
    }

    // The index of the item picked from `items`, or null when dismissed
    pickOne(items, placeholder) {
        const { FuzzySuggestModal } = customJS.obsidian;
        return new Promise((resolve) => {
            let picked = null;
            const modal = new (class extends FuzzySuggestModal {
                getItems() { return items; }
                getItemText(item) { return item; }
                onChooseItem(item) { picked = items.indexOf(item); }
                // Obsidian closes the modal before it reports the choice
                onClose() { setTimeout(() => resolve(picked), 0); }
            })(app);
            modal.setPlaceholder(placeholder);
            modal.open();
        });
    }

    // Says why nothing can be billed, and returns false; true when there's something to bill. On a
    // draft being rebuilt, nothing to bill leaves the draft as it is.
    billable(project, model, sel, tr, billing, through, { rebuild = false } = {}) {
        const name = tr.basename(project);
        if (sel.bad.length) {
            const b = sel.bad[0];
            new Notice(`${b.invoice.name} ${b.problem}; fix it before invoicing ${name}`, 0);
            return false;
        }
        const type = model.money.get(project)?.type ?? String(tr.prop(model.billing.index.props(project) ?? {}, "rate_type") ?? "").trim().toLowerCase();
        if (!sel.entries.length && type && type !== "hourly") {
            new Notice(`${name} isn't billed by the hour, so there's nothing to invoice from its time`);
            return false;
        }
        if (!sel.entries.length && rebuild) {
            new Notice("Nothing left to bill on this draft, so it's unchanged. To discard it, delete its note (its number isn't given again).", 0);
            return false;
        }
        if (!sel.entries.length) {
            const held = sel.heldBack.length ? `, ${sel.heldBack.length} held back (marked ⚠️ in the project's timesheet)` : "";
            // The time is all billed, or comes later: say which, so it doesn't read as a failure (OBS-149)
            const next = billing.select(model, tr, model.billing.index, { project, through: Invoice.LAST_DAY, ledger: model.billing.ledger }).entries[0];
            const when = (d) => (d.slice(0, 4) === through.slice(0, 4) ? this.md(d) : tr.shortDate(d));
            const after = next ? ` The next unbilled time is on ${when(next.date)}.` : " There's none after it either.";
            new Notice(`Nothing unbilled on ${name} through ${this.md(through)}${held}.${after}`);
            return false;
        }
        return true;
    }

    // The draft's check block, when there's anything to fix before it's sent
    beforeSending(sel, tr) {
        const items = this.beforeSendingItems(sel, tr, { others: false });
        return items.length ? this.checkLines("Before sending", items) : null;
    }

    // The settings, or null after making or opening the settings note for you to fill in
    async settings(tr) {
        let file = app.vault.getFileByPath(Invoice.SETTINGS);
        if (!file) {
            file = await app.vault.create(Invoice.SETTINGS, this.settingsText(window.moment().format("YYYYMMDDHHmmssSS")));
        } else {
            const s = this.readSettings(await this.propsOf(file, tr), customJS.Billing);
            if (s.ok) return s;
        }
        await app.workspace.getLeaf(false).openFile(file);
        new Notice("Fill in your details for invoices here, then run Invoice again", 0);
        return null;
    }

    // A note's properties, read from its text (the metadata cache can lag an edit)
    async propsOf(file, tr) {
        const { getFrontMatterInfo, parseYaml } = customJS.obsidian;
        const info = getFrontMatterInfo(await tr.textOf(file));
        try { return info.exists ? parseYaml(info.frontmatter) ?? {} : {}; } catch (e) { return app.metadataCache.getFileCache(file)?.frontmatter ?? {}; }
    }

    // Resolves once the metadata cache has read `file` (or after two seconds)
    indexed(file) {
        if (app.metadataCache.getFileCache(file)?.frontmatter) return Promise.resolve();
        return new Promise((resolve) => {
            const done = () => { app.metadataCache.offref(ref); clearTimeout(timer); resolve(); };
            const ref = app.metadataCache.on("changed", (f) => { if (f === file) done(); });
            const timer = setTimeout(done, 2000);
        });
    }

    // Refreshes the time report so the timesheets show the change: on the desktop, as at startup
    async refreshReport() {
        if (!customJS.obsidian.Platform.isDesktop) { new Notice("The timesheets update the next time the desktop app runs the time report: at startup, or the TimeReport command"); return; }
        if (window.timeReportRunning) { new Notice("The timesheets update once the time report that's running now has finished, or at the next run"); return; }
        await customJS.TimeReport.refresh({ quiet: true });
    }

    // A date from the date prompt (the box starts at "today"), or null when dismissed. A month and day
    // without a year is whichever is closer, this year's or the next (OBS-143): billing looks back at
    // work done as often as ahead, so "9/16" in October is last month's.
    askDate(title) {
        return new Promise((resolve) => {
            let picked = null;
            const modal = customJS.DatePrompt.open(title, (result, m) => { picked = result.date; m.close(); }, { nearest: true });
            if (!modal) { resolve(null); return; }
            const closed = modal.onClose?.bind(modal);
            modal.onClose = () => { closed?.(); setTimeout(() => resolve(picked), 0); };
            const input = modal.contentEl.querySelector("input");
            if (input) { input.value = "today"; input.dispatchEvent(new Event("input")); }
        });
    }

    // A line of text from a small prompt, or null when dismissed. `check(value)` returns an error to show.
    askText(title, description, value, check) {
        const { Modal, TextComponent, ButtonComponent } = customJS.obsidian;
        return new Promise((resolve) => {
            let answer = null;
            const modal = new (class extends Modal {
                onClose() { setTimeout(() => resolve(answer), 0); }
                // Focused once the modal is open, a frame later (OBS-50)
                onOpen() { requestAnimationFrame(() => { input.inputEl.focus(); input.inputEl.select(); }); }
            })(app);
            modal.titleEl.setText(title);
            modal.contentEl.createEl("p", { text: description });
            const input = new TextComponent(modal.contentEl).setValue(value);
            input.inputEl.style.width = "100%";
            const error = modal.contentEl.createDiv({ cls: "setting-item-description" });
            const accept = () => {
                const v = input.getValue().trim();
                const problem = check(v);
                if (problem) { error.setText(problem); return; }
                answer = v;
                modal.close();
            };
            const row = modal.contentEl.createDiv({ cls: "modal-button-container" });
            new ButtonComponent(row).setButtonText("Cancel").onClick(() => modal.close());
            new ButtonComponent(row).setButtonText("OK").setCta().onClick(accept);
            modal.scope.register([], "Enter", () => { accept(); return false; });
            modal.open();
        });
    }

    // The client's invoice code, asked once and saved on the client's note
    async askCode(client, tr) {
        const code = await this.askText("Client code", `Invoices for ${client.name} are numbered like 1001-${this.suggestCode(client.name)}. Its code goes on its note as \`code\`.`,
            this.suggestCode(client.name), (v) => (Invoice.CODE.test(v.toUpperCase()) ? null : "2 to 8 letters or digits"));
        if (!code) return null;
        const file = app.vault.getFileByPath(client.path);
        await app.fileManager.processFrontMatter(file, (fm) => { fm.code = code.toUpperCase(); });
        return code.toUpperCase();
    }

    // `path` with each folder the vault already has spelled as it is there, matched in any case: on a
    // Mac, createFolder refuses a folder that differs from one it has only in case
    realFolder(path) {
        let parent = app.vault.getRoot();
        return path.split("/").map((part) => {
            const folders = (parent?.children ?? []).filter((c) => c.children);
            const have = folders.find((c) => c.name === part) ?? folders.find((c) => c.name.toLowerCase() === part.toLowerCase());
            parent = have ?? null;
            return have ? have.name : part;
        }).join("/");
    }

    // Makes the folders `path` needs, one at a time
    async makeFolders(path) {
        let at = "";
        for (const part of path.split("/")) {
            at = at ? `${at}/${part}` : part;
            const have = app.vault.getAbstractFileByPath(at);
            if (!have) await app.vault.createFolder(at);
            else if (!have.children) throw new Error(`${at} is a file, not a folder`);
        }
    }

    // `last_number` read from the settings note now: { number, error }
    async lastNumberNow(tr, billing) {
        const file = app.vault.getFileByPath(Invoice.SETTINGS);
        if (!file) return { number: null, error: null };
        const s = this.readSettings(await this.propsOf(file, tr), billing);
        return { number: s.lastNumber, error: s.problem?.startsWith("`last_number`") ? s.problem.replace(/^`last_number` /, "") : null };
    }

    // Raises `last_number` in the settings note to `n`, never lowering it, by rewriting that one line,
    // so the rest of the note stays as you wrote it. Should that fail, the new note still holds its
    // number, which the next run counts, so no number is given twice.
    async raiseLastNumber(n, name, tr) {
        const { getFrontMatterInfo, parseYaml } = customJS.obsidian;
        try {
            const file = app.vault.getFileByPath(Invoice.SETTINGS);
            if (!file) throw new Error("the note is gone");
            let found = true;
            await app.vault.process(file, (text) => {
                const info = getFrontMatterInfo(text);
                const now = this.lastNumberOf(info.exists ? (parseYaml(info.frontmatter) ?? {}).last_number : null).number;
                if (now !== null && now >= n) return text;
                const after = this.setProps(text, { last_number: n });
                if (after === null) { found = false; return text; }
                return after;
            });
            if (!found) throw new Error("its properties weren't found");
        } catch (e) {
            console.error("Invoice: couldn't raise last_number", e);
            new Notice(`${name} is made, but \`last_number\` in ${tr.basename(Invoice.SETTINGS)} couldn't be set to ${n} (${e.message}); set it there by hand`, 0);
        }
    }

    // A confirmation item's text around its links: [{ text }] and [{ link, text }], a [[link|alias]]
    // showing its alias
    linkParts(text) {
        const s = String(text), out = [], re = /\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g;
        let at = 0, m;
        while ((m = re.exec(s))) {
            if (m.index > at) out.push({ text: s.slice(at, m.index) });
            out.push({ link: m[1], text: m[2] ?? m[1] });
            at = m.index + m[0].length;
        }
        if (at < s.length) out.push({ text: s.slice(at) });
        return out;
    }

    // Shows what an invoice would bill, and asks. Resolves true to create it.
    confirm(project, through, sel, model, tr, billing) {
        const { Modal, ButtonComponent } = customJS.obsidian;
        const hours = sel.entries.reduce((s, e) => s + tr.rounded(e.minutes), 0);
        const rows = billing.rows(billing.snapshot(sel.entries, model, tr));
        const cents = rows.reduce((s, r) => s + r.amount, 0);
        const fix = [...this.beforeSendingItems({ ...sel, heldBack: [] }, tr), ...tr.problemLines(model, [], sel.projectProblems.filter((p) => tr.changesBilling(p)), [], (p) => tr.basename(p)).map((l) => l.replace(/^- /, ""))];
        return new Promise((resolve) => {
            let go = false, opening = null;
            const modal = new (class extends Modal {
                onClose() {
                    setTimeout(() => {
                        resolve(go);
                        if (!opening) return;
                        // Only a note that's there: opening a missing one would make it, outside its
                        // folder. A heading or block after # is kept for opening, not for finding it.
                        const path = opening.split("#")[0];
                        if (!path) return;
                        if (app.metadataCache.getFirstLinkpathDest(path, "")) app.workspace.openLinkText(opening, "", false);
                        else new Notice(`There's no note ${path} in the vault`);
                    }, 0);
                }
                // Focused once the modal is open, a frame later (OBS-50): Cancel when something needs fixing
                onOpen() { requestAnimationFrame(() => (fix.length ? cancel : create).buttonEl.focus()); }
            })(app);
            modal.titleEl.setText(`Invoice ${tr.basename(project)} through ${this.md(through)}?`);
            // Selectable, so a missing entry's task and note can be copied back into its daily note
            modal.contentEl.style.userSelect = "text";
            const section = (title, items) => {
                if (!items.length) return;
                modal.contentEl.createEl("h4", { text: title });
                const ul = modal.contentEl.createEl("ul");
                for (const i of items) {
                    const li = ul.createEl("li");
                    for (const part of this.linkParts(i)) {
                        if (!part.link) {
                            // Quoted text, a line or a billed task, shows as code, as in a note
                            part.text.split(/`([^`]*)`/).forEach((t, n) => (n % 2 ? li.createEl("code", { text: t }) : li.appendText(t)));
                            continue;
                        }
                        // A link closes this without making the draft, and opens its note (OBS-215)
                        li.createEl("a", { text: part.text, cls: "internal-link" }).addEventListener("click", (ev) => {
                            ev.preventDefault();
                            opening = part.link;
                            modal.close();
                        });
                    }
                }
            };
            section("Fix first?", fix);
            section("Held back", this.beforeSendingItems({ problems: [], changed: [], heldBack: sel.heldBack }, tr).map((i) => i.replace(/^Held back: /, "")));
            section("Not billed by the hour", sel.notHourly.map((p) => tr.basename(p)));
            section("To bill", [
                `${this.md(sel.entries[0].date)} – ${this.md(through)}: ${sel.entries.length} ${sel.entries.length === 1 ? "entry" : "entries"}, ${tr.hours(hours)} hours, ${tr.money(cents)}`,
                ...(sel.cap ? [`This brings ${tr.basename(project)} to ${tr.hours(sel.cap.used)} of its ${tr.hours(sel.cap.cap)} hours`] : []),
            ]);
            const row = modal.contentEl.createDiv({ cls: "modal-button-container" });
            const cancel = new ButtonComponent(row).setButtonText("Cancel").onClick(() => modal.close());
            const create = new ButtonComponent(row).setButtonText(fix.length ? "Create anyway" : "Create draft").setCta().onClick(() => { go = true; modal.close(); });
            modal.open();
        });
    }

    // Asks a yes-or-no question with named buttons. Resolves to the picked button's key, or null.
    choose(title, text, buttons) {
        const { Modal, ButtonComponent } = customJS.obsidian;
        return new Promise((resolve) => {
            let picked = null;
            const made = [];
            const modal = new (class extends Modal {
                onClose() { setTimeout(() => resolve(picked), 0); }
                // Focused once the modal is open, a frame later (OBS-50): the last button
                onOpen() { requestAnimationFrame(() => made.at(-1)?.buttonEl.focus()); }
            })(app);
            modal.titleEl.setText(title);
            for (const line of [].concat(text)) modal.contentEl.createEl("p", { text: line });
            const row = modal.contentEl.createDiv({ cls: "modal-button-container" });
            for (const [key, label, cta] of buttons) {
                const b = new ButtonComponent(row).setButtonText(label).onClick(() => { picked = key; modal.close(); });
                if (cta) b.setCta();
                made.push(b);
            }
            modal.open();
        });
    }

    // ---------------------------------------------------------------- on an invoice note

    async actions(file, tr, billing) {
        const text = await tr.textOf(file);
        if (!billing.hasBilled(text)) {
            new Notice("This note has no Billed entries, so Invoice leaves it alone");
            return;
        }
        const index = tr.appIndex();
        const invoice = billing.readInvoice({ path: file.path, props: await this.propsOf(file, tr), text }, tr, index);
        const choices = {
            draft: [["rebuild", "Rebuild from the daily notes"], ["sent", "Mark sent"]],
            sent: [["check", "Check for changes"], ["paid", "Mark paid"], ["cancel", "Cancel invoice"]],
            paid: [["check", "Check for changes"]],
        }[invoice.status] ?? [["check", "Check for changes"]];
        if (invoice.status === "canceled") { new Notice(`${invoice.name} is canceled; its entries are unbilled again`); return; }
        const pick = await this.pickAction(invoice, choices);
        if (!pick) return;
        if (!this.ready(tr, index)) return;
        if (pick === "rebuild") await this.rebuild(file, invoice, text, tr, billing, index);
        if (pick === "sent") await this.markSent(file, invoice, tr, billing, index);
        if (pick === "paid") await this.mark(file, invoice, tr, { status: "paid", key: "paid", title: "Paid on" }, billing);
        if (pick === "cancel") await this.cancel(file, invoice, tr, billing);
        if (pick === "check") await this.check(file, invoice, tr, billing, index);
    }

    pickAction(invoice, choices) {
        const { FuzzySuggestModal } = customJS.obsidian;
        return new Promise((resolve) => {
            let picked = null;
            const modal = new (class extends FuzzySuggestModal {
                getItems() { return choices; }
                getItemText(c) { return c[1]; }
                onChooseItem(c) { picked = c[0]; }
                onClose() { setTimeout(() => resolve(picked), 0); }
            })(app);
            modal.setPlaceholder(`${invoice.name} is ${invoice.status}: what next? (Esc: cancel)`);
            modal.open();
        });
    }

    // Writes the whole new text of an invoice note: through its editor when it's open (the editor can be
    // ahead of the file), else in one step that refuses if the file changed since `before` was read
    async write(file, before, after, tr) {
        if (before === after) return true;
        const view = this.editorOf(file);
        if (view) {
            if (view.editor.getValue() !== before) { new Notice("The invoice changed while Invoice was working; run it again"); return false; }
            const { start, end, text } = this.changed(before, after);
            view.editor.replaceRange(text, view.editor.offsetToPos(start), view.editor.offsetToPos(end));
            return true;
        }
        let ok = true;
        await app.vault.process(file, (current) => {
            if (current !== before) { ok = false; return current; }
            return after;
        });
        if (!ok) new Notice("The invoice changed while Invoice was working; run it again");
        return ok;
    }

    // The open editor showing `file`, or null
    editorOf(file) {
        return app.workspace.getLeavesOfType("markdown").map((l) => l.view).find((v) => v?.file === file && v.editor) ?? null;
    }

    // The part of `before` that `after` replaces: before[start, end) becomes `text`
    changed(before, after) {
        let start = 0;
        while (start < before.length && start < after.length && before[start] === after[start]) start++;
        let tail = 0;
        while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
        return { start, end: before.length - tail, text: after.slice(start, after.length - tail) };
    }

    // write(), keeping the note's folds, Billed entries' among them. An open editor moves them itself;
    // a closed note's saved folds are for its old lines (a check block, a property), so they move here,
    // as TimeReport moves a report's.
    async writeKeepingFold(file, before, after, tr, billing) {
        const saved = this.editorOf(file) ? null : app.foldManager.load(file);
        if (!(await this.write(file, before, after, tr))) return false;
        if (!saved || saved.lines !== before.split("\n").length) return true;
        let { start, end, text } = this.changed(before, after);
        // shiftFolds reads an insert as going in after its line: lines put in at the start of one (a new
        // check block, above the title) go in at the end of the line before, the same text
        if (start === end && start > 0 && before[start - 1] === "\n" && text.endsWith("\n")) {
            start--; end--;
            text = `\n${text.slice(0, -1)}`;
        }
        await app.foldManager.save(file, { folds: tr.shiftFolds(saved.folds ?? [], before, start, end, text), lines: after.split("\n").length });
        return true;
    }

    // ---------------------------------------------------------------- folding Billed entries (OBS-145)

    // The Billed entries heading's fold in `text`, as Obsidian keeps folds: { from, to }, 0-based lines
    // from the heading to its section's last line that isn't blank. Null without one.
    billedFold(text, billing) {
        const lines = String(text ?? "").split("\n");
        const from = lines.findIndex((l) => billing.isHeading(l));
        if (from === -1) return null;
        let to = from + 1;
        while (to < lines.length && !/^#{1,2}\s/.test(lines[to])) to++;
        to--;
        while (to > from && !lines[to].trim()) to--;
        return to > from ? { from, to } : null;
    }

    // The note's folds as shown, when it's open, else as last saved: { folds, lines }, or null
    foldInfo(file) {
        const view = app.workspace.getLeavesOfType("markdown").map((l) => l.view).find((v) => v?.file === file);
        return (view ? view.currentMode.getFoldInfo?.() : app.foldManager.load(file)) ?? null;
    }

    // Folds Billed entries in `text`, the note's new text. An open view folds it too, keeping the folds
    // its editor moved with the write; a closed note keeps only its folded properties, since its saved
    // folds were for the old text (and Obsidian takes saved folds only for a note of as many lines).
    async foldBilled(file, text, billing) {
        const fold = this.billedFold(text, billing);
        if (!fold) return;
        const lines = String(text).split("\n").length;
        const view = this.editorOf(file);
        const now = this.foldInfo(file);
        const kept = (now?.folds ?? []).filter((f) => f.from !== fold.from && ((view && now.lines === lines) || (f.from === 0 && f.to === 0)));
        const info = { folds: [...kept, fold].sort((a, b) => a.from - b.from), lines };
        if (view) setTimeout(() => view.currentMode.applyFoldInfo?.(info), 50);
        await app.foldManager.save(file, info);
    }

    // A draft rebuilt from the daily notes as they are now, through its period_end, keeping the
    // descriptions you changed and anything you added to its frontmatter
    async rebuild(file, invoice, text, tr, billing, index) {
        if (!invoice.periodEnd) { new Notice(`${invoice.name} has no period_end to rebuild through; set it first`); return; }
        if (!invoice.project) { new Notice(`${invoice.name} has no project`); return; }
        if (tr.isArchived(invoice.project)) { new Notice(`${tr.basename(invoice.project)} is archived, so it isn't invoiced`); return; }
        const settings = await this.settings(tr);
        if (!settings) return;
        const client = this.readClient(invoice.project, tr, index);
        if (client.error) { new Notice(client.error); return; }
        const working = new Notice("Rebuilding…", 0);
        let model, sel;
        try {
            ({ model } = await tr.currentModel({ index }));
            const ledger = billing.ledger(model.billing.invoices, { except: file.path });
            sel = billing.select(model, tr, index, { project: invoice.project, through: invoice.periodEnd, ledger });
        } finally { working.hide(); }
        if (!this.billable(invoice.project, model, sel, tr, billing, invoice.periodEnd, { rebuild: true })) return;
        const linkText = (p) => { const f = app.vault.getFileByPath(p); return f ? app.metadataCache.fileToLinktext(f, file.path, true) : tr.basename(p); };
        const props = index.props(invoice.project) ?? {};
        const billed = billing.snapshot(sel.entries, model, tr);
        const rows = billing.rows(billed);
        const minutes = rows.reduce((s, r) => s + r.minutes, 0), cents = rows.reduce((s, r) => s + r.amount, 0);
        const d = {
            name: invoice.name, invoiceDate: invoice.invoiceDate ?? window.moment().format("YYYY-MM-DD"), minutes, cents,
            from: settings, billTo: { name: client.billingName, address: client.address },
            projectId: String(tr.prop(props, "client_project_id") ?? "").trim(), requestedBy: String(tr.prop(props, "requested_by") ?? "").trim(),
            terms: String(tr.prop(props, "terms") ?? "").trim() || settings.terms, paymentNote: settings.paymentNote,
            billed, linkText, descriptions: this.keepDescriptions(text, invoice.rows.map((r) => ({ ...r })), billing, tr),
            check: this.beforeSending(sel, tr),
        };
        const front = this.setProps(this.split(text).front, { period_start: sel.entries[0].date, hours: tr.hours(minutes), total: (cents / 100).toFixed(2) });
        const nl = text.includes("\r\n") ? "\r\n" : "\n";
        const after = `${front}${nl}${this.body(d, tr, billing).replace(/\n/g, nl)}`;
        if (!(await this.write(file, text, after, tr))) return;
        await this.foldBilled(file, after, billing);
        new Notice(`${invoice.name} rebuilt: ${tr.hours(minutes)} hours, ${tr.money(cents)}`);
        await this.refreshReport();
    }

    // Marks a draft sent, after offering to rebuild one that no longer matches the daily notes
    async markSent(file, invoice, tr, billing, index) {
        const { model } = await tr.currentModel({ index });
        const result = billing.changes(invoice, model, tr, index, model.billing.ledger);
        const stale = result.changes.filter((c) => c.kind !== "wording").length + result.late.length;
        // An archived project's draft can't be rebuilt (OBS-213), so it isn't offered
        if (stale && !tr.isArchived(invoice.project)) {
            const pick = await this.choose(`${invoice.name} is out of date`, [
                `${stale} ${stale === 1 ? "entry has" : "entries have"} changed or been logged in its period since the draft was made.`,
                "Rebuild it first, so it bills what the daily notes say now?",
            ], [["cancel", "Cancel"], ["send", "Mark sent anyway"], ["rebuild", "Rebuild", true]]);
            if (pick === "rebuild") { await this.rebuild(file, invoice, await tr.textOf(file), tr, billing, index); return; }
            if (pick !== "send") return;
        }
        // The invoice date is the day it's sent: set with the status, on the property and where it prints
        await this.mark(file, invoice, tr, { status: "sent", key: "invoice_date", title: "Invoice date (the day it's sent)", dropCheck: true, printed: true }, billing);
    }

    // Sets the status, and the date it happened, then refreshes the timesheets. `printed` also puts the
    // date where the invoice prints it.
    async mark(file, invoice, tr, { status, key, title, dropCheck = false, printed = false }, billing) {
        const date = await this.askDate(title);
        if (!date) return;
        const before = await tr.textOf(file);
        let after = this.setStatus(before, status, { [key]: date });
        if (after === null) { new Notice(`${invoice.name} has no frontmatter`); return; }
        if (printed) after = this.setPrintedDate(after, date);
        if (dropCheck) after = this.placeCheck(after, null);
        if (!(await this.writeKeepingFold(file, before, after, tr, billing))) return;
        new Notice(`${invoice.name} marked ${status} on ${this.md(date)}`);
        await this.refreshReport();
    }

    async cancel(file, invoice, tr, billing) {
        const pick = await this.choose(`Cancel ${invoice.name}?`, "Its entries become unbilled again, for the next invoice. The note stays, marked canceled.",
            [["keep", "Keep it"], ["cancel", "Cancel invoice", true]]);
        if (pick !== "cancel") return;
        const before = await tr.textOf(file);
        const after = this.setStatus(before, "canceled");
        if (after === null) { new Notice(`${invoice.name} has no frontmatter`); return; }
        if (!(await this.writeKeepingFold(file, before, after, tr, billing))) return;
        new Notice(`${invoice.name} canceled`);
        await this.refreshReport();
    }

    // Writes what changed since the invoice was made into its check block
    async check(file, invoice, tr, billing, index) {
        if (tr.isArchived(invoice.project)) { new Notice(`${invoice.name} is archived; not checked`); return; }
        if (invoice.problem) { new Notice(`${invoice.name} ${invoice.problem}; fix it first`, 0); return; }
        const { model } = await tr.currentModel({ index });
        const result = billing.changes(invoice, model, tr, index, model.billing.ledger);
        const items = this.changeItems(result, tr);
        const billingChanges = result.changes.filter((c) => c.kind !== "wording").length;
        const stamp = tr.shortDate(window.moment().format("YYYY-MM-DD"));
        const title = billingChanges || result.late.length ? `Changed since invoiced · checked ${stamp}` : `No changes since invoiced · checked ${stamp}`;
        const before = await tr.textOf(file);
        if (!(await this.writeKeepingFold(file, before, this.placeCheck(before, this.checkLines(title, items)), tr, billing))) return;
        new Notice(billingChanges || result.late.length ? `${invoice.name}: ${billingChanges} changed, ${result.late.length} logged since` : `${invoice.name}: no changes since invoiced`);
    }
}
