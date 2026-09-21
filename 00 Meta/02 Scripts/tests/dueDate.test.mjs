// Tests for CustomJS/setDueDate.js. Run from the vault root:
//   node --test "00 Meta/02 Scripts/tests/*.test.mjs"
// Only `placement` is pure; the modal and the write are checked in a dev vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const DueDate = vm.runInContext(fs.readFileSync(new URL("../CustomJS/setDueDate.js", here), "utf8") + "\n;DueDate", vm.createContext({}));
const due = new DueDate();
const D = "[[2026-09-30|🚩 9/30]]";
const apply = (line) => { const { from, to, text } = due.placement(line, D); return line.slice(0, from) + text + line.slice(to); };

test("placement: the due date goes before a trailing note link, so End still reaches the note (OBS-36)", () => {
    assert.equal(apply("- [ ] Renew the car [[Renew the car|🔗]]"), "- [ ] Renew the car [[2026-09-30|🚩 9/30]] [[Renew the car|🔗]]");
    assert.equal(apply("- [ ] Order toner [[Hawk Ledger|⭕]]"), "- [ ] Order toner [[2026-09-30|🚩 9/30]] [[Hawk Ledger|⭕]]");
    assert.equal(apply("- [ ] Mow [[Household|🗃️]]"), "- [ ] Mow [[2026-09-30|🚩 9/30]] [[Household|🗃️]]");
    assert.equal(apply("- [ ] A [[P|⭕]] [[A|🔗]]"), "- [ ] A [[2026-09-30|🚩 9/30]] [[P|⭕]] [[A|🔗]]", "before every trailing note link");
    assert.equal(apply("- [ ] A [[A|🔗️]] "), "- [ ] A [[2026-09-30|🚩 9/30]] [[A|🔗️]] ", "with U+FE0F, trailing space kept");
});

test("placement: with no note link at the end, the due date ends the line with a trailing space, as before", () => {
    assert.equal(apply("- [ ] Pay the invoice"), "- [ ] Pay the invoice [[2026-09-30|🚩 9/30]] ");
    assert.equal(apply("- [ ] Pay the invoice "), "- [ ] Pay the invoice [[2026-09-30|🚩 9/30]] ");
    assert.equal(apply("- [ ] Read [[Some note]] later"), "- [ ] Read [[Some note]] later [[2026-09-30|🚩 9/30]] ", "an ordinary link mid-line isn't a note link");
    assert.equal(apply("- [ ] A [[A|🔗]] and more"), "- [ ] A [[A|🔗]] and more [[2026-09-30|🚩 9/30]] ", "a 🔗 that isn't at the end stays where it is");
    assert.equal(apply("- [ ] "), "- [ ] [[2026-09-30|🚩 9/30]] ");
});
