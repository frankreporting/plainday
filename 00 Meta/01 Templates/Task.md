<%*
// New notes are created in the current folder (Obsidian's "Default location for new notes"),
// so always ask where a new task belongs rather than only for notes made in 10 Inbox
const pickedFile = await tp.user.pickParent(tp, (folder) => folder.startsWith("Projects/"), "Select parent project or area...");

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
} else if (cleanTitle && cleanTitle != tp.file.title) {
	// Picker dismissed: leave the note where it is, but drop "!task" and the dates from its name
	await tp.file.rename(cleanTitle);
}
tp.user.showNewNote(tp);
%>