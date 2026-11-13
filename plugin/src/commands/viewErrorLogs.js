// View Error Logs (OBS-218): opens the error log, `Config/Error Log.md`, where the time report and
// the calendar sync list every Problem they found, one line per kind of Problem per note.
class ViewErrorLogs {
    async invoke() {
        const log = customJS.ErrorLog;
        if (!log) { new Notice("View Error Logs: the ErrorLog script isn't loaded; try again in a moment"); return; }
        await log.open();
    }
}
