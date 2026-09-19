/**
 * @file ocrService.ts
 * @description In-browser Tesseract OCR Service that extracts detailed word/line
 * bounding boxes, baselines, and confidence scores instead of plain text only.
 */

import { recognize } from 'tesseract.js';

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
  imageWidth?: number;
  imageHeight?: number;
}

/**
 * Performs deep OCR extraction returning word and line positions with spatial coordinates.
 */
export async function performOCR(
  imageSource: string | HTMLCanvasElement,
  onProgress?: (progress: number, statusText: string) => void
): Promise<OCRResult> {
  if (onProgress) {
    onProgress(15, 'Loading in-browser OCR engine...');
  }

  const { data } = await recognize(imageSource, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        const pct = Math.round(15 + m.progress * 70); // 15% to 85%
        onProgress(pct, `Scanning bill layout & characters (${Math.round(m.progress * 100)}%)...`);
      }
    },
  });

  if (onProgress) {
    onProgress(88, 'Constructing spatial word coordinates...');
  }

  const rawWords: OCRWord[] = [];
  const rawLines: OCRLine[] = [];

  const page = data as any;

  // Traverse blocks -> paragraphs -> lines -> words to capture hierarchical bounding boxes
  if (Array.isArray(page.blocks)) {
    for (const block of page.blocks) {
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
              if (Array.isArray(line.words)) {
                for (const w of line.words) {
                  const wordText = (w.text || '').trim();
                  if (!wordText) continue;
                  const wordBbox: BoundingBox = w.bbox
                    ? { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 }
                    : { x0: 0, y0: 0, x1: 0, y1: 0 };

                  const ocrWord: OCRWord = {
                    text: wordText,
                    confidence: typeof w.confidence === 'number' ? w.confidence : 80,
                    bbox: wordBbox,
                  };
                  lineWords.push(ocrWord);
                  rawWords.push(ocrWord);
                }
              }

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

  // Fallback: direct page.words / page.lines if blocks were empty
  if (rawWords.length === 0 && Array.isArray(page.words)) {
    for (const w of page.words) {
      const cleanText = (w.text || '').trim();
      if (!cleanText) continue;
      rawWords.push({
        text: cleanText,
        confidence: typeof w.confidence === 'number' ? w.confidence : 80,
        bbox: w.bbox ? { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 } : { x0: 0, y0: 0, x1: 0, y1: 0 },
      });
    }
  }

  // Sort lines vertically from top to bottom
  rawLines.sort((a, b) => a.bbox.y0 - b.bbox.y0);

  return {
    text: data.text || '',
    confidence: typeof data.confidence === 'number' ? data.confidence : 75,
    lines: rawLines,
    words: rawWords,
  };
}
