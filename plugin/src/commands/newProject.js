import { plainday } from "../host.js";

export default class NewProject {
    // The command New project (OBS-123): asks for a name, makes the project's folder at the top of the Projects
    // folder with its note inside, runs the Project template if there is one, and opens the note
    // (ProjectNotes.create). Dates in the name become its start and due: "Harbor Mural 2026-10-01 2026-11-15".
    // It replaces typing `!project Name` as a new note's title, which Get Template routed to the Project template.
    async invoke() {
        await plainday.ProjectNotes.create("project");
    }
}
