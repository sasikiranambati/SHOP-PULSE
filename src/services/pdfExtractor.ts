/**
 * @file pdfExtractor.ts
 * @description Native PDF text & layout extraction with automatic rasterization fallback.
 * Checks for digital selectable text + spatial coordinates first. If selectable text
 * is found, avoids costly OCR. If PDF is scanned or image-only, renders pages to
 * canvas and falls back to OCR pipeline.
 */

import * as pdfjsLib from 'pdfjs-dist';
import type { OCRLine, OCRWord, BoundingBox } from './ocrService';

// Configure pdfjs worker if in browser
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  } catch {
    // Fallback to unpkg CDN worker if URL resolution is not supported
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  }
}

export interface PdfExtractionResult {
  hasSelectableText: boolean;
  rawText: string;
  lines: OCRLine[];
  words: OCRWord[];
  renderedImageDataUrls?: string[];
  totalPages: number;
}

/**
 * Extracts selectable text and word layout directly from a PDF.
 * If the PDF has no selectable text (scanned PDF), renders pages to image data URLs.
 */
export async function extractFromPdf(file: File | ArrayBuffer): Promise<PdfExtractionResult> {
  const arrayBuffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: true,
  });

  const pdfDoc = await loadingTask.promise;
  const totalPages = pdfDoc.numPages;

  const allWords: OCRWord[] = [];
  const allLines: OCRLine[] = [];
  let combinedRawText = '';
  const renderedDataUrls: string[] = [];

  // Inspect up to first 3 pages
  const pagesToScan = Math.min(totalPages, 3);
  let totalTextItemCount = 0;

  for (let pageNum = 1; pageNum <= pagesToScan; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
    const textContent = await page.getTextContent();

    const items = textContent.items as Array<{
      str: string;
      transform: number[];
      width: number;
      height: number;
    }>;

    totalTextItemCount += items.length;

    // Convert PDF text items to OCRWord layout
    const pageWords: OCRWord[] = [];

    for (const item of items) {
      const text = (item.str || '').trim();
      if (!text) continue;

      // In PDF, transform[4] is X, transform[5] is Y (from bottom-left)
      const x = item.transform[4];
      const yBottom = item.transform[5];
      const w = item.width || Math.max(10, text.length * 7);
      const h = item.height || 12;

      // Convert from bottom-left origin to top-left origin
      const yTop = viewport.height - yBottom - h;

      const bbox: BoundingBox = {
        x0: Math.round(x),
        y0: Math.round(Math.max(0, yTop)),
        x1: Math.round(x + w),
        y1: Math.round(Math.max(0, yTop) + h),
      };

      // Split merged tokens if any
      const tokens = text.split(/\s+/);
      if (tokens.length > 1) {
        const charW = w / text.length;
        let curX = x;
        for (const tok of tokens) {
          const tokW = tok.length * charW;
          pageWords.push({
            text: tok,
            confidence: 99,
            bbox: {
              x0: Math.round(curX),
              y0: Math.round(Math.max(0, yTop)),
              x1: Math.round(curX + tokW),
              y1: Math.round(Math.max(0, yTop) + h),
            },
          });
          curX += tokW + charW;
        }
      } else {
        pageWords.push({
          text,
          confidence: 99,
          bbox,
        });
      }
    }

    // Cluster words on page into horizontal lines
    if (pageWords.length > 0) {
      pageWords.sort((a, b) => a.bbox.y0 - b.bbox.y0);

      const rows: OCRWord[][] = [];
      for (const w of pageWords) {
        const yCenter = (w.bbox.y0 + w.bbox.y1) / 2;
        const height = Math.max(8, w.bbox.y1 - w.bbox.y0);
        let matched = false;

        for (const r of rows) {
          const rYCenter = (r[0].bbox.y0 + r[0].bbox.y1) / 2;
          if (Math.abs(yCenter - rYCenter) < height * 0.7) {
            r.push(w);
            matched = true;
            break;
          }
        }

        if (!matched) {
          rows.push([w]);
        }
      }

      for (const r of rows) {
        r.sort((a, b) => a.bbox.x0 - b.bbox.x0);
        const lineText = r.map((w) => w.text).join(' ');
        const minX = Math.min(...r.map((w) => w.bbox.x0));
        const minY = Math.min(...r.map((w) => w.bbox.y0));
        const maxX = Math.max(...r.map((w) => w.bbox.x1));
        const maxY = Math.max(...r.map((w) => w.bbox.y1));

        allLines.push({
          text: lineText,
          confidence: 99,
          bbox: { x0: minX, y0: minY, x1: maxX, y1: maxY },
          words: r,
        });

        combinedRawText += lineText + '\n';
        allWords.push(...r);
      }
    }

    // If text item count is very small, prepare canvas render for OCR fallback
    if (items.length < 5 && typeof document !== 'undefined') {
      try {
        const renderViewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width = renderViewport.width;
        canvas.height = renderViewport.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          await (page as any).render({ canvasContext: ctx, viewport: renderViewport }).promise;
          renderedDataUrls.push(canvas.toDataURL('image/png'));
        }
      } catch (err) {
        console.warn('Could not render PDF page to canvas:', err);
      }
    }
  }

  // Determine if PDF contains digital selectable text
  // Must have at least 4 lines and at least 30 characters of meaningful content
  const hasSelectableText = allLines.length >= 4 && combinedRawText.replace(/\s+/g, '').length >= 30;

  return {
    hasSelectableText,
    rawText: combinedRawText.trim(),
    lines: allLines,
    words: allWords,
    renderedImageDataUrls: renderedDataUrls,
    totalPages,
  };
}
