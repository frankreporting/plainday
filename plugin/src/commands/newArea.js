import { plainday } from "../host.js";

export default class NewArea {
    // The command New area (OBS-123): asks for a name, makes the area's folder at the top of the Projects folder
    // with its note inside, runs the Area template if there is one, and opens the note (ProjectNotes.create). It
    // replaces typing `!area Name` as a new note's title, or clicking a `🗃️.Name` link to a note not made yet,
    // which Get Template routed to the Area template.
    async invoke() {
        await plainday.ProjectNotes.create("area");
    }
}
