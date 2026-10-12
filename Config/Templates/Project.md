---
tags:
  - template
---
Runs for any new note with "!project" in its name (see Get Template), e.g. "!project Launch plan", wherever the note was created. It asks which area or project the new project belongs to, creates a project folder there and makes this note its folder note. A first date in the name becomes `start` and a second becomes `due`, e.g. "!project 2026-09-15 2026-10-01 Launch plan". Every new project starts at `status: To Do`. The ConvertToProject command uses this template too.

<%*
tR = "";

const thisID = tp.date.now("YYYYMMDDHHmmssSS");
const rxDates = /[0-9]{4}-[0-9]{2}-[0-9]{2}/g;
const dates = tp.file.title.match(rxDates);
const start = dates ? dates[0] : null;
const due = dates && dates.length > 1 ? dates[1] : null;
const cleanTitle = tp.file.title.replaceAll(rxDates, "").replace("!project", "").trim();
let area;

// "⭕.Area.Project" from the parent's folder, e.g. "20 Projects/Freelance" → "⭕.Freelance.<name>"
const setAlias = (parentFolder, name) => {
	const parts = parentFolder.split("/").map(p => p.replace(/^[0-9]{2} /, "")).filter(p => p && p != "Projects");
	return "⭕." + [...parts, name].join(".");
};
let alias = "⭕." + cleanTitle;

// New notes are created in the current folder (Obsidian's "Default location for new notes"),
// so always ask where a new project belongs rather than only for notes made in Inbox
const pickedFile = await tp.user.pickParent(tp, (folder) => folder.startsWith("Projects/"), "Select parent project or area...");
let moved = false;
if (pickedFile) {
	let path = pickedFile.parent.path + "/" + cleanTitle;
	if ((await app.vault.getAllLoadedFiles()).map(f => f.path).includes(path)) {
		new Notice("The folder you're trying to create already exists.");
	} else {
		await app.vault.createFolder(path);
		await tp.file.move(path + "/" + cleanTitle);
		moved = true;
		alias = setAlias(pickedFile.parent.path, cleanTitle);
	}
	const parentAlias = [].concat(app.metadataCache.getFileCache(pickedFile)?.frontmatter?.aliases ?? [])[0] || pickedFile.basename;
	area = "\"[[" + pickedFile.basename + "|" + parentAlias + "]]\"";
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
tR += "area: " + (area ? area : "") + "\n";
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