import fs from 'fs';

const data = JSON.parse(fs.readFileSync('scratch/ocr_output_3x.json', 'utf8'));

let lineIdx = 0;
data.blocks.forEach((b) => {
  if (b.paragraphs) {
    b.paragraphs.forEach((p) => {
      if (p.lines) {
        p.lines.forEach((l) => {
          const bbox = l.bbox;
          console.log(`[${lineIdx++}] Y:${bbox.y0}-${bbox.y1} X:${bbox.x0}-${bbox.x1} | ${l.text.trim()}`);
        });
      }
    });
  }
});
