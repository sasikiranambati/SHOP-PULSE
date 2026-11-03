import fs from 'fs';

const data = JSON.parse(fs.readFileSync('scratch/ocr_output_3x.json', 'utf8'));

let lineIdx = 0;
data.blocks.forEach((b) => {
  if (b.paragraphs) {
    b.paragraphs.forEach((p) => {
      if (p.lines) {
        p.lines.forEach((l) => {
          const lNum = lineIdx++;
          if (lNum <= 26) {
            console.log(`\n--- Line [${lNum}] (Y:${l.bbox.y0}-${l.bbox.y1}) ---`);
            const wordsStr = l.words.map(w => `"${w.text}"(X:${w.bbox.x0}-${w.bbox.x1})`).join(' ');
            console.log(wordsStr);
          }
        });
      }
    });
  }
});
