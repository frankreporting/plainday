---
id: 2026091210000000
tags:
name: Juniper Hale
address:
  - 418 Larkspur Lane
  - Maple Falls, ST 00000
terms: Net 30
payment_note: Please pay by bank transfer within 30 days.
folder: Reference/Invoices
last_number: 1001
---
Your details for invoices. The Invoice command copies them into each new invoice: `name` and `address` (one line per item) head it, `terms` and `payment_note` close it. A project's own `terms` wins over these. This note is yours: updates leave it alone.

`folder` is where new invoices go, like `Business/Invoices`; left blank, each goes into its project's `invoices/` folder. *Update Obsidian PM* puts the Invoices base there too. `last_number` is the highest invoice number given so far: the next invoice is one more than it, or than the highest invoice note's number if that's higher, and the Invoice command raises it each time, so a deleted invoice's number is never used again.
