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

export type SupportedPSM = '3' | '4' | '6' | '11' | 'auto';

/**
 * Evaluates the quality of OCR output for invoice/table parsing.
 */
function scoreOCRResult(result: OCRResult): number {
  const lineCount = result.lines.length;
  const wordCount = result.words.length;
  const avgConf = result.confidence;
  // Count lines that contain both alphabetic/regional script text and numbers (typical product line items)
  const candidateItemLines = result.lines.filter(
    (l) => /[a-zA-Z\u0900-\u0D7F]/.test(l.text) && /\d/.test(l.text)
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
    logger: (m: any) => {
      if (m.status === 'recognizing text' && onProgress) {
        const pct = Math.round(20 + m.progress * 65); // 20% to 85%
        onProgress(pct, `Scanning bill layout & characters (${Math.round(m.progress * 100)}%)...`);
      }
    },
  });

  try {
    // Mode resolution
    if (psmMode === '3' || psmMode === '4' || psmMode === '6' || psmMode === '11') {
      const targetPsm =
        psmMode === '3'
          ? PSM.AUTO
          : psmMode === '4'
          ? PSM.SINGLE_COLUMN
          : psmMode === '6'
          ? PSM.SINGLE_BLOCK
          : PSM.SPARSE_TEXT;

      await worker.setParameters({ tessedit_pageseg_mode: targetPsm });
      const { data } = await worker.recognize(imageSource, {}, { blocks: true });
      const { lines, words } = extractLinesAndWordsFromPage(data);
      const avgWordConf = words.length > 0
        ? Math.round(words.reduce((sum, w) => sum + (typeof w.confidence === 'number' ? w.confidence : 80), 0) / words.length)
        : (typeof data.confidence === 'number' ? Math.round(data.confidence) : 75);

      return {
        text: data.text || '',
        confidence: avgWordConf,
        lines,
        words,
        psmModeUsed: `PSM ${psmMode}`,
        imageWidth: typeof (data as any)?.image_width === 'number' ? (data as any).image_width : (typeof (imageSource as any)?.width === 'number' ? (imageSource as any).width : undefined),
        imageHeight: typeof (data as any)?.image_height === 'number' ? (data as any).image_height : (typeof (imageSource as any)?.height === 'number' ? (imageSource as any).height : undefined),
      };
    }

    // Step 1: Primary extraction using PSM.AUTO (PSM 3 - Fully automatic multi-column page segmentation)
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    const resAuto = await worker.recognize(imageSource, {}, { blocks: true });
    const { lines: linesAuto, words: wordsAuto } = extractLinesAndWordsFromPage(resAuto.data);
    const avgConfAuto = wordsAuto.length > 0
      ? Math.round(wordsAuto.reduce((sum, w) => sum + (typeof w.confidence === 'number' ? w.confidence : 80), 0) / wordsAuto.length)
      : (typeof resAuto.data.confidence === 'number' ? Math.round(resAuto.data.confidence) : 75);

    const resultAuto: OCRResult = {
      text: resAuto.data.text || '',
      confidence: avgConfAuto,
      lines: linesAuto,
      words: wordsAuto,
      psmModeUsed: 'PSM AUTO (3)',
      imageWidth: typeof (resAuto.data as any)?.image_width === 'number' ? (resAuto.data as any).image_width : (typeof (imageSource as any)?.width === 'number' ? (imageSource as any).width : undefined),
      imageHeight: typeof (resAuto.data as any)?.image_height === 'number' ? (resAuto.data as any).image_height : (typeof (imageSource as any)?.height === 'number' ? (imageSource as any).height : undefined),
    };

    const scoreAuto = scoreOCRResult(resultAuto);

    // If PSM AUTO found good table content (>= 4 candidate lines and acceptable confidence)
    if (resultAuto.lines.length >= 4 && resultAuto.confidence >= 50 && scoreAuto >= 80) {
      if (onProgress) {
        onProgress(88, 'Document layout and table structures recognized successfully...');
      }
      return resultAuto;
    }

    // Step 2: Fallback to PSM 6 (single uniform block) if AUTO was sparse
    if (onProgress) {
      onProgress(50, 'Evaluating structured block layout (PSM 6)...');
    }
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const res6 = await worker.recognize(imageSource, {}, { blocks: true });
    const { lines: lines6, words: words6 } = extractLinesAndWordsFromPage(res6.data);
    const avgConf6 = words6.length > 0
      ? Math.round(words6.reduce((sum, w) => sum + (typeof w.confidence === 'number' ? w.confidence : 80), 0) / words6.length)
      : (typeof res6.data.confidence === 'number' ? Math.round(res6.data.confidence) : 75);

    const result6: OCRResult = {
      text: res6.data.text || '',
      confidence: avgConf6,
      lines: lines6,
      words: words6,
      psmModeUsed: 'PSM 6',
      imageWidth: typeof (res6.data as any)?.image_width === 'number' ? (res6.data as any).image_width : (typeof (imageSource as any)?.width === 'number' ? (imageSource as any).width : undefined),
      imageHeight: typeof (res6.data as any)?.image_height === 'number' ? (res6.data as any).image_height : (typeof (imageSource as any)?.height === 'number' ? (imageSource as any).height : undefined),
    };

    const score6 = scoreOCRResult(result6);
    let bestResult = score6 > scoreAuto ? result6 : resultAuto;
    let bestScore = Math.max(scoreAuto, score6);

    // Step 3: Fallback to PSM 11 (sparse text) if needed
    if (bestResult.lines.length < 3) {
      if (onProgress) {
        onProgress(70, 'Evaluating sparse text layout (PSM 11)...');
      }
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const res11 = await worker.recognize(imageSource, {}, { blocks: true });
      const { lines: lines11, words: words11 } = extractLinesAndWordsFromPage(res11.data);
      const avgConf11 = words11.length > 0
        ? Math.round(words11.reduce((sum, w) => sum + (typeof w.confidence === 'number' ? w.confidence : 80), 0) / words11.length)
        : (typeof res11.data.confidence === 'number' ? Math.round(res11.data.confidence) : 75);

      const result11: OCRResult = {
        text: res11.data.text || '',
        confidence: avgConf11,
        lines: lines11,
        words: words11,
        psmModeUsed: 'PSM 11',
        imageWidth: typeof (res11.data as any)?.image_width === 'number' ? (res11.data as any).image_width : (typeof (imageSource as any)?.width === 'number' ? (imageSource as any).width : undefined),
        imageHeight: typeof (res11.data as any)?.image_height === 'number' ? (res11.data as any).image_height : (typeof (imageSource as any)?.height === 'number' ? (imageSource as any).height : undefined),
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
