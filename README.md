# Roland S-1 Interactive Cheat Sheet

A fast, visual shortcut finder and hardware companion for the **Roland S-1** (AIRA Compact Tweak Synth, firmware 1.02), built with SvelteKit and TypeScript.

This is an S-1 port of **[sp404mk2cheatsheet](https://github.com/cntrvsy/sp404mk2cheatsheet)** by **[frstudios](https://frstudios.co.ke)** ([live](https://cntrvsy.github.io/sp404mk2cheatsheet/)), the original Roland SP-404MKII cheat sheet. Its git history is preserved here.

🔗 **Live Tool:** [S-1 Cheat Sheet](https://gustavares.github.io/s1cheatsheet/)

---

## Features

- **Bidirectional Hardware Highlighting:** Click any knob, button, black key or pad on the SVG front panel to filter shortcuts. Click a card to light up its controls and see the code the S-1's 4-digit LED display shows (e.g. `CLr.n`, `N.Prb`).
- **Real Panel Layout:** The faceplate follows the panel diagram in the Owner's Manual: 16 keyboard/step pads, the black function keys, all 20 knobs, the buttons, the LED display and the rear POWER switch. **Zoom** enlarges it for thumbs on phones.
- **Synth Slang Search:** Search with terms like _"motion record"_, _"chord"_, _"arp"_, _"poly"_, _"glide"_, _"LFO"_, _"OSC draw"_, _"D-Motion"_, _"scatter"_, _"random"_, _"ratchet"_ or _"swing"_ via [`src/lib/data/aliases.json`](./src/lib/data/aliases.json).
- **Curated Studio Sheet & PDF:** Pin go-to shortcuts into a custom sheet and export an ink-friendly 1–2 page reference table.
- **Strict Verification:** 121 shortcuts, each with a verbatim quote and page number from the official Roland S-1 Owner's Manual, checked on every build.
- **Connect your S-1 (Web MIDI, opt-in):** in Chrome or Edge on a desktop computer, press **Connect S-1** to control an S-1 plugged in over USB. Drag a knob (or focus it and press ↑/↓) to send its CC; knob moves on the hardware rotate and light up the on-screen knobs. Controls with no MIDI CC are hatched. Nothing is requested or sent until you connect.

---

## Verification Pipeline

All data is verified against the manual, not hearsay:

- **Source of truth:** the official [Roland S-1 Owner's Manual (Version 1.02)](https://www.roland.com/global/support/by_product/s-1/owners_manuals/), matching the latest S-1 system program (Ver 1.02). Roland publishes no separate Reference Manual for the S-1.
- **Pinned manifest ([`docs/reference/sources.json`](./docs/reference/sources.json)):** the PDF URL, its SHA-256 and the chapter layout.
- **Ingestion ([`scripts/ingest-pdf.mjs`](./scripts/ingest-pdf.mjs)):** `npm run docs:sync` downloads the PDF, checks the hash and extracts page-anchored markdown (`<!-- [Page N] -->`) into `docs/reference/roland-s1-v102/` using the pinned [`unpdf`](https://github.com/unjs/unpdf) (pdf.js), so every machine gets identical text. The generated text is **git-ignored**: the manual is Roland's copyrighted work, so this repo only carries the short quotes in `tips.json`. If Roland publishes a new revision, the hash check fails until the tips are re-verified.
- **Closed-loop validator ([`scripts/validate-tips.mjs`](./scripts/validate-tips.mjs)):** runs in `npm run check` and CI to ensure:
  1. Tip `buttons` exactly match the hardware IDs parsed from `combo`, and every ID is a control drawn on the faceplate.
  2. Each tip's `citation.quote` exists verbatim on the cited manual page (240 characters max).
  3. Optional `display` codes and `Ver. 1.02` tags appear on the cited page.
  4. Search aliases in `aliases.json` keep 1:1 coverage without keyword bloat (an alias may be shared by at most 2 tips).
- **MIDI implementation ([`src/lib/data/midi.json`](./src/lib/data/midi.json)):** the S-1's MIDI implementation chart and control change list (manual pp. 73–74), checked by [`scripts/validate-midi.mjs`](./scripts/validate-midi.mjs): each CC entry is the verbatim line of the manual's control change list, transmit/receive flags are re-parsed from the chart, and no listed CC may be missing.

---

## Porting to Other Instruments

The engine is modular and can be adapted to other hardware:

1. **Pin the manual:** add it to [`docs/reference/sources.json`](./docs/reference/sources.json) (URL, SHA-256, chapters) and run `npm run docs:sync`, or ingest a local file with `npm run docs:ingest -- --pdf <file.pdf> --slug <id> --title "<title>"`.
2. **Describe the hardware ([`src/lib/device.js`](./src/lib/device.js)):** `DEVICE`, `CATEGORIES`, `PANEL_CONTROLS` (IDs and panel positions) and the combo-token grammar. Both [`src/lib/types.ts`](./src/lib/types.ts) and the validator import this file.
3. **Author tips & slang:** populate [`src/lib/data/tips.json`](./src/lib/data/tips.json) with verbatim quotes and map colloquial terms in [`src/lib/data/aliases.json`](./src/lib/data/aliases.json).
4. **Adapt the faceplate ([`src/lib/components/Faceplate.svelte`](./src/lib/components/Faceplate.svelte)):** redraw the panel artwork; controls are rendered from `PANEL_CONTROLS`.

---

## Development

```sh
# Install dependencies
npm install

# Start development server
npm run dev

# Download/extract the manual (first run needs network), validate tips, and type-check
npm run check

# Check code formatting and ESLint rules
npm run lint

# Build static production site (./build)
npm run build
```

Behind an HTTPS proxy on Node 22.21+, run `NODE_USE_ENV_PROXY=1 npm run check` so the manual download uses the proxy.

Pushing to `main` deploys to GitHub Pages through [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) (Pages source: **GitHub Actions**). The base path is the repository name (`/s1cheatsheet`).

---

## AI Usage Disclosure

<p align="left">
  <a href="https://0rwx.com/">
    <img src="./static/AI-W-light.svg" alt="0rwx AI Disclosure Badge" width="40" height="40" />
  </a>
</p>

This project complies with the **[0rwx](https://0rwx.com/)** open AI disclosure specification. The original project used AI coding assistants for architecture, citation validation tooling and documentation. This S-1 port, including the tips, the faceplate and this README, was produced with an AI coding assistant. Every tip's quote is checked verbatim against the official Roland S-1 Owner's Manual (Version 1.02) by the validator.

---

## License & Attribution

- Original project: **[sp404mk2cheatsheet](https://github.com/cntrvsy/sp404mk2cheatsheet)**, built with ❤️ by **[frstudios](https://frstudios.co.ke)**
- S-1 port: **[github.com/gustavares/s1cheatsheet](https://github.com/gustavares/s1cheatsheet)**
- Licensed under the **[MIT License](./LICENSE)** (original copyright notice retained)
- _Disclaimer:_ Roland, AIRA and S-1 are trademarks or registered trademarks of Roland Corporation. This project is an independent educational tool, not affiliated with or endorsed by Roland. Manual excerpts are short quotations for reference; the manual itself is © Roland Corporation.
