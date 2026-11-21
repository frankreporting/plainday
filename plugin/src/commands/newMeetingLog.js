import { ButtonComponent, Modal, moment, TextComponent } from "obsidian";
import { app, plainday } from "../host.js";

export default class NewMeetingLog {
    // The command New meeting log (OBS-122): asks for a meeting's title, makes its log on the day of the daily note
    // you're in, or else today, and opens it with the cursor in its body. The day's event line of that title links it;
    // with none, a line is added after the day's events (MeetingLog.make). A log of that name already there is opened.
    // It replaces typing `!today Title` or `2026-09-16 Title` as a new note's title, which Get Template routed to the
    // Log template.
    async invoke() {
        const date = this.day();
        const title = await this.ask(date);
        if (!title) return;
        // The daily note open now is saved first, so a line added to it on disk doesn't meet unsaved typing
        await app.workspace.activeLeaf?.view?.save?.();
        const made = await plainday.MeetingLog.make({ date, title });
        if (made) await plainday.MeetingLog.open(made.file);
    }

    // The day of the daily note open now, read by its name as every link to a day is (OBS-297), else today: YYYY-MM-DD
    day() {
        const file = app.workspace.getActiveFile();
        const period = file ? plainday.PeriodicNotes.periodOfName(file.basename) : null;
        return period?.unit === "day" ? period.date : moment().format("YYYY-MM-DD");
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
            modal.titleEl.setText("New meeting log");
            const day = plainday.PeriodicNotes.alias("day", date) ?? date;
            modal.contentEl.createEl("p", { text: `For ${day}. Its line in the daily note links it, or one is added.` });
            const input = new TextComponent(modal.contentEl).setPlaceholder("Meeting title");
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
