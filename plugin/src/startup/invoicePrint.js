import { plainday } from "../host.js";

export default class InvoicePrint {
    // Startup script (OBS-203): an invoice's Billed entries don't print. Obsidian's Export to PDF renders
    // the whole note into one container, each block in a div of its own with no class, then runs the
    // markdown post-processors over that container. This one marks the Billed entries heading's block
    // and every block after it .pm-invoice-billed, which styles.css hides in print. CSS alone would need
    // :has to find the heading's block, and the community directory's scan warns on every :has.
    // Reading view runs the post-processors one block at a time; a block there is never the container,
    // so nothing is marked, and nothing runs as you type.

    // The heading's text, as Invoice writes it (Billing.HEADING)
    static HEADING = "Billed entries";
    static CLASS = "pm-invoice-billed";

    invoke() {
        // Once per load of Plainday, gone with it
        if (this.registered || !plainday.plugin) return;
        this.registered = true;
        plainday.plugin.registerMarkdownPostProcessor((el) => InvoicePrint.mark(el));
    }

    // Marks the blocks from Billed entries on, when `el` is a whole invoice: a note with
    // `cssclasses: pm-invoice`, its blocks the container's children
    /** @param {HTMLElement} el */
    static mark(el) {
        if (!el.classList.contains("pm-invoice")) return;
        const heading = [...el.querySelectorAll("h2")].find((h) => (h.dataset.heading ?? h.textContent ?? "").trim().toLowerCase() === InvoicePrint.HEADING.toLowerCase());
        let block = heading?.parentElement ?? null;
        if (!block || block.parentElement !== el) return;
        for (; block; block = block.nextElementSibling) block.classList.add(InvoicePrint.CLASS);
    }
}
