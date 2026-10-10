import { createWorker, PSM } from 'tesseract.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const imgPath = process.argv[2];
  if (!imgPath || !fs.existsSync(imgPath)) {
    console.error(JSON.stringify({ error: `File not found: ${imgPath}` }));
    process.exit(1);
  }

  const psmArg = process.argv[3];

  // Find root directory containing traineddata or node_modules
  const rootDir = path.resolve(__dirname, '../..');
  const trainedDataDir = path.resolve(rootDir);

  let worker = null;
  try {
    worker = await createWorker('eng', 1, {
      langPath: fs.existsSync(path.join(trainedDataDir, 'eng.traineddata')) ? trainedDataDir : undefined,
    });

    if (psmArg === '3' || psmArg === 'AUTO') {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    } else if (psmArg === '4' || psmArg === 'SINGLE_COLUMN') {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN });
    } else if (psmArg === '6' || psmArg === 'SINGLE_BLOCK') {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    }

    const ret = await worker.recognize(imgPath, {}, { blocks: true });

    // Extract structured lines and words with spatial bounding boxes
    const lines = [];
    const words = [];

    if (Array.isArray(ret.data?.blocks)) {
      for (const block of ret.data.blocks) {
        if (Array.isArray(block.paragraphs)) {
          for (const para of block.paragraphs) {
            if (Array.isArray(para.lines)) {
              for (const line of para.lines) {
                const lineText = (line.text || '').trim();
                if (!lineText) continue;

                const lineBbox = line.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
                const lineWords = [];

                if (Array.isArray(line.words) && line.words.length > 0) {
                  for (const w of line.words) {
                    const wt = (w.text || '').trim();
                    if (!wt) continue;
                    const wBbox = w.bbox || { ...lineBbox };
                    const wordObj = {
                      text: wt,
                      confidence: typeof w.confidence === 'number' ? w.confidence : 80,
                      bbox: { x0: wBbox.x0, y0: wBbox.y0, x1: wBbox.x1, y1: wBbox.y1 },
                    };
                    lineWords.push(wordObj);
                    words.push(wordObj);
                  }
                } else {
                  const tokens = lineText.split(/\s+/);
                  for (const tok of tokens) {
                    if (!tok) continue;
                    const wordObj = {
                      text: tok,
                      confidence: typeof line.confidence === 'number' ? line.confidence : 80,
                      bbox: { ...lineBbox },
                    };
                    lineWords.push(wordObj);
                    words.push(wordObj);
                  }
                }

                lineWords.sort((a, b) => a.bbox.x0 - b.bbox.x0);

                lines.push({
                  text: lineText,
                  confidence: typeof line.confidence === 'number' ? line.confidence : 80,
                  bbox: { x0: lineBbox.x0, y0: lineBbox.y0, x1: lineBbox.x1, y1: lineBbox.y1 },
                  words: lineWords,
                });
              }
            }
          }
        }
      }
    }

    // Sort lines vertically from top to bottom
    lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);

    const output = {
      text: ret.data.text || '',
      confidence: typeof ret.data.confidence === 'number' ? ret.data.confidence : 0,
      lines,
      words,
    };

    process.stdout.write(JSON.stringify(output));
  } catch (err) {
    console.error(JSON.stringify({ error: String(err?.message || err) }));
    process.exit(1);
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

main().catch(err => {
  console.error(JSON.stringify({ error: String(err?.message || err) }));
  process.exit(1);
});
