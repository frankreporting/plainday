---
tags:
  - template
---
Runs for any new note with "!project" in its name (see Get Template), e.g. "!project Launch plan", wherever the note was created. It creates a project folder for it at the top of Projects and makes this note its folder note; MoveToProject puts it under an area or another project afterwards. A first date in the name becomes `start` and a second becomes `due`, e.g. "!project 2026-09-15 2026-10-01 Launch plan". Every new project starts at `status: To Do`. The ConvertToProject command uses this template too.

<%*
tR = "";

const thisID = tp.date.now("YYYYMMDDHHmmssSS");
const rxDates = /[0-9]{4}-[0-9]{2}-[0-9]{2}/g;
const dates = tp.file.title.match(rxDates);
const start = dates ? dates[0] : null;
const due = dates && dates.length > 1 ? dates[1] : null;
const cleanTitle = tp.file.title.replaceAll(rxDates, "").replace("!project", "").trim();
const alias = "⭕." + cleanTitle;

// No menu (OBS-55): a new project gets a folder at the top of Projects, and MoveToProject files it
// under an area or another project afterwards (SyncArea then fills `area`)
const path = "Projects/" + cleanTitle;
// A name another note already has stops here: Obsidian resolves a shared name to the shortest path,
// and a note at the top of Projects would take over the other note's links, and the time on them
// (ConvertToProject refuses a used name for the same reason)
if (cleanTitle && app.vault.getMarkdownFiles().some((f) => f !== tp.config.target_file && f.basename.toLowerCase() === cleanTitle.toLowerCase())) {
	const why = `A note named "${cleanTitle}" already exists, so no project was made: give it another name`;
	new Notice(why, 10000);
	throw new Error(why);
}
let moved = false;
if (!cleanTitle) {
	// Nothing to name the folder: leave the note where it is
} else if (app.vault.getAbstractFileByPath(path)) {
	new Notice("The folder you're trying to create already exists.");
} else {
	await app.vault.createFolder(path);
	await tp.file.move(path + "/" + cleanTitle);
	moved = true;
}
if (!moved && cleanTitle && cleanTitle != tp.file.title) {
	// Not moved: leave the note where it is, but drop "!project" and the dates from its name
	await tp.file.rename(cleanTitle);
}

tR += "---\n";
tR += "id: " + thisID + "\n";
tR += "aliases: [" + JSON.stringify(alias) + "]\n";
tR += "icon: circle\n";
tR += "color: red\n";
tR += "tags: \n- project\n";
tR += "status: To Do\n";
tR += "area: \n";
tR += "start: " + (start ? start : "") + "\n";
tR += "due: " + (due ? due : "") + "\n";
tR += "who: \n";
tR += "client: \n";
tR += "rate: \n";
tR += "rate_type: \n";
tR += "include_subprojects: false\n";
tR += "billed_through: \n";
tR += "---\n";
tp.file.cursor(0);
tp.user.showNewNote(tp);
%>