import { Modal, moment, Notice } from "obsidian";
import { app, plainday } from "../host.js";

export default class JumpToDate {
    // Set on this device when "Don't ask again" is ticked; the prompt offers to undo it
    static SKIP_KEY = "obsidian-pm-jump-create-without-asking";
    static TEMPLATE = { week: "Weekly Note", month: "Monthly Note", year: "Yearly Note" };
    static NN_TEMPLATE = { week: "calendarCustomWeekTemplate", month: "calendarCustomMonthTemplate", year: "calendarCustomYearTemplate" };

    // Command: type a date and open its note (OBS-89). A day opens its daily note; this, next or last
    // week, month or year opens the weekly, monthly or yearly note, and so does a note's own name
    // (2026w40, 2026-10). Weeks and names follow the user's settings (DatePrompt.weekRules). ⌘Enter
    // opens it in a split to the right. A note that doesn't exist yet is created from its template,
    // after asking.
    async invoke() {
        const rules = plainday.DatePrompt.weekRules();
        plainday.DatePrompt.open("Jump to", async (result, modal, event) => {
            modal.close();
            let target;
            try {
                target = this.target(result, rules);
                let file = app.vault.getFileByPath(target.path);
                if (!file) {
                    if (!this.skipping() && !(await this.confirm(target))) return;
                    file = await this.create(target);
                }
                const split = event.metaKey || event.ctrlKey;
                const leaf = split ? app.workspace.getLeaf("split", "vertical") : app.workspace.getLeaf(false);
                await leaf.openFile(file);
            } catch (err) {
                console.error("JumpToDate:", err);
                new Notice(`Couldn't open ${target?.name ?? "that note"}: ${err.message}`);
            }
        }, {
            periods: true,
            // Jumping goes back as often as forward: "9/16" is the closer 9/16, not always the next
            nearest: true,
            name: (text) => this.fromName(text, rules),
            // A week's note name after "Week starting 9/13", so "w38" shows it's 2026w38
            label: (result) => (result.unit === "week" ? this.periodName(result, rules) : null),
            extra: (el, { focus }) => this.askAgainLine(el, focus),
        });
    }

    // A week or a month in words, read before Revived sees them: "w38", "wk 38", "week 38", with a
    // year before or after ("2027 w1", "w1 2027"); "sep", "sept", "september", "Sep 2026",
    // "2026 sep", "9/2026". Without a year, this year. `months` and `short` are the locale's month
    // names. Returns { unit, year, n, withYear } (n the week or month number; withYear when a year was
    // typed), or null.
    static periodWords(text, { months, short, year }) {
        const t = String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
        const week = t.match(/^(?:(\d{4}) ?)?(?:w|wk|week) ?(\d{1,2})(?: (\d{4}))?$/);
        if (week) return week[1] && week[3] ? null : { unit: "week", year: Number(week[1] ?? week[3] ?? year), n: Number(week[2]), withYear: !!(week[1] ?? week[3]) };
        const numeric = t.match(/^(\d{1,2})\/(\d{4})$/);
        if (numeric) return { unit: "month", year: Number(numeric[2]), n: Number(numeric[1]), withYear: true };
        const named = t.match(/^(?:(\d{4}) )?([\p{L}.]+)(?: (\d{4}))?$/u);
        if (!named || (named[1] && named[3])) return null;
        const word = named[2].replace(/\.$/, "");
        const plain = (names) => [].concat(names ?? []).map((n) => String(n).toLowerCase().replace(/\.$/, ""));
        let i = plain(months).indexOf(word);
        if (i < 0) i = plain(short).indexOf(word);
        if (i < 0 && word === "sept") i = 8;
        return i < 0 ? null : { unit: "month", year: Number(named[1] ?? named[3] ?? year), n: i + 1, withYear: !!(named[1] ?? named[3]) };
    }

    // Whether a week or a month ({ date, unit }, `date` its first day) is over by `today`
    static over({ date, unit }, today) {
        if (unit === "month") return date.slice(0, 7) < today.slice(0, 7);
        const [y, m, d] = date.split("-").map(Number);
        return new Date(Date.UTC(y, m - 1, d + 6)).toISOString().slice(0, 10) < today;
    }

    // The locale's month names, full and short (a locale can keep separate forms for "in a date" and
    // "on its own"; the ones on their own are what you'd type)
    monthNames(rules) {
        const data = moment.localeData(rules.locale);
        const list = (names) => (Array.isArray(names) ? names : names?.standalone ?? names?.format ?? []);
        return { months: list(data.months()), short: list(data.monthsShort()) };
    }

    // A week or a month in words, or a periodic note's own name as typed ("2026w41", "2026-10",
    // "2027"): { date, unit }, or null. With `ahead` (Schedule), words without a year for a week or a
    // month that's over mean next year's: "jan" in October is the coming January.
    fromName(text, rules, { ahead = false } = {}) {
        const words = JumpToDate.periodWords(text, { ...this.monthNames(rules), year: moment().year() });
        if (words) {
            const found = this.fromWords(words, rules);
            if (ahead && found && !words.withYear && JumpToDate.over(found, moment().format("YYYY-MM-DD"))) {
                return this.fromWords({ ...words, year: words.year + 1 }, rules);
            }
            return found;
        }
        for (const unit of ["week", "month", "year"]) {
            const m = moment(text, rules.format[unit], rules.locale, true);
            if (m.isValid() && m.format(rules.format[unit]) === text) {
                // A week's name already reads as its first day; startOf("week") would move that to the
                // locale's first day, which for ISO weeks in English is the Sunday of the week before
                return { date: (unit === "week" ? m : m.clone().startOf(unit)).format("YYYY-MM-DD"), unit };
            }
        }
        return null;
    }

    // A week number counted the way the weekly notes count them (ISO weeks when their pattern uses
    // GGGG or WW, else the locale's), or a month number: { date, unit }, or null if there's no such week
    fromWords({ unit, year, n }, rules) {
        if (unit === "month") return n >= 1 && n <= 12 ? { date: `${year}-${String(n).padStart(2, "0")}-01`, unit } : null;
        const iso = this.isoWeeks(rules);
        const m = moment().locale(rules.locale);
        if (iso) m.isoWeekYear(year).isoWeek(n).startOf("isoWeek");
        else m.weekYear(year).week(n).startOf("week");
        const same = iso ? m.isoWeekYear() === year && m.isoWeek() === n : m.weekYear() === year && m.week() === n;
        return n >= 1 && same ? { date: m.format("YYYY-MM-DD"), unit: "week" } : null;
    }

    // Whether the weekly notes count ISO weeks, Monday first: their pattern uses GGGG or WW outside [brackets]
    isoWeeks(rules) {
        return /[GW]/.test(rules.format.week.replace(/\[[^\]]*\]/g, ""));
    }

    // A week's, month's or year's note name, in the pattern's spelling and the user's locale
    periodName({ date, unit }, rules) {
        return moment(date, "YYYY-MM-DD", true).locale(rules.locale).format(rules.format[unit]);
    }

    // The note a date opens: { path, name, kind, when, result }
    target(result, rules) {
        const { unit, m } = result;
        const when = plainday.DatePrompt.spell(result, rules.weekStart);
        if (unit === "day") {
            const path = plainday.Plan.dailyNotePath(m);
            return { path, name: path.split("/").pop().replace(/\.md$/, ""), kind: "daily", when, result };
        }
        const name = this.periodName(result, rules);
        const kind = { week: "weekly", month: "monthly", year: "yearly" }[unit];
        return { path: `${plainday.TimeReport.periodFolders()[unit]}/${name}.md`, name, kind, when, result };
    }

    // A new daily note goes through Plan, which runs the Daily Note template; a weekly, monthly or
    // yearly note gets the template Notebook Navigator's calendar uses, or the one named after it.
    // Templater's own trigger then leaves it alone (Plan.holdOffTemplater). With no template to run, the
    // trigger fills it as it would any new note.
    async create(target) {
        const { unit, m } = target.result;
        if (unit === "day") return plainday.Plan.ensureDailyNote(m);
        const folder = target.path.slice(0, target.path.lastIndexOf("/"));
        if (folder && !app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder);
        const tpl = this.templateFor(unit);
        const templater = app.plugins.getPlugin("templater-obsidian")?.templater;
        const file = await app.vault.create(target.path, "");
        if (tpl && templater) {
            await templater.write_template_to_file(tpl, file);
            plainday.Plan.holdOffTemplater(file.path);
        } else if (tpl) {
            new Notice("Templater unavailable — created a blank note");
        }
        // A template that files the note itself (the Weekly Note template moves it into its folder)
        // can disagree with Notebook Navigator's pattern; then the next jump wouldn't find it
        if (file.path !== target.path) {
            new Notice(`The ${target.kind} note's template moved it to ${file.parent?.path ?? "/"}, but Notebook Navigator's pattern puts it in ${folder}. Make them agree, or the next jump won't find it.`, 0);
        }
        return file;
    }

    templateFor(unit) {
        const nn = app.plugins?.plugins?.["notebook-navigator"]?.settings;
        const folder = String(app.plugins.getPlugin("templater-obsidian")?.settings?.templates_folder ?? "").replace(/\/$/, "");
        const candidates = [nn?.[JumpToDate.NN_TEMPLATE[unit]], folder && `${folder}/${JumpToDate.TEMPLATE[unit]}`];
        for (const c of candidates) {
            if (!c) continue;
            const file = app.vault.getFileByPath(c.endsWith(".md") ? c : `${c}.md`);
            if (file) return file;
        }
        return null;
    }

    skipping() {
        return app.loadLocalStorage(JumpToDate.SKIP_KEY) === true;
    }

    // Asks before creating a note. Enter creates, Escape and Cancel don't. Resolves true to create.
    confirm(target) {
        return new Promise((resolve) => {
            const modal = new Modal(app);
            let create = false;
            modal.titleEl.setText(`Create ${target.name}?`);
            modal.contentEl.createEl("p", { text: `There's no ${target.kind} note for ${target.when} yet.` });
            const label = modal.contentEl.createEl("label");
            const box = label.createEl("input", { type: "checkbox" });
            label.appendText(" Don't ask again on this device");
            const buttons = modal.contentEl.createDiv({ cls: "modal-button-container" });
            const no = buttons.createEl("button", { text: "Cancel" });
            no.addEventListener("click", () => modal.close());
            const yes = buttons.createEl("button", { text: "Create", cls: "mod-cta" });
            const accept = () => { create = true; modal.close(); };
            yes.addEventListener("click", accept);
            // Enter creates, from the checkbox too, unless you've tabbed to Cancel
            modal.scope.register([], "Enter", () => { if (document.activeElement === no) modal.close(); else accept(); return false; });
            modal.onClose = () => {
                if (create && box.checked) app.saveLocalStorage(JumpToDate.SKIP_KEY, true);
                resolve(create);
            };
            // Focus once the modal is open, a frame later (OBS-50)
            modal.onOpen = () => requestAnimationFrame(() => yes.focus());
            modal.open();
        });
    }

    // Under the preview, while notes are created without asking: say so, and offer to ask again
    askAgainLine(contentEl, focus) {
        if (!this.skipping()) return;
        const line = contentEl.createDiv({ cls: "setting-item-description" });
        line.appendText("Missing notes are created without asking on this device. ");
        const again = line.createEl("a", { text: "Ask again", href: "#" });
        again.addEventListener("click", (e) => {
            e.preventDefault();
            app.saveLocalStorage(JumpToDate.SKIP_KEY, null);
            line.setText("Will ask before creating a note.");
            focus?.();
        });
    }
}
