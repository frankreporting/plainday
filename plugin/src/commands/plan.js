import { DropdownComponent, MarkdownView, Modal, moment, Notice } from "obsidian";
import { app } from "../host.js";

export default class Plan {
    // A single day is the note you're already on, so the range starts at two.
    // Beyond five, the panes are too narrow to be useful on a laptop screen.
    static MIN_DAYS = 2;
    static MAX_DAYS = 5;

    async invoke() {
        const { MIN_DAYS: min, MAX_DAYS: max } = Plan;

        const modal = new Modal(app);
        modal.titleEl.setText("Display how many days?");

        const dropdown = new DropdownComponent(modal.contentEl);
        for (let i = min; i <= max; i++) dropdown.addOption(String(i), `${i} days`);
        dropdown.setValue(String(min));
        dropdown.selectEl.style.width = "100%";

        const run = (days) => { modal.close(); this.openDays(days); };

        // Number keys act in a single keystroke; Enter takes whatever the dropdown shows
        for (let i = min; i <= max; i++) {
            modal.scope.register([], String(i), () => { run(i); return false; });
        }
        modal.scope.register([], "Enter", () => { run(Number(dropdown.getValue())); return false; });

        // Focus once the modal is open and the hotkey's keydown is over; focusing straight after
        // open() fights the editor for focus, and the first key typed can land in the note (OBS-50)
        modal.onOpen = () => requestAnimationFrame(() => dropdown.selectEl.focus());
        modal.open();
    }

    async openDays(days) {
        const { format } = this.dailyOpts();

        const view = app.workspace.getActiveViewOfType(MarkdownView);
        const anchor = view?.leaf ?? app.workspace.getMostRecentLeaf();
        if (!anchor) { new Notice("No pane to open beside"); return; }

        // Plan forward from the day you're already looking at; from anything else
        // (a project or monthly note), plan forward from today. Either way the run
        // only ever grows rightward from the current pane.
        const activeFile = view?.file;
        const anchorIsDaily = activeFile ? this.isDailyNote(activeFile) : false;
        const start = anchorIsDaily
            ? moment(activeFile.basename, format, true)
            : moment().startOf("day");

        const dates = [];
        for (let i = 0; i < days; i++) dates.push(start.clone().add(i, "days"));
        // The anchor is already showing the first day, so it doesn't need a pane
        if (anchorIsDaily) dates.shift();

        try {
            // The run walks its split point along as it goes, so the days land in order.
            let tail = anchor;
            for (const m of dates) {
                tail = await this.placeDay(m, tail);
            }
            // Splitting steals focus; hand it back to the note you started from
            app.workspace.setActiveLeaf(anchor, { focus: true });
        } catch (err) {
            console.error(err);
            new Notice("Couldn't open the daily notes — check console");
        }
    }

    // Open one day in its own pane to the right of `anchor`, and return that pane.
    // A day already open elsewhere is moved into place rather than duplicated:
    // detaching and reopening is the only way to reposition a pane, so its
    // scroll position and cursor are carried across by hand.
    async placeDay(m, anchor) {
        const file = await this.ensureDailyNote(m);

        const existing = this.findOpenLeaf(file);
        const ephemeral = existing?.getEphemeralState?.();
        if (existing) existing.detach();

        const leaf = app.workspace.createLeafBySplit(anchor, "vertical");
        await leaf.openFile(file);
        if (ephemeral) leaf.setEphemeralState(ephemeral);
        return leaf;
    }

    // An existing pane in the main editor area showing this file, if there is one
    findOpenLeaf(file) {
        let found = null;
        app.workspace.iterateRootLeaves((leaf) => {
            if (!found && leaf.view?.file?.path === file.path) found = leaf;
        });
        return found;
    }

    dailyOpts() {
        const opts = app.internalPlugins?.plugins?.["daily-notes"]?.instance?.options ?? {};
        return {
            folder: (opts.folder ?? "").replace(/\/$/, ""),
            format: opts.format || "YYYY-MM-DD",
            template: opts.template ?? ""
        };
    }

    dailyNotePath(m) {
        const { folder, format } = this.dailyOpts();
        return `${folder ? folder + "/" : ""}${m.format(format)}.md`;
    }

    isDailyNote(file) {
        const { folder, format } = this.dailyOpts();
        const inFolder = (file.parent?.path ?? "/") === (folder || "/");
        return inFolder && moment(file.basename, format, true).isValid();
    }

    async ensureDailyNote(m) {
        const path = this.dailyNotePath(m);
        const existing = app.vault.getFileByPath(path);
        if (existing) return existing;

        const { folder, template } = this.dailyOpts();
        if (folder && !app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder);
        const file = await app.vault.create(path, "");

        // The Daily Note template is Templater code, so it has to be run, not copied
        if (!template) return file;
        const tpl = app.vault.getFileByPath(template.endsWith(".md") ? template : `${template}.md`);
        const templater = app.plugins.getPlugin("templater-obsidian")?.templater;
        if (tpl && templater) {
            await templater.write_template_to_file(tpl, file);
            this.holdOffTemplater(file.path);
        } else if (tpl) {
            new Notice("Templater unavailable — created a blank daily note");
        }
        return file;
    }

    // Templater's trigger for new notes waits 300ms, then runs Get Template on a new note whose body
    // is empty and that it no longer lists as in progress. A note just made from its template is only
    // frontmatter, and write_template_to_file takes it off that list when it's done, so it would be
    // templated again, through the editor once it's open, pulling the cursor to the top. Call this
    // right after the template ran to keep it listed a while longer, as the Log template does (OBS-57).
    holdOffTemplater(path) {
        const pending = app.plugins?.plugins?.["templater-obsidian"]?.templater?.files_with_pending_templates;
        if (!pending) return;
        pending.add(path);
        setTimeout(() => pending.delete(path), 1500);
    }
}
