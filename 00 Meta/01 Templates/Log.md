<%*
const rxDate = /^[0-9]{4}-[0-9]{2}-[0-9]{2}/;
const today = /^!today/;
const logDate = tp.file.title.match(today) ? tp.date.now("YYYY-MM-DD") : tp.file.title.match(rxDate)[0];
const cleanTitle = tp.file.title.replace(rxDate,"").replace(today,"").trim();
const friendlyDate = tp.date.now("M/D/YY", 0, logDate, "YYYY-MM-DD");
const logName = logDate + " " + cleanTitle;

// Every log has a line in its daily note (OBS-10), and the line says where the log belongs
// (OBS-57): with one ⭕ or 🗃️ on it for a project or area, the log is filed there without the menu,
// and that link comes off the line, since the log now says where the meeting's time counts. With
// several, or none, the menu asks.
const sync = typeof customJS !== "undefined" ? customJS.CalendarSync : null;
const schedule = typeof customJS !== "undefined" ? customJS.Schedule : null;
const tasks = typeof customJS !== "undefined" ? customJS.AddTaskNote : null;
const day = window.moment(logDate, "YYYY-MM-DD", true);
const dailyPath = schedule && day.isValid() ? schedule.dailyNotePath(day) : null;
const dailyFile = dailyPath ? app.vault.getFileByPath(dailyPath) : null;
const eventLine = sync && dailyFile ? tp.user.recordEvent(await app.vault.cachedRead(dailyFile), { log: logName, title: cleanTitle }, sync).line : null;
const lineHomes = eventLine && tasks ? tasks.lineProjects(eventLine, dailyPath).projects : [];

// Logs live in a logs folder under their project or area; Esc leaves the log in 10 Inbox
const pickedFile = lineHomes.length === 1
	? lineHomes[0]
	: await tp.user.pickParent(tp, (folder) => folder.startsWith("Projects/"), "Select the log's project or area (Esc: Inbox)...");
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

// Templater's trigger for new notes waits 300ms, then runs Get Template on any new note whose body is
// empty and that it no longer lists as in progress. A log is only frontmatter and, filed by its
// line's ⭕ with no menu, is done and moved well before that, so the trigger would run this template on
// it a second time: with the menu (its line's ⭕ is gone by then), and moving it back to 10 Inbox on Esc.
// So it stays listed as in progress a while longer (CalNav's Open Log Note does the same).
const pending = app.plugins.plugins["templater-obsidian"]?.templater?.files_with_pending_templates;
if (pending) {
	const settled = tp.config.target_file.path;
	pending.add(settled);
	setTimeout(() => pending.delete(settled), 1500);
}

// The log's line: the event line with the log's title gets the log link, or a line with no time is
// added after the day's events; a missing daily note is made from its template, as Schedule makes
// one. The log's times then come from that line: the event's start, and the end time under it. The
// calendar sync's own helpers do the matching and the sorting.
let times = null;
if (!sync || !schedule) {
	new Notice("CustomJS isn't loaded, so this log wasn't recorded in its daily note");
} else if (!day.isValid()) {
	new Notice(logDate + " isn't a date, so this log wasn't recorded in a daily note");
} else if (filed) {
	try {
		const fresh = !app.vault.getFileByPath(dailyPath);
		const dailyNote = fresh ? await schedule.ensureDailyNote(dailyPath) : app.vault.getFileByPath(dailyPath);
		// The ⭕ or 🗃️ for the project or area the log is now filed in comes off its line, once the log
		// is really at home there (a project note that isn't its folder's own note can't hold it, so
		// the line keeps its ⭕, as AddProjectLink does)
		const home = pickedFile && tasks ? tasks.homeOf(tp.config.target_file) : null;
		const drop = home === pickedFile && eventLine
			? tasks.projectLinks(eventLine).filter((l) => app.metadataCache.getFirstLinkpathDest(l.linkpath, dailyPath) === pickedFile).map((l) => l.raw)
			: [];
		const record = (text) => tp.user.recordEvent(text, { log: logName, title: cleanTitle, drop }, sync, fresh);
		// A line that's already there, with nothing to take off it, means nothing to write: don't touch the note
		let dailyText = await app.vault.cachedRead(dailyNote);
		if (record(dailyText).text !== dailyText) await app.vault.process(dailyNote, (text) => (dailyText = record(text).text));
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