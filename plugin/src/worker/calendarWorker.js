// The background worker that reads a calendar feed (OBS-274). CalendarFeed
// (shared/calendarFeed.js) starts one for each read, posts it { text, options }, and stops it when
// it answers, or when it runs past CalendarFeed.READ_LIMIT_MS. The build bundles this file with
// ical.js into a script of its own (plugin/esbuild.config.mjs), which main.js carries as text.
import { CalendarReader } from "./calendarRead.js";

const reader = new CalendarReader();

self.onmessage = (event) => {
    let result;
    try {
        result = reader.read(event.data.text, event.data.options);
    } catch {
        result = { problem: "unreadable" };
    }
    self.postMessage(result);
};
