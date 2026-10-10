import { createWorker, PSM } from 'tesseract.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

// Machine-readable error codes understood by backend/services/ocr.py
const ERR_LANG_DATA = 'OCR_LANGUAGE_DATA_UNAVAILABLE';
const ERR_ENGINE = 'OCR_ENGINE_FAILED';

function fail(code, message) {
  console.error(JSON.stringify({ error: message, code }));
  process.exit(1);
}

/**
 * Resolve where eng.traineddata comes from, in order of preference:
 * 1. OCR_LANG_PATH env var (a directory holding eng.traineddata[.gz]) for offline deployments
 * 2. The @tesseract.js-data/eng npm package installed with the app (no network needed)
 * 3. A legacy eng.traineddata file in the repository root
 * 4. tesseract.js default (downloads from the jsDelivr CDN at runtime)
 */
function resolveLanguageData() {
  const candidates = [];
  if (process.env.OCR_LANG_PATH) candidates.push(path.resolve(process.env.OCR_LANG_PATH));
  candidates.push(path.join(ROOT_DIR, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int'));
  candidates.push(ROOT_DIR);

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'eng.traineddata.gz'))) return { langPath: dir, gzip: true, source: dir };
    if (fs.existsSync(path.join(dir, 'eng.traineddata'))) return { langPath: dir, gzip: false, source: dir };
  }
  return { langPath: undefined, gzip: true, source: 'cdn.jsdelivr.net (runtime download)' };
}

function resolveCacheDir() {
  const dir = process.env.OCR_CACHE_DIR
    ? path.resolve(process.env.OCR_CACHE_DIR)
    : path.join(ROOT_DIR, 'backend', '.ocr-cache');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // An unwritable cache only disables caching; recognition still works.
  }
  return dir;
}

const PSM_BY_ARG = {
  '3': PSM.AUTO,
  AUTO: PSM.AUTO,
  '4': PSM.SINGLE_COLUMN,
  SINGLE_COLUMN: PSM.SINGLE_COLUMN,
  '6': PSM.SINGLE_BLOCK,
  SINGLE_BLOCK: PSM.SINGLE_BLOCK,
  '11': PSM.SPARSE_TEXT,
  SPARSE_TEXT: PSM.SPARSE_TEXT,
};

async function main() {
  const imgPath = process.argv[2];
  if (!imgPath || !fs.existsSync(imgPath)) {
    fail(ERR_ENGINE, `File not found: ${imgPath}`);
  }
  const psmArg = process.argv[3];
  const lang = resolveLanguageData();

  let worker = null;
  try {
    try {
      worker = await createWorker('eng', 1, {
        langPath: lang.langPath,
        gzip: lang.gzip,
        cachePath: resolveCacheDir(),
      });
    } catch (err) {
      fail(
        ERR_LANG_DATA,
        `Could not load English OCR language data from ${lang.source}: ${String(err?.message || err)}. ` +
          'Run `npm install` in the project root (installs @tesseract.js-data/eng) or set OCR_LANG_PATH ' +
          'to a directory containing eng.traineddata.'
      );
    }

    const params = { preserve_interword_spaces: '1' };
    if (psmArg && PSM_BY_ARG[psmArg] !== undefined) {
      params.tessedit_pageseg_mode = PSM_BY_ARG[psmArg];
    }
    await worker.setParameters(params);

    const ret = await worker.recognize(imgPath, {}, { text: true, blocks: true });

    // Emit every recognised word with its bounding box and confidence. Table
    // rows are rebuilt from these coordinates in Python, because Tesseract's
    // own line grouping often splits one table row across several blocks.
    const lines = [];
    const words = [];
    for (const block of ret.data?.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          const lineText = (line.text || '').trim();
          if (!lineText) continue;
          const lineWords = [];
          for (const w of line.words || []) {
            const text = (w.text || '').trim();
            if (!text || !w.bbox) continue;
            const wordObj = {
              text,
              confidence: typeof w.confidence === 'number' ? w.confidence : null,
              bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
            };
            lineWords.push(wordObj);
            words.push(wordObj);
          }
          lineWords.sort((a, b) => a.bbox.x0 - b.bbox.x0);
          lines.push({
            text: lineText,
            confidence: typeof line.confidence === 'number' ? line.confidence : null,
            bbox: line.bbox,
            words: lineWords,
          });
        }
      }
    }
    lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);

    process.stdout.write(
      JSON.stringify({
        text: ret.data?.text || '',
        confidence: typeof ret.data?.confidence === 'number' ? ret.data.confidence : 0,
        lines,
        words,
        engine: 'tesseract.js',
        language_data: lang.source,
        psm: psmArg || 'default',
      })
    );
  } catch (err) {
    fail(ERR_ENGINE, String(err?.message || err));
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // ignore termination errors
      }
    }
  }
}

main().catch((err) => fail(ERR_ENGINE, String(err?.message || err)));
