/**
 * @file ocrService.ts
 * @description In-browser Tesseract OCR Service optimized for invoices and bills.
 * Supports Page Segmentation Modes (PSM 4, PSM 6, PSM 11) with automatic selection
 * of the best result, extracting word confidence, bounding boxes, and line grouping.
 */

import { createWorker, PSM } from 'tesseract.js';

export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OCRWord {
  text: string;
  confidence: number;
  bbox: BoundingBox;
}

export interface OCRLine {
  text: string;
  confidence: number;
  bbox: BoundingBox;
  words: OCRWord[];
}

export interface OCRResult {
  text: string;
  confidence: number;
  lines: OCRLine[];
  words: OCRWord[];
  psmModeUsed?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export type SupportedPSM = '4' | '6' | '11' | 'auto';

/**
 * Evaluates the quality of OCR output for invoice/table parsing.
 */
function scoreOCRResult(result: OCRResult): number {
  const lineCount = result.lines.length;
  const wordCount = result.words.length;
  const avgConf = result.confidence;
  // Count lines that contain both alphabetic text and numbers (typical product line items)
  const candidateItemLines = result.lines.filter(
    (l) => /[a-zA-Z]/.test(l.text) && /\d/.test(l.text)
  ).length;

  return candidateItemLines * 25 + lineCount * 5 + wordCount * 2 + avgConf;
}

/**
 * Extracts hierarchical lines and words from Tesseract Page data.
 */
function extractLinesAndWordsFromPage(data: any): { lines: OCRLine[]; words: OCRWord[] } {
  const rawWords: OCRWord[] = [];
  const rawLines: OCRLine[] = [];

  if (Array.isArray(data?.blocks)) {
    for (const block of data.blocks) {
      if (Array.isArray(block.paragraphs)) {
        for (const para of block.paragraphs) {
          if (Array.isArray(para.lines)) {
            for (const line of para.lines) {
              const lineText = (line.text || '').trim();
              if (!lineText) continue;

              const lineBbox: BoundingBox = line.bbox
                ? { x0: line.bbox.x0, y0: line.bbox.y0, x1: line.bbox.x1, y1: line.bbox.y1 }
                : { x0: 0, y0: 0, x1: 0, y1: 0 };

              const lineWords: OCRWord[] = [];
              if (Array.isArray(line.words) && line.words.length > 0) {
                for (const w of line.words) {
                  const wordText = (w.text || '').trim();
                  if (!wordText) continue;

                  const wordBbox: BoundingBox = w.bbox
                    ? { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 }
                    : { ...lineBbox };

                  const ocrWord: OCRWord = {
                    text: wordText,
                    confidence: typeof w.confidence === 'number' ? w.confidence : 80,
                    bbox: wordBbox,
                  };
                  lineWords.push(ocrWord);
                  rawWords.push(ocrWord);
                }
              } else {
                // Synthesize words from line text if line.words is empty
                const tokens = lineText.split(/\s+/);
                for (const tok of tokens) {
                  if (!tok) continue;
                  const synthWord: OCRWord = {
                    text: tok,
                    confidence: typeof line.confidence === 'number' ? line.confidence : 80,
                    bbox: { ...lineBbox },
                  };
                  lineWords.push(synthWord);
                  rawWords.push(synthWord);
                }
              }

              // Sort words horizontally left to right
              lineWords.sort((a, b) => a.bbox.x0 - b.bbox.x0);

              rawLines.push({
                text: lineText,
                confidence: typeof line.confidence === 'number' ? line.confidence : 80,
                bbox: lineBbox,
                words: lineWords,
              });
            }
          }
        }
      }
    }
  }

  // Fallback: direct page.lines or page.words if blocks traversal was empty
  if (rawLines.length === 0 && Array.isArray(data?.lines)) {
    for (const l of data.lines) {
      const lineText = (l.text || '').trim();
      if (!lineText) continue;
      const lineBbox: BoundingBox = l.bbox
        ? { x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1 }
        : { x0: 0, y0: 0, x1: 0, y1: 0 };

      const lWords: OCRWord[] = [];
      if (Array.isArray(l.words)) {
        for (const w of l.words) {
          const wt = (w.text || '').trim();
          if (!wt) continue;
          const wb: BoundingBox = w.bbox
            ? { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 }
            : { ...lineBbox };
          const wordObj: OCRWord = {
            text: wt,
            confidence: typeof w.confidence === 'number' ? w.confidence : 80,
            bbox: wb,
          };
          lWords.push(wordObj);
          rawWords.push(wordObj);
        }
      }

      rawLines.push({
        text: lineText,
        confidence: typeof l.confidence === 'number' ? l.confidence : 80,
        bbox: lineBbox,
        words: lWords,
      });
    }
  }

  // Sort lines vertically from top to bottom
  rawLines.sort((a, b) => a.bbox.y0 - b.bbox.y0);

  return { lines: rawLines, words: rawWords };
}

/**
 * Performs deep OCR extraction returning word and line positions with spatial coordinates.
 * Supports PSM 4 (single column / tables), PSM 6 (single block), PSM 11 (sparse text).
 * Automatically chooses the best result when mode is 'auto'.
 */
export async function performOCR(
  imageSource: string | HTMLCanvasElement,
  onProgress?: (progress: number, statusText: string) => void,
  psmMode: SupportedPSM = 'auto'
): Promise<OCRResult> {
  if (onProgress) {
    onProgress(15, 'Initializing OCR worker & invoice language models...');
  }

  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        const pct = Math.round(20 + m.progress * 65); // 20% to 85%
        onProgress(pct, `Scanning bill layout & characters (${Math.round(m.progress * 100)}%)...`);
      }
    },
  });

  try {
    // Mode resolution
    if (psmMode === '4' || psmMode === '6' || psmMode === '11') {
      const targetPsm =
        psmMode === '4'
          ? PSM.SINGLE_COLUMN
          : psmMode === '6'
          ? PSM.SINGLE_BLOCK
          : PSM.SPARSE_TEXT;

      await worker.setParameters({ tessedit_pageseg_mode: targetPsm });
      const { data } = await worker.recognize(imageSource);
      const { lines, words } = extractLinesAndWordsFromPage(data);

      return {
        text: data.text || '',
        confidence: typeof data.confidence === 'number' ? data.confidence : 75,
        lines,
        words,
        psmModeUsed: `PSM ${psmMode}`,
      };
    }

    // Step 1: Automatic Best Result Selection between PSM 4, PSM 6, and PSM 11
    // 1. First run PSM 4 (optimized for table column structure)
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN });
    const res4 = await worker.recognize(imageSource);
    const { lines: lines4, words: words4 } = extractLinesAndWordsFromPage(res4.data);

    const result4: OCRResult = {
      text: res4.data.text || '',
      confidence: typeof res4.data.confidence === 'number' ? res4.data.confidence : 75,
      lines: lines4,
      words: words4,
      psmModeUsed: 'PSM 4',
    };

    // If PSM 4 extracted good table content (>= 4 lines with candidate items & good confidence)
    const score4 = scoreOCRResult(result4);
    if (result4.lines.length >= 4 && result4.confidence >= 65 && score4 >= 100) {
      if (onProgress) {
        onProgress(88, 'Table columns extracted successfully with PSM 4...');
      }
      return result4;
    }

    // 2. If PSM 4 yielded sparse/few lines, evaluate PSM 6 (single uniform block)
    if (onProgress) {
      onProgress(50, 'Evaluating receipt block layout (PSM 6)...');
    }
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const res6 = await worker.recognize(imageSource);
    const { lines: lines6, words: words6 } = extractLinesAndWordsFromPage(res6.data);

    const result6: OCRResult = {
      text: res6.data.text || '',
      confidence: typeof res6.data.confidence === 'number' ? res6.data.confidence : 75,
      lines: lines6,
      words: words6,
      psmModeUsed: 'PSM 6',
    };

    const score6 = scoreOCRResult(result6);
    let bestResult = score6 > score4 ? result6 : result4;
    let bestScore = Math.max(score4, score6);

    // 3. If still sparse or few items, evaluate PSM 11 (sparse text)
    if (bestResult.lines.length < 3) {
      if (onProgress) {
        onProgress(70, 'Evaluating sparse text layout (PSM 11)...');
      }
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const res11 = await worker.recognize(imageSource);
      const { lines: lines11, words: words11 } = extractLinesAndWordsFromPage(res11.data);

      const result11: OCRResult = {
        text: res11.data.text || '',
        confidence: typeof res11.data.confidence === 'number' ? res11.data.confidence : 75,
        lines: lines11,
        words: words11,
        psmModeUsed: 'PSM 11',
      };

      const score11 = scoreOCRResult(result11);
      if (score11 > bestScore) {
        bestResult = result11;
      }
    }

    if (onProgress) {
      onProgress(88, `Optimized invoice segmentation selected (${bestResult.psmModeUsed})...`);
    }

    return bestResult;
  } finally {
    await worker.terminate();
  }
}
