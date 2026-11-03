import { describe, it, expect } from 'vitest';
import { detectColumnsFromHeaderWords } from '../semanticColumnDetector';
import type { OCRWord } from '../ocrService';

function makeWord(text: string, x0: number, x1: number): OCRWord {
  return {
    text,
    bbox: { x0, y0: 10, x1, y1: 30 },
    confidence: 95,
  };
}

describe('semanticColumnDetector positional inference', () => {
  it('assigns sellingPrice with confidence 65 when gap between rate and mrp has exactly one unknown numeric column', () => {
    // Columns: Item Description (0-180), Rate (300-360), CustomCol (500-600), MRP (700-760), Total (900-960)
    const headerWords: OCRWord[] = [
      makeWord('Item', 0, 60),
      makeWord('Description', 70, 180),
      makeWord('Rate', 300, 360),
      makeWord('CustomCol', 500, 600),
      makeWord('MRP', 700, 760),
      makeWord('Total', 900, 960),
    ];

    const dataRows = [
      {
        words: [
          makeWord('Sugar 1kg', 0, 180),
          makeWord('40.00', 300, 350),
          makeWord('45.00', 500, 560), // numeric cell in CustomCol!
          makeWord('50.00', 700, 750),
          makeWord('80.00', 900, 950),
        ],
      },
    ];

    const cols = detectColumnsFromHeaderWords(headerWords, 1000, dataRows);
    const customCol = cols.find((c) => c.headerText === 'CustomCol');
    expect(customCol).toBeDefined();
    expect(customCol!.type).toBe('sellingPrice');
    expect(customCol!.confidence).toBe(65);
  });

  it('leaves column unknown when the gap column contains non-numeric text across data rows', () => {
    const headerWords: OCRWord[] = [
      makeWord('Item', 0, 60),
      makeWord('Description', 70, 180),
      makeWord('Rate', 300, 360),
      makeWord('Notes', 500, 600),
      makeWord('MRP', 700, 760),
      makeWord('Total', 900, 960),
    ];

    const dataRows = [
      {
        words: [
          makeWord('Sugar 1kg', 0, 180),
          makeWord('40.00', 300, 350),
          makeWord('FragileBox', 500, 590), // text, non-numeric!
          makeWord('50.00', 700, 750),
          makeWord('80.00', 900, 950),
        ],
      },
    ];

    const cols = detectColumnsFromHeaderWords(headerWords, 1000, dataRows);
    const notesCol = cols.find((c) => c.headerText === 'Notes');
    expect(notesCol).toBeDefined();
    expect(notesCol!.type).toBe('unknown');
  });

  it('leaves columns unknown when the gap contains two unknown columns even if numeric', () => {
    const headerWords: OCRWord[] = [
      makeWord('Item', 0, 60),
      makeWord('Description', 70, 180),
      makeWord('Rate', 300, 360),
      makeWord('Extra1', 450, 520),
      makeWord('Extra2', 580, 650),
      makeWord('MRP', 750, 810),
      makeWord('Total', 900, 960),
    ];

    const dataRows = [
      {
        words: [
          makeWord('Sugar 1kg', 0, 180),
          makeWord('40.00', 300, 350),
          makeWord('42.00', 450, 510),
          makeWord('45.00', 580, 640),
          makeWord('50.00', 750, 800),
          makeWord('80.00', 900, 950),
        ],
      },
    ];

    const cols = detectColumnsFromHeaderWords(headerWords, 1000, dataRows);
    const extra1 = cols.find((c) => c.headerText === 'Extra1');
    const extra2 = cols.find((c) => c.headerText === 'Extra2');
    expect(extra1?.type).toBe('unknown');
    expect(extra2?.type).toBe('unknown');
  });

  it('assigns tax with confidence 65 when gap between discount and total has exactly one unknown numeric column', () => {
    const headerWords: OCRWord[] = [
      makeWord('Item', 0, 60),
      makeWord('Description', 70, 180),
      makeWord('Rate', 300, 360),
      makeWord('Discount', 450, 530),
      makeWord('GSTVal', 650, 720),
      makeWord('Total', 850, 920),
    ];

    const dataRows = [
      {
        words: [
          makeWord('Soap', 0, 180),
          makeWord('40.00', 300, 350),
          makeWord('5.00', 450, 510),
          makeWord('6.30', 650, 710), // numeric tax cell!
          makeWord('41.30', 850, 910),
        ],
      },
    ];

    const cols = detectColumnsFromHeaderWords(headerWords, 1000, dataRows);
    const taxCol = cols.find((c) => c.headerText === 'GSTVal');
    expect(taxCol).toBeDefined();
    expect(taxCol!.type).toBe('tax');
    expect(taxCol!.confidence).toBe(65);
  });

  it('leaves unknown columns unchanged when no dataRows are provided', () => {
    const headerWords: OCRWord[] = [
      makeWord('Item', 0, 60),
      makeWord('Description', 70, 180),
      makeWord('Rate', 300, 360),
      makeWord('CustomCol', 500, 600),
      makeWord('MRP', 700, 760),
      makeWord('Total', 900, 960),
    ];

    const cols = detectColumnsFromHeaderWords(headerWords, 1000);
    const customCol = cols.find((c) => c.headerText === 'CustomCol');
    expect(customCol).toBeDefined();
    expect(customCol!.type).toBe('unknown');
  });
});
