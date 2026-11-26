import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';

/**
 * Repeatable PDF-to-Markdown Reference Ingestion Pipeline
 *
 * The official manual text is Roland's copyrighted work, so the generated corpus under
 * `docs/reference/<slug>/` is NOT committed. Instead, `docs/reference/sources.json` pins each
 * official PDF (URL + SHA-256) and this script regenerates byte-identical, page-anchored
 * markdown on any machine (and in CI) before `scripts/validate-tips.mjs` checks the quotes.
 * Text extraction uses the pinned `unpdf` (pdf.js) dependency rather than a system tool, so the
 * output does not depend on whichever `pdftotext` version a machine happens to have.
 *
 * Usage:
 *   npm run docs:sync                    # fetch + ingest every source (no-op when already up to date)
 *   npm run docs:sync -- --force         # re-ingest even if up to date
 *   npm run docs:ingest -- --pdf /path/to/manual.pdf --slug <folder-name> --title "Title"
 *
 * Behind an HTTPS proxy on Node 22.21+, run with NODE_USE_ENV_PROXY=1 so fetch() uses it.
 */

const REFERENCE_DIR = path.resolve('docs/reference');
const SOURCES_PATH = path.join(REFERENCE_DIR, 'sources.json');
const CACHE_DIR = path.join(REFERENCE_DIR, '.cache');
const STAMP_FILE = '.ingest.json';
// Bump when the output format changes, so stale corpora are regenerated.
const INGEST_VERSION = 1;

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith('--')) {
			const key = arg.slice(2);
			const next = argv[i + 1];
			if (next && !next.startsWith('--')) {
				args[key] = next;
				i++;
			} else {
				args[key] = 'true';
			}
		}
	}
	return args;
}

function sha256(data) {
	return crypto.createHash('sha256').update(data).digest('hex');
}

// Roland prints the PLAY/REC button icons with a symbol font that pdf.js maps to Latin letters.
// Map them back to the icons shown on the printed page ("[►] (PLAY)", "[●] (REC)").
const SYMBOL_GLYPHS = [
	['[ø]', '[►]'],
	['[ó]', '[●]']
];

function cleanPageText(rawPage) {
	let text = rawPage;
	for (const [glyph, icon] of SYMBOL_GLYPHS) {
		text = text.replaceAll(glyph, icon);
	}
	return text
		.replace(/\r\n/g, '\n')
		.split('\n')
		.map((line) => line.replace(/\s+$/g, ''))
		.join('\n')
		.replace(/\n{4,}/g, '\n\n\n')
		.trim();
}

async function extractPages(pdfBytes) {
	const pdf = await getDocumentProxy(new Uint8Array(pdfBytes), { verbosity: 0 });
	const { text } = await extractText(pdf, { mergePages: false });
	return text.map(cleanPageText);
}

function siphonShortcutsAndMemos(pages) {
	const findings = [];
	const comboRegex =
		/(?:hold(?:ing)? down|while holding|press(?:ing)?|turn(?:ing)?)[^.]{0,80}\[(?:SHIFT|STEP|PATTERN|HOLD|D-MOTION|TEMPO\/VALUE|PLAY|REC|\d{1,2})\]|\[SHIFT\] (?:button )?\+/i;

	pages.forEach((page, idx) => {
		const pageNum = idx + 1;
		const lines = page.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			if (!line) continue;
			const isVersionNote = /\(Ver\.\s?\d+\.\d+\)/.test(line);
			if (comboRegex.test(line) || isVersionNote) {
				const snippet = lines
					.slice(i, Math.min(lines.length, i + 2))
					.map((l) => l.trim())
					.filter(Boolean)
					.join(' ');
				findings.push({ page: pageNum, type: isVersionNote ? 'VERSION' : 'COMBO', text: snippet });
			}
		}
	});

	return findings;
}

function buildAutoChapters(totalPages, slug) {
	if (totalPages <= 30) {
		return [
			{
				file: `${slug}.md`,
				title: 'Complete Reference Document',
				startPage: 1,
				endPage: totalPages
			}
		];
	}
	const chunkSize = 20;
	const chapters = [];
	let part = 1;
	for (let start = 1; start <= totalPages; start += chunkSize) {
		const end = Math.min(totalPages, start + chunkSize - 1);
		const num = String(part).padStart(2, '0');
		chapters.push({
			file: `${num}-pages-${start}-to-${end}.md`,
			title: `Pages ${start}–${end}`,
			startPage: start,
			endPage: end
		});
		part++;
	}
	return chapters;
}

function writeCorpus({ slug, title, chapters, pages, sourceLabel, pdfSha256, url }) {
	const outDir = path.join(REFERENCE_DIR, slug);
	fs.rmSync(outDir, { recursive: true, force: true });
	fs.mkdirSync(outDir, { recursive: true });

	for (const ch of chapters) {
		const lines = [
			`# ${ch.title}`,
			'',
			`> **Source**: ${title} (Pages ${ch.startPage}–${ch.endPage})`,
			''
		];
		for (let p = ch.startPage; p <= Math.min(ch.endPage, pages.length); p++) {
			lines.push(
				`<!-- [Page ${p}] -->`,
				`## Page ${p}`,
				'',
				'```text',
				pages[p - 1] ?? '',
				'```',
				''
			);
		}
		fs.writeFileSync(path.join(outDir, ch.file), lines.join('\n'));
	}

	const findings = siphonShortcutsAndMemos(pages);
	const shortcutLines = [
		`# Auto-Extracted Shortcuts & Version Notes — ${title}`,
		'',
		`> Automatically siphoned ${findings.length} candidate entries from ${pages.length} pages.`,
		'',
		...findings.map((item) => `- **[Page ${item.page}] (${item.type})**: ${item.text}`),
		''
	];
	fs.writeFileSync(path.join(outDir, 'EXTRACTED_SHORTCUTS.md'), shortcutLines.join('\n'));

	const textSha256 = sha256(pages.join('\f'));
	const indexLines = [
		`# ${title}`,
		'',
		`- **Slug**: \`${slug}\``,
		`- **Source File**: \`${sourceLabel}\``,
		...(url ? [`- **Source URL**: ${url}`] : []),
		`- **PDF SHA-256**: \`${pdfSha256}\``,
		`- **Extracted Text SHA-256**: \`${textSha256}\``,
		`- **Total Pages**: ${pages.length}`,
		'',
		'## Chapters',
		'',
		...chapters.map((ch) => `- [${ch.title}](./${ch.file}) (Pages ${ch.startPage}–${ch.endPage})`),
		`- [Auto-Extracted Shortcuts & Version Notes](./EXTRACTED_SHORTCUTS.md) (${findings.length} items)`,
		''
	];
	fs.writeFileSync(path.join(outDir, 'INDEX.md'), indexLines.join('\n'));
	fs.writeFileSync(
		path.join(outDir, STAMP_FILE),
		JSON.stringify({ ingestVersion: INGEST_VERSION, pdfSha256, textSha256 }, null, '\t') + '\n'
	);

	return { findings: findings.length, textSha256 };
}

async function loadSourcePdf(source) {
	const cachePath = path.join(CACHE_DIR, `${source.slug}.pdf`);
	if (fs.existsSync(cachePath)) {
		const cached = fs.readFileSync(cachePath);
		if (sha256(cached) === source.sha256) return cached;
	}

	let response;
	try {
		response = await fetch(source.url, { redirect: 'follow' });
	} catch (err) {
		throw new Error(
			`Could not download ${source.url} (${err.cause?.code ?? err.message}). ` +
				'The tip validator needs the official manual text. Check your network ' +
				'(behind an HTTPS proxy on Node 22.21+, run with NODE_USE_ENV_PROXY=1), or pass ' +
				`--pdf <file> --slug ${source.slug} with a local copy of the PDF.`,
			{ cause: err }
		);
	}
	if (!response.ok) {
		throw new Error(`Downloading ${source.url} failed: HTTP ${response.status}.`);
	}
	const pdfBytes = Buffer.from(await response.arrayBuffer());
	const actual = sha256(pdfBytes);
	if (actual !== source.sha256) {
		throw new Error(
			`SHA-256 mismatch for ${source.url}\n  expected ${source.sha256}\n  received ${actual}\n` +
				'Roland may have published a new manual revision. Re-verify every tip against it ' +
				'before updating the pinned hash in docs/reference/sources.json.'
		);
	}
	fs.mkdirSync(CACHE_DIR, { recursive: true });
	fs.writeFileSync(cachePath, pdfBytes);
	return pdfBytes;
}

function isUpToDate(source) {
	const stampPath = path.join(REFERENCE_DIR, source.slug, STAMP_FILE);
	if (!fs.existsSync(stampPath)) return false;
	try {
		const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
		return stamp.ingestVersion === INGEST_VERSION && stamp.pdfSha256 === source.sha256;
	} catch {
		return false;
	}
}

async function syncSources(force) {
	const { sources } = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
	for (const source of sources) {
		if (!force && isUpToDate(source)) {
			console.log(`✔ docs/reference/${source.slug}/ is up to date (${source.title}).`);
			continue;
		}
		const pdfBytes = await loadSourcePdf(source);
		const pages = await extractPages(pdfBytes);
		if (source.pages && pages.length !== source.pages) {
			throw new Error(
				`${source.title}: expected ${source.pages} pages, extracted ${pages.length}.`
			);
		}
		const { findings } = writeCorpus({
			slug: source.slug,
			title: source.title,
			chapters: source.chapters ?? buildAutoChapters(pages.length, source.slug),
			pages,
			sourceLabel: path.basename(new URL(source.url).pathname),
			pdfSha256: source.sha256,
			url: source.url
		});
		console.log(
			`✔ Ingested "${source.title}" (${pages.length} pages) into docs/reference/${source.slug}/ (${findings} siphoned shortcuts/version notes).`
		);
	}
}

async function ingestLocalPdf(args) {
	const { slug, pdf: pdfPath } = args;
	const title = args.title || `Reference Document (${slug})`;
	const pdfBytes = fs.readFileSync(path.resolve(pdfPath));
	const pdfSha256 = sha256(pdfBytes);
	const pages = await extractPages(pdfBytes);

	let chapters = buildAutoChapters(pages.length, slug);
	if (fs.existsSync(SOURCES_PATH)) {
		const { sources } = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
		const known = sources.find((s) => s.slug === slug);
		if (known?.chapters) chapters = known.chapters;
		if (known && known.sha256 !== pdfSha256) {
			console.warn(`⚠ ${pdfPath} does not match the SHA-256 pinned for "${slug}" in sources.json.`);
		}
	}

	const { findings } = writeCorpus({
		slug,
		title,
		chapters,
		pages,
		sourceLabel: path.basename(pdfPath),
		pdfSha256
	});
	console.log(
		`✔ Ingested "${title}" (${pages.length} pages) into docs/reference/${slug}/ (${chapters.length} chapter files, ${findings} siphoned shortcuts/version notes).`
	);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.pdf) {
		if (!args.slug) {
			console.error(
				'Usage: node scripts/ingest-pdf.mjs --pdf <file.pdf> --slug <folder-name> [--title "Title"]'
			);
			process.exit(1);
		}
		await ingestLocalPdf(args);
		return;
	}
	await syncSources(args.force === 'true');
}

main().catch((err) => {
	console.error(`❌ ${err.message}`);
	process.exit(1);
});
