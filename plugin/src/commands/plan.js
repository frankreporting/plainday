import { ButtonComponent, DropdownComponent, MarkdownView, Modal, moment, Notice, Platform } from "obsidian";
import { app, plainday } from "../host.js";

/** @import { TFile, WorkspaceLeaf } from "obsidian" */
/** @import { Moment } from "moment" */
/** @import { MomentFn, SomeView } from "../host.js" */
/**
 * A pane, whose scroll position and cursor Plan carries across by hand: what Obsidian hands back
 * (as any) only goes back to setEphemeralState
 * @typedef {Omit<WorkspaceLeaf, "getEphemeralState"> & { getEphemeralState?(): unknown }} OpenLeaf
 */

export default class Plan {
    // A single day is the note you're already on, so the range starts at two.
    // Beyond five, the panes are too narrow to be useful on a laptop screen.
    static MIN_DAYS = 2;
    static MAX_DAYS = 5;

    async invoke() {
        const { MIN_DAYS: min, MAX_DAYS: max } = Plan;

        const modal = new Modal(app);
        modal.titleEl.setText("How many days?");

        const dropdown = new DropdownComponent(modal.contentEl);
        for (let i = min; i <= max; i++) dropdown.addOption(String(i), `${i} days`);
        dropdown.setValue(String(min));
        dropdown.selectEl.addClass("plainday-wide-input");

        const run = (/** @type {number} */ days) => { modal.close(); this.openDays(days); };

        // The buttons show how to run it, and are the only way on a phone, which sends no keys (OBS-259)
        const row = modal.contentEl.createDiv({ cls: "modal-button-container" });
        new ButtonComponent(row).setButtonText("Cancel").onClick(() => modal.close());
        new ButtonComponent(row).setButtonText("Plan").setCta().onClick(() => run(Number(dropdown.getValue())));

        // Number keys act in a single keystroke; Enter takes whatever the dropdown shows
        for (let i = min; i <= max; i++) {
            modal.scope.register([], String(i), () => { run(i); return false; });
        }
        modal.scope.register([], "Enter", () => { run(Number(dropdown.getValue())); return false; });

        // Focus once the modal is open and the hotkey's keydown is over; focusing straight after
        // open() fights the editor for focus, and the first key typed can land in the note (OBS-50).
        // The focus is for a keyboard only: a phone or tablet leaves the dropdown to a tap, since one
        // focused by script didn't open on a tap on a phone (OBS-259)
        if (!Platform.isMobile) modal.onOpen = () => window.requestAnimationFrame(() => dropdown.selectEl.focus());
        modal.open();
    }

    /** @param {number} days */
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
            ? /** @type {MomentFn} */ (moment)(activeFile.basename, format, true)
            : /** @type {MomentFn} */ (moment)().startOf("day");

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
    /**
     * @param {Moment} m
     * @param {WorkspaceLeaf} anchor
     * @returns {Promise<WorkspaceLeaf>}
     */
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
    /**
     * @param {TFile} file
     * @returns {OpenLeaf | null}
     */
    findOpenLeaf(file) {
        /** @type {OpenLeaf | null} */
        let found = null;
        app.workspace.iterateRootLeaves((/** @type {WorkspaceLeaf & { view: SomeView }} */ leaf) => {
            if (!found && leaf.view?.file?.path === file.path) found = leaf;
        });
        return found;
    }

    // Where the daily notes are, what names them and what they're made from: Schedule's, so Plan makes
    // them where everything else looks for them — the periodic notes' source decides (OBS-283)
    dailyOpts() {
        return plainday.Schedule.dailyOpts();
    }

    // Where a day's note goes, and whether a note is one: Schedule's, folders by date included (OBS-310)
    /** @param {Moment} m */
    dailyNotePath(m) {
        return plainday.Schedule.dailyNotePath(m);
    }

    /** @param {TFile} file */
    isDailyNote(file) {
        return plainday.Schedule.isDailyNote(file);
    }

    // The day's note, made if it isn't there, as every periodic note is made (PeriodicNotes.ensure)
    /** @param {Moment} m */
    async ensureDailyNote(m) {
        return plainday.PeriodicNotes.ensure("day", m.format("YYYY-MM-DD"));
    }
}
