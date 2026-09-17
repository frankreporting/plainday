<%*
const rxDate = /^[0-9]{4}-[0-9]{2}-[0-9]{2}/;
const today = /^!today/;
const logDate = tp.file.title.match(today) ? tp.date.now("YYYY-MM-DD") : tp.file.title.match(rxDate)[0];
const cleanTitle = tp.file.title.replace(rxDate,"").replace(today,"").trim();
const friendlyDate = tp.date.now("M/D/YY", 0, logDate, "YYYY-MM-DD");
const logName = logDate + " " + cleanTitle;

// A log made from a calendar event line in its daily note takes the event's start and end time
const dailyNote = app.metadataCache.getFirstLinkpathDest(logDate, "");
const times = dailyNote ? tp.user.eventTimes(await app.vault.cachedRead(dailyNote), tp.file.title) : null;

// Logs live in a logs folder under their project or area; Esc leaves the log in 10 Inbox
const pickedFile = await tp.user.pickParent(tp, (folder) => folder.startsWith("Projects/"), "Select the log's project or area (Esc: Inbox)...");
let area = "";
let folder = "10 Inbox";
if (pickedFile) {
	folder = pickedFile.parent.path + "/logs";
	const parentAlias = [].concat(app.metadataCache.getFileCache(pickedFile)?.frontmatter?.aliases ?? [])[0] || pickedFile.basename;
	area = "\"[[" + pickedFile.basename + "|" + parentAlias + "]]\"";
	if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
}
if (tp.file.path(true) != folder + "/" + logName + ".md") {
	if (app.vault.getAbstractFileByPath(folder + "/" + logName + ".md")) {
		new Notice("A note named \"" + logName + "\" is already in " + folder + ", so this log stays where it is.");
	} else {
		await tp.file.move(folder + "/" + logName);
	}
}

tR += "---\nid: " + tp.date.now("YYYYMMDDHHmmssSS") + "\naliases: \n- " + cleanTitle + "\n- " + friendlyDate + " " + cleanTitle + "\ntags: log\n";
tR += `area: ${area}\n`;
tR += `series: \n`;
tR += `topic: \n`;
tR += `date: ${logDate}\n`;
tR += `time: ${times?.time ?? ""}\n`;
tR += `endTime: ${times?.endTime ?? ""}\n`;
tR += `who: \n`;
tR += "---\n";
tp.user.showNewNote(tp);
%>