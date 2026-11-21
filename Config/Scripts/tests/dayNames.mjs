// The reader of periodic note names that the class files ask Plainday for (PeriodicNotes.reader, OBS-297), as
// the tests that load a class on its own hand it in: `plainday.PeriodicNotes` with the time report's default,
// TimeReport.plainName (the demo's names, YYYY-MM-DD, gggg[w]ww, YYYY-MM and YYYY, worked out without moment);
// and a stand-in for a vault whose notes are named otherwise.
import vm from "node:vm";
import { loadClass } from "../../../plugin/classShape.mjs";

export const plainName = loadClass("timeReport.js", vm.createContext({ plainday: {} })).plainName;

// A stand-in for plainday.PeriodicNotes that reads names with `read` (plainName by default)
export const periodicNames = (read = plainName) => ({ reader: () => read });

// A reader for a vault whose days are DD-MM-YYYY, weeks [W]ww-gggg (English Sunday weeks) and months MM-YYYY,
// as the test plan's copy of the demo names them (invented)
export const otherNames = (linktext) => {
    const name = String(linktext ?? "").split("/").pop().trim();
    let m = name.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (m) return plainName(`${m[3]}-${m[2]}-${m[1]}`);
    m = name.match(/^W(\d{2})-(\d{4})$/);
    if (m) return plainName(`${m[2]}w${m[1]}`);
    m = name.match(/^(\d{2})-(\d{4})$/);
    if (m) return plainName(`${m[2]}-${m[1]}`);
    return /^\d{4}$/.test(name) ? plainName(name) : null;
};
