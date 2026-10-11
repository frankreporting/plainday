<%*
const rxDate = /^[0-9]{4}-[0-9]{2}-[0-9]{2}/;
const today = /^!today/;
const logDate = tp.file.title.match(today) ? tp.date.now("YYYY-MM-DD") : tp.file.title.match(rxDate)[0];
const cleanTitle = tp.file.title.replace(rxDate,"").replace(today,"").trim();
const friendlyDate = tp.date.now("M/D/YY", 0, logDate, "YYYY-MM-DD");
const logName = logDate + " " + cleanTitle;

// Every log has a line in its daily note (OBS-10), and the line says where the log belongs
// (OBS-57): when its ⭕ or 🗃️ links name one live project or area, the log is filed there without
// the menu, as AddTaskNote files a task's note. Otherwise the menu asks, and the line's ⭕ becomes
// the pick, so the line and its log agree on where the meeting's time counts (OBS-90).
const sync = typeof customJS !== "undefined" ? customJS.CalendarSync : null;
const schedule = typeof customJS !== "undefined" ? customJS.Schedule : null;
const tasks = typeof customJS !== "undefined" ? customJS.AddTaskNote : null;
const day = window.moment(logDate, "YYYY-MM-DD", true);
const dailyPath = schedule && day.isValid() ? schedule.dailyNotePath(day) : null;
const dailyFile = dailyPath ? app.vault.getFileByPath(dailyPath) : null;
const eventLine = sync && dailyFile ? tp.user.recordEvent(await app.vault.cachedRead(dailyFile), { log: logName, title: cleanTitle }, sync).line : null;
const lineHomes = eventLine && tasks ? tasks.lineProjects(eventLine, dailyPath) : { projects: [], allLive: false };

// Logs live in a `›logs` folder under their project or area (AddTaskNote.logsFolderIn); Esc leaves
// the log in 10 Inbox
const pickedFile = lineHomes.allLive && lineHomes.projects.length === 1
	? lineHomes.projects[0]
	: await tp.user.pickParent(tp, (folder) => folder.startsWith("Projects/"), "Select the log's project or area (Esc: Inbox)...");
let area = "";
let folder = "10 Inbox";
if (pickedFile) {
	folder = tasks ? tasks.logsFolderIn(pickedFile.parent.path) : pickedFile.parent.path + "/›logs";
	const parentAlias = [].concat(app.metadataCache.getFileCache(pickedFile)?.frontmatter?.aliases ?? [])[0] || pickedFile.basename;
	area = "\"[[" + pickedFile.basename + "|" + parentAlias + "]]\"";
	if (tasks) await tasks.makeFolder(folder);
	else if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
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
// it a second time: with the menu, and moving it back to 10 Inbox on Esc.
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
		// The line names the project or area the log was filed for, in place of its own ⭕ links, before
		// its 🗒️ (a project note that isn't its folder's own note can't hold the log, and the line
		// still names it, as AddProjectLink does). Esc leaves the line's links as they are.
		const home = pickedFile && tasks ? tasks.homeLink(pickedFile, tasks.linktextFor(pickedFile, app.vault.getMarkdownFiles().map((f) => f.path))) : null;
		const record = (text) => tp.user.recordEvent(text, { log: logName, title: cleanTitle, home }, sync, fresh);
		// A line that's already there, already naming the log's project, means nothing to write: don't
		// touch the note. Open in the editor (AddTaskNote made the log from its line), only the lines that
		// change are written there, so nothing you type is overwritten; otherwise the note is written in
		// one step, and its fold snapshot taken again, as MoveToProject does (RefoldOnOpen would read the
		// changed line as new and fold it)
		const view = app.workspace.activeLeaf?.view;
		const editor = view?.file === dailyNote ? view.editor : null;
		let dailyText = editor ? editor.getValue() : await app.vault.cachedRead(dailyNote);
		const recorded = record(dailyText).text;
		const [was, now] = [dailyText.split("\n"), recorded.split("\n")];
		if (recorded === dailyText) {
			// Nothing to write
		} else if (editor && was.length === now.length) {
			now.forEach((line, i) => { if (line !== was[i]) editor.replaceRange(line, { line: i, ch: 0 }, { line: i, ch: was[i].length }); });
			dailyText = recorded;
		} else {
			await app.vault.process(dailyNote, (text) => (dailyText = record(text).text));
			try { await customJS.RefoldDailyNotes?.onLeave?.(dailyNote); } catch (e) { console.error("Log template: couldn't snapshot the folds", e); }
		}
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