import fs from 'fs';
import { detectColumnsFromHeaderWords } from '../src/services/semanticColumnDetector.js';

const d = JSON.parse(fs.readFileSync('scratch/ocr_output_3x.json', 'utf8'));
const lines = [];
d.blocks.forEach((b) =>
  b.paragraphs?.forEach((p) =>
    p.lines?.forEach((l) =>
      lines.push({
        y: l.bbox?.y0,
        text: l.text,
        words: l.words || [],
      })
    )
  )
);
lines.sort((a, b) => a.y - b.y);

const maxW = Math.max(1600, ...lines.flatMap((ln) => ln.words.map((w) => w.bbox.x1 + 100)));
const cols = detectColumnsFromHeaderWords(lines[9].words, maxW);

function testMap(words, columns) {
  const cellMap = {};
  for (const c of columns) cellMap[c.type] = [];

  for (const word of words) {
    const xCenter = (word.bbox.x0 + word.bbox.x1) / 2;
    let matchedCol = null;
    let minDistance = Infinity;

    for (const col of columns) {
      if (xCenter >= col.minX && xCenter <= col.maxX) {
        matchedCol = col;
        break;
      }
      const dist = Math.min(Math.abs(xCenter - col.minX), Math.abs(xCenter - col.maxX));
      if (dist < minDistance) {
        minDistance = dist;
        matchedCol = col;
      }
    }

    if (matchedCol) {
      let targetType = matchedCol.type;
      if (targetType === 'serial') {
        const isSerialChar = /^([0-9]{1,3}|[#*.]|[0-9]{1,3}[.)]|s|a|\d\?)$/i.test(word.text.trim());
        if (!isSerialChar && /[a-zA-Z]{2,}/.test(word.text)) {
          const prodCol = columns.find((c) => c.type === 'productName');
          if (prodCol) targetType = 'productName';
        }
      }
      if (!cellMap[targetType]) cellMap[targetType] = [];
      cellMap[targetType].push(word.text);
    }
  }

  // HSN overflow
  if (cellMap['hsn'] && cellMap['hsn'].length > 0) {
    const remainingHsn = [];
    const overflowToName = [];
    for (const tok of cellMap['hsn']) {
      const cleanDigits = tok.replace(/[^\d]/g, '');
      if (cleanDigits.length >= 4 && cleanDigits.length <= 8) {
        remainingHsn.push(cleanDigits);
      } else if (/[a-zA-Z&]/.test(tok)) {
        overflowToName.push(tok);
      }
    }
    cellMap['hsn'] = remainingHsn;
    if (overflowToName.length > 0) {
      if (!cellMap['productName']) cellMap['productName'] = [];
      cellMap['productName'].push(...overflowToName);
    }
  }

  const res = {};
  for (const [k, v] of Object.entries(cellMap)) {
    res[k] = v.join(' ').trim();
  }
  return res;
}

for (let i = 11; i <= 26; i++) {
  const cv = testMap(lines[i].words, cols);
  console.log(`Line ${i}: Name="${cv.productName}" | Qty="${cv.quantity}" | Rate="${cv.unitPrice}" | Tax="${cv.tax}" | Total="${cv.total}"`);
}
