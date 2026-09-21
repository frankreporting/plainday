<%*
const rxDate = /^[0-9]{4}-[0-9]{2}-[0-9]{2}/;
const today = /^!today/;
const logDate = tp.file.title.match(today) ? tp.date.now("YYYY-MM-DD") : tp.file.title.match(rxDate)[0];
const cleanTitle = tp.file.title.replace(rxDate,"").replace(today,"").trim();
const friendlyDate = tp.date.now("M/D/YY", 0, logDate, "YYYY-MM-DD");
const logName = logDate + " " + cleanTitle;

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
let filed = true;   // false when a log with this name is already there: that one is opened, this note goes
if (tp.file.path(true) != folder + "/" + logName + ".md") {
	const existing = app.vault.getFileByPath(folder + "/" + logName + ".md");
	if (existing) {
		filed = false;
		new Notice("\"" + logName + "\" is already in " + folder + ": opening that log. This new note is deleted.");
		// Templater writes this note once the template returns (deleting it first would fail that
		// write), so wait for its event, then open the log you meant and trash this one
		const here = tp.config.target_file;
		const ref = app.workspace.on("templater:new-note-from-template", async ({ file }) => {
			if (file !== here) return;
			app.workspace.offref(ref);
			await app.workspace.getLeaf().openFile(existing);
			await app.fileManager.trashFile(here);
		});
		setTimeout(() => app.workspace.offref(ref), 10000);
	} else {
		await tp.file.move(folder + "/" + logName);
	}
}

// Every log has a line in its daily note (OBS-10): the event line with the log's title gets the log
// link, or a line with no time is added after the day's events; a missing daily note is made from
// its template, as Schedule makes one. The log's times then come from that line: the event's start,
// and the end time under it. The calendar sync's own helpers do the matching and the sorting.
let times = null;
const sync = typeof customJS !== "undefined" ? customJS.CalendarSync : null;
const schedule = typeof customJS !== "undefined" ? customJS.Schedule : null;
const day = window.moment(logDate, "YYYY-MM-DD", true);
if (!sync || !schedule) {
	new Notice("CustomJS isn't loaded, so this log wasn't recorded in its daily note");
} else if (!day.isValid()) {
	new Notice(logDate + " isn't a date, so this log wasn't recorded in a daily note");
} else if (filed) {
	try {
		const dailyPath = schedule.dailyNotePath(day);
		const fresh = !app.vault.getFileByPath(dailyPath);
		const dailyNote = fresh ? await schedule.ensureDailyNote(dailyPath) : app.vault.getFileByPath(dailyPath);
		const record = (text) => tp.user.recordEvent(text, { log: logName, title: cleanTitle }, sync, fresh);
		// A line that's already there means nothing to write: don't touch the note for it
		let dailyText = await app.vault.cachedRead(dailyNote);
		if (record(dailyText).outcome !== "present") await app.vault.process(dailyNote, (text) => (dailyText = record(text).text));
		times = tp.user.eventTimes(dailyText, logName);
	} catch (e) {
		console.error("Log template: couldn't record the log in its daily note", e);
		new Notice("Couldn't record this log in its daily note — check the console");
	}
}

tR += "---\nid: " + tp.date.now("YYYYMMDDHHmmssSS") + "\naliases: \n- " + friendlyDate + " " + cleanTitle + "\ntags: log\n";
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