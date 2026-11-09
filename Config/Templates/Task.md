<%*
// No menu (OBS-55): a task note goes where the command that made it says (AddTaskNote, from the
// task line's one ⭕ or 🗃️), and otherwise waits in Inbox, to be filed afterwards with
// AddProjectLink on its line or MoveToProject on the note
// Through Plainday's classes, or CustomJS's in a vault that hasn't moved to Plainday (OBS-226)
const pickedFile = (typeof plainday !== "undefined" ? plainday : typeof customJS !== "undefined" ? customJS : null)?.AddTaskNote?.takePresetParent?.(tp.config.target_file.path) ?? null;

const thisID = tp.date.now("YYYYMMDDHHmmssSS");
const rxDates = /[0-9]{4}-[0-9]{2}-[0-9]{2}/g;
const dates = tp.file.title.match(rxDates);
// A date in the name is the task's due date (with two, the last one, as in the Project template)
const due = dates ? dates[dates.length - 1] : null;

// The parent the note is filed under, written here so a task note filed in a project has one (as the Log template does)
const parentAlias = pickedFile ? [].concat(app.metadataCache.getFileCache(pickedFile)?.frontmatter?.aliases ?? [])[0] || pickedFile.basename : null;
const parentLink = pickedFile ? "\"[[" + pickedFile.basename + "|" + parentAlias + "]]\"" : "";

tR += "---\n";
tR += "id: " + thisID + "\n";
tR += "tags: \n- task\n";
tR += "parent: " + parentLink + "\n";
tR += "due: " + (due ? due : "") + "\n";
tR += "---\n";

tp.file.cursor();

const cleanTitle = tp.file.title.replaceAll(rxDates, "").replace("!task", "").trim();
if (pickedFile) {
	await tp.file.move(pickedFile.parent.path + "/" + cleanTitle);
} else {
	// No project or area: the note goes to Inbox, as a log does, with "!task" and the dates dropped
	// from its name (OBS-36). A name another note already has stops here, as in the Project template:
	// Obsidian resolves a shared name to the shortest path, so a note in Inbox would take over the
	// other one's links. (AddTaskNote links an existing note of that name instead of making one.)
	const inbox = "Inbox";
	const name = cleanTitle || tp.file.title;
	if (app.vault.getMarkdownFiles().some((f) => f !== tp.config.target_file && f.basename.toLowerCase() === name.toLowerCase())) {
		const why = `A note named "${name}" already exists, so no task note was made: open that one, or give this one another name`;
		new Notice(why, 10000);
		throw new Error(why);
	}
	const target = inbox + "/" + name;
	if (tp.file.path(true) != target + ".md") {
		if (!app.vault.getAbstractFileByPath(inbox)) await app.vault.createFolder(inbox);
		await tp.file.move(target);
	}
}
tp.user.showNewNote(tp);
%>