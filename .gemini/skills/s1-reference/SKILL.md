---
name: s1-reference
description: Official Roland S-1 Owner's Manual lookup, PDF ingestion pipeline, and closed-loop tip verification rules for this cheat sheet. Use whenever adding, auditing, or modifying tips in src/lib/data/tips.json, updating hardware controls in src/lib/device.js or Faceplate.svelte, or ingesting a new manual PDF.
---

# Roland S-1 Reference & Tip Verification Skill

Never guess, summarize from memory, or invent S-1 button combinations. All shortcuts and hardware labels in this repository are backed by the official Roland S-1 Owner's Manual and enforced by `scripts/validate-tips.mjs`.

## 1. Where the Ground-Truth Reference Lives

The manual text is Roland's copyrighted work, so it is **generated locally, not committed**:

- `docs/reference/sources.json` pins the official PDF (URL + SHA-256) and its chapter layout.
- Run `npm run docs:sync` to download it and generate page-anchored markdown in `docs/reference/roland-s1-v102/` (`INDEX.md`, chapter files with `<!-- [Page N] -->` anchors, and `EXTRACTED_SHORTCUTS.md`).
- The shortcut table on page 70 and the function/menu lists on pages 64–69 are the densest sources.

## 2. Ingesting a New Manual Revision

1. Download the new PDF from Roland and check what changed.
2. Re-verify every affected tip, then update `url`, `sha256` and `chapters` in `docs/reference/sources.json`.
3. Run `npm run docs:sync -- --force` (or `npm run docs:ingest -- --pdf <file> --slug <slug> --title "<title>"` for a local file).

## 3. Rules for Editing `src/lib/data/tips.json`

1. **1-to-1 `combo` ↔ `buttons` Alignment**: `tip.buttons` must equal the IDs parsed from `tip.combo` by `comboTokenToButtons()` in `src/lib/device.js` (e.g. `"PAD 16 (WRITE)"` → `PAD 16`, `"Turn any KNOB"` → `KNOB`, `"PAD 1–16"` → `PAD`). Verbs are capitalised (`Hold`, `Turn`), controls are upper-case (`HOLD`).
2. **Mandatory Verbatim `citation`**:
   ```json
   "citation": {
     "doc": "docs/reference/roland-s1-v102/04-save-copy-reload.md",
     "page": 47,
     "quote": "Once the power is turned off, any unsaved patterns are reset to their last saved state."
   }
   ```
   The quote (12–240 characters) must literally exist on that page. Keep it to the shortest excerpt that proves the shortcut.
3. **Optional fields**: `display` (the LED code, e.g. `"CLr.n"`) and `context: "Ver. 1.02"` must both be backed by the cited page.
4. **Always Run Validation**: run `npm run check` after any change to `src/lib/data/tips.json` or `src/lib/data/aliases.json`.
