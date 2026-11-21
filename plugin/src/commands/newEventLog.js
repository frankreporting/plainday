import { ButtonComponent, Modal, moment, TextComponent } from "obsidian";
import { app, plainday } from "../host.js";

export default class NewEventLog {
    // The command New event log (OBS-122): asks for an event's title, makes its log on the day of the daily note
    // you're in, or else today, and opens it with the cursor in its body. The day's event line of that title links it;
    // with none, a line is added after the day's events (EventLog.make). A log of that name already there is opened.
    // It replaces typing `!today Title` or `2026-09-16 Title` as a new note's title, which Get Template routed to the
    // Log template.
    async invoke() {
        const date = this.day();
        const title = await this.ask(date);
        if (!title) return;
        // The daily note open now is saved first, so a line added to it on disk doesn't meet unsaved typing
        await app.workspace.activeLeaf?.view?.save?.();
        const made = await plainday.EventLog.make({ date, title });
        if (made) await plainday.EventLog.open(made.file);
    }

    // The day of the daily note open now, read by its name as every link to a day is (OBS-297), else today: YYYY-MM-DD
    day() {
        const file = app.workspace.getActiveFile();
        const period = file ? plainday.PeriodicNotes.periodOfName(file.basename) : null;
        return period?.unit === "day" ? period.date : moment().format("YYYY-MM-DD");
    }

    // The day in the box, in words: Today, Tomorrow or Yesterday, else "Sat 11/21/26", the way Plainday writes a date
    // elsewhere (a log's alias, a day note's)
    when(date, today = moment().format("YYYY-MM-DD")) {
        const day = moment(date, "YYYY-MM-DD", true);
        const words = { 0: "Today", 1: "Tomorrow", "-1": "Yesterday" }[day.diff(moment(today, "YYYY-MM-DD", true), "days")];
        return words ?? day.locale(plainday.DatePrompt.weekRules().locale).format("ddd M/D/YY");
    }

    // The title typed, trimmed, or null when it's empty or the box is closed
    ask(date) {
        return new Promise((resolve) => {
            let title = null;
            const modal = new (class extends Modal {
                onClose() { setTimeout(() => resolve(title), 0); }
                // Focused once the modal is open, not straight after open(), so the hotkey's key doesn't land in the
                // note (OBS-50)
                onOpen() { requestAnimationFrame(() => input.inputEl.focus()); }
            })(app);
            modal.titleEl.setText("New event log");
            modal.contentEl.createEl("p", { text: this.when(date) });
            const input = new TextComponent(modal.contentEl).setPlaceholder("Event title");
            input.inputEl.addClass("plainday-wide-input");
            const make = () => {
                const typed = input.getValue().trim();
                if (!typed) return;
                title = typed;
                modal.close();
            };
            const row = modal.contentEl.createDiv({ cls: "modal-button-container" });
            new ButtonComponent(row).setButtonText("Cancel").onClick(() => modal.close());
            new ButtonComponent(row).setButtonText("Make log").setCta().onClick(make);
            modal.scope.register([], "Enter", () => { make(); return false; });
            modal.open();
        });
    }
}
