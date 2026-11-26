/**
 * @file validate-tips.mjs
 * @description Closed-Loop Verbatim Citation & Schema Validator
 *
 * This test suite guarantees the integrity of the cheatsheet:
 * 1. Schema & Unique IDs: Ensures each tip has a kebab-case ID, valid category, and tier.
 * 2. 1-to-1 Hardware Matching: Ensures `tip.buttons` strictly matches the IDs parsed from
 *    `tip.combo` (grammar in `src/lib/device.js`), preventing false-positive highlights on the
 *    interactive Faceplate. Every ID is a control that the Faceplate actually draws.
 * 3. Verbatim Citation Verification: Reads the manual corpus under `docs/reference/<slug>/`
 *    (generated from the SHA-256-pinned official PDF by `npm run docs:sync`), finds the
 *    `<!-- [Page N] -->` page anchor, and verifies that `citation.quote` appears word-for-word
 *    on that page. Optional `display` codes and "Ver. x.xx" context tags are checked against
 *    the same page.
 * 4. Alias Anti-Bloat Bounds: Verifies 1:1 coverage in `src/lib/data/aliases.json` and ensures
 *    no single alias is shared across >2 tips to prevent search dilution.
 *
 * Adapting for Another Device: update `src/lib/device.js` (categories, controls, combo grammar)
 * and `docs/reference/sources.json`; this script reads both.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CATEGORIES, DEVICE, VALID_BUTTON_IDS, comboToButtons } from '../src/lib/device.js';

const TIPS_PATH = path.resolve('src/lib/data/tips.json');
const ALIASES_PATH = path.resolve('src/lib/data/aliases.json');
const SOURCES_PATH = path.resolve('docs/reference/sources.json');

const VALID_CATEGORIES = new Set(CATEGORIES);
const VALID_TIERS = new Set(['essential', 'deep-dive']);
const MIN_QUOTE_LENGTH = 12;
// Citations are short excerpts that prove a shortcut, not reproductions of the manual.
const MAX_QUOTE_LENGTH = 240;

const { sources } = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
const DOC_PREFIXES = sources.map((s) => `docs/reference/${s.slug}/`);

function normalizeWhitespace(str) {
	return str.replace(/\s+/g, ' ').trim();
}

const missingCorpora = sources.filter(
	(s) => !fs.existsSync(path.resolve('docs/reference', s.slug, 'INDEX.md'))
);
if (missingCorpora.length > 0) {
	console.error(
		`❌ Manual corpus not found for: ${missingCorpora.map((s) => s.slug).join(', ')}.\n` +
			'   Run `npm run docs:sync` to download the official PDF and generate it.'
	);
	process.exit(1);
}

const docCache = new Map();

function getPageText(docRelPath, pageNum) {
	if (!docCache.has(docRelPath)) {
		const absPath = path.resolve(docRelPath);
		docCache.set(docRelPath, fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : null);
	}
	const content = docCache.get(docRelPath);
	if (!content) return null;

	const marker = `<!-- [Page ${pageNum}] -->`;
	const startIdx = content.indexOf(marker);
	if (startIdx === -1) return null;

	const nextMarkerIdx = content.indexOf('<!-- [Page ', startIdx + marker.length);
	const slice =
		nextMarkerIdx === -1 ? content.slice(startIdx) : content.slice(startIdx, nextMarkerIdx);
	return normalizeWhitespace(slice);
}

const tips = JSON.parse(fs.readFileSync(TIPS_PATH, 'utf8'));

if (!Array.isArray(tips) || tips.length === 0) {
	console.error('❌ tips.json must be a non-empty array.');
	process.exit(1);
}

if (!fs.existsSync(ALIASES_PATH)) {
	console.error('❌ aliases.json not found at src/lib/data/aliases.json.');
	process.exit(1);
}
const aliasesMap = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf8'));

const seenIds = new Set();
const errors = [];

for (const [index, tip] of tips.entries()) {
	const prefix = `Tip #${index + 1} (${tip.id ?? 'missing-id'})`;

	if (typeof tip.id !== 'string' || !/^[a-z0-9-]+$/.test(tip.id)) {
		errors.push(`${prefix}: "id" must be a non-empty kebab-case string.`);
	} else if (seenIds.has(tip.id)) {
		errors.push(`${prefix}: Duplicate tip id "${tip.id}".`);
	} else {
		seenIds.add(tip.id);
	}

	if (!VALID_CATEGORIES.has(tip.category)) {
		errors.push(`${prefix}: Invalid category "${tip.category}".`);
	}

	if (!VALID_TIERS.has(tip.tier)) {
		errors.push(`${prefix}: "tier" must be one of: ${[...VALID_TIERS].join(', ')}.`);
	}

	if (!Array.isArray(tip.combo) || tip.combo.length === 0) {
		errors.push(`${prefix}: "combo" must be a non-empty string array.`);
	}

	if (!Array.isArray(tip.buttons) || tip.buttons.length === 0) {
		errors.push(`${prefix}: "buttons" must be a non-empty array of hardware button IDs.`);
	} else {
		for (const btn of tip.buttons) {
			if (!VALID_BUTTON_IDS.has(btn)) {
				errors.push(`${prefix}: Unknown hardware button ID "${btn}" in "buttons".`);
			}
		}
		if (Array.isArray(tip.combo)) {
			const expectedButtons = comboToButtons(tip.combo);
			if (JSON.stringify(tip.buttons) !== JSON.stringify(expectedButtons)) {
				errors.push(
					`${prefix}: "buttons" ${JSON.stringify(tip.buttons)} does not match "combo" ${JSON.stringify(expectedButtons)}.`
				);
			}
		}
	}

	if (typeof tip.action !== 'string' || tip.action.trim().length < 5) {
		errors.push(`${prefix}: "action" must be a descriptive string.`);
	}

	if (typeof tip.goal !== 'string' || tip.goal.trim().length < 10) {
		errors.push(`${prefix}: "goal" must explain why/when the shortcut is useful.`);
	}

	if (tip.caveat !== undefined) {
		if (typeof tip.caveat !== 'string' || tip.caveat.trim().length < 12) {
			errors.push(`${prefix}: "caveat" must be a non-empty descriptive string when present.`);
		}
	}

	if (tip.steps !== undefined) {
		if (!Array.isArray(tip.steps) || tip.steps.some((s) => typeof s !== 'string' || !s.trim())) {
			errors.push(`${prefix}: "steps" must be an array of non-empty strings when present.`);
		}
	}

	if ('aliases' in tip) {
		errors.push(
			`${prefix}: Inline "aliases" found in tips.json; move to src/lib/data/aliases.json.`
		);
	}

	const tipAliases = aliasesMap[tip.id];
	if (!Array.isArray(tipAliases) || tipAliases.length === 0) {
		errors.push(`${prefix}: Missing or empty entry in src/lib/data/aliases.json for "${tip.id}".`);
	} else {
		for (const a of tipAliases) {
			if (typeof a !== 'string' || a.trim().length < 2 || a !== a.toLowerCase()) {
				errors.push(
					`${prefix}: Invalid alias "${a}" in aliases.json (must be lowercase string >= 2 chars).`
				);
			}
		}
	}

	if ('sources' in tip) {
		errors.push(`${prefix}: Deprecated "sources" field found; use "citation" only.`);
	}

	// Closed-loop verbatim quote verification against the generated manual corpus
	if (!tip.citation || typeof tip.citation !== 'object') {
		errors.push(`${prefix}: Missing required "citation" ({ doc, page, quote }).`);
		continue;
	}

	const { doc, page, quote } = tip.citation;
	if (typeof doc !== 'string' || !DOC_PREFIXES.some((p) => doc.startsWith(p))) {
		errors.push(`${prefix}: citation.doc must be a path under ${DOC_PREFIXES.join(' or ')}.`);
		continue;
	}
	if (!Number.isInteger(page) || page < 1) {
		errors.push(`${prefix}: citation.page must be a positive integer.`);
		continue;
	}
	if (typeof quote !== 'string' || normalizeWhitespace(quote).length < MIN_QUOTE_LENGTH) {
		errors.push(
			`${prefix}: citation.quote must be at least ${MIN_QUOTE_LENGTH} characters of verbatim text.`
		);
		continue;
	}
	const normQuote = normalizeWhitespace(quote);
	if (normQuote.length > MAX_QUOTE_LENGTH) {
		errors.push(
			`${prefix}: citation.quote is ${normQuote.length} characters; keep it to the shortest verbatim excerpt (max ${MAX_QUOTE_LENGTH}).`
		);
	}

	const pageText = getPageText(doc, page);
	if (pageText === null) {
		errors.push(`${prefix}: Could not find Page ${page} in "${doc}".`);
		continue;
	}
	if (!pageText.includes(normQuote)) {
		errors.push(
			`${prefix}: Verbatim quote "${normQuote}" was NOT found on Page ${page} of "${doc}".`
		);
	}

	if (tip.display !== undefined) {
		if (typeof tip.display !== 'string' || tip.display.length === 0 || tip.display.length > 6) {
			errors.push(`${prefix}: "display" must be the 1–6 character LED code shown by the unit.`);
		} else if (!pageText.includes(tip.display)) {
			errors.push(
				`${prefix}: Display code "${tip.display}" was NOT found on Page ${page} of "${doc}".`
			);
		}
	}

	const versionTag = /^Ver\. (\d+\.\d+)$/.exec(tip.context ?? '');
	if (versionTag) {
		const version = versionTag[1].replace('.', '\\.');
		if (!new RegExp(`Ver\\. ?${version}`).test(pageText)) {
			errors.push(
				`${prefix}: context "${tip.context}" is not backed by a version note on Page ${page}.`
			);
		}
	}
}

const aliasFrequency = new Map();
for (const [key, list] of Object.entries(aliasesMap)) {
	if (!seenIds.has(key)) {
		errors.push(`aliases.json: Orphan key "${key}" does not match any tip.id in tips.json.`);
	}
	if (Array.isArray(list)) {
		for (const a of list) {
			if (!aliasFrequency.has(a)) aliasFrequency.set(a, []);
			aliasFrequency.get(a).push(key);
		}
	}
}

for (const [alias, ids] of aliasFrequency.entries()) {
	if (ids.length > 2) {
		errors.push(
			`aliases.json: Alias "${alias}" is shared by ${ids.length} tips (${ids.join(', ')}); max allowed is 2 to prevent search bloat.`
		);
	}
}

if (errors.length > 0) {
	console.error('❌ Validation failed:\n' + errors.map((e) => `  - ${e}`).join('\n'));
	process.exit(1);
}

console.log(
	`✔ Validated ${tips.length} ${DEVICE.model} tips + ${Object.keys(aliasesMap).length} alias entries (1:1 hardware IDs, verbatim Roland quotes, and anti-bloat alias bounds).`
);
