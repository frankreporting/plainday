<%*
// New notes are created in the current folder (Obsidian's "Default location for new notes"),
// so always ask where a new task belongs rather than only for notes made in Inbox
const pickedFile = await tp.user.pickParent(tp, (folder) => folder.startsWith("Projects/"), "Select parent project or area (Esc: Inbox)...");

const thisID = tp.date.now("YYYYMMDDHHmmssSS");
const rxDates = /[0-9]{4}-[0-9]{2}-[0-9]{2}/g;
const dates = tp.file.title.match(rxDates);
// A date in the name is the task's due date (with two, the last one, as in the Project template)
const due = dates ? dates[dates.length - 1] : null;

// The area the note is filed under, written here so a new task note always has one (as the Log template does)
const parentAlias = pickedFile ? [].concat(app.metadataCache.getFileCache(pickedFile)?.frontmatter?.aliases ?? [])[0] || pickedFile.basename : null;
const area = pickedFile ? "\"[[" + pickedFile.basename + "|" + parentAlias + "]]\"" : "";

tR += "---\n";
tR += "id: " + thisID + "\n";
tR += "tags: \n- task\n";
tR += "area: " + area + "\n";
tR += "due: " + (due ? due : "") + "\n";
tR += "---\n";

tp.file.cursor();

const cleanTitle = tp.file.title.replaceAll(rxDates, "").replace("!task", "").trim();
if (pickedFile) {
	await tp.file.move(pickedFile.parent.path + "/" + cleanTitle);
} else {
	// Picker dismissed: the note goes to Inbox, as a log does, with "!task" and the dates dropped
	// from its name; a note already there is only renamed (OBS-36)
	const inbox = "Inbox";
	const target = inbox + "/" + (cleanTitle || tp.file.title);
	if (tp.file.path(true) != target + ".md") {
		if (!app.vault.getAbstractFileByPath(inbox)) await app.vault.createFolder(inbox);
		if (app.vault.getAbstractFileByPath(target + ".md")) {
			new Notice("A note named \"" + (cleanTitle || tp.file.title) + "\" is already in " + inbox + ", so this one stays where it is.");
			if (cleanTitle && cleanTitle != tp.file.title) await tp.file.rename(cleanTitle);
		} else {
			await tp.file.move(target);
		}
	}
}
tp.user.showNewNote(tp);
%>