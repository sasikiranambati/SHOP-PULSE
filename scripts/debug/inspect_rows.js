import fs from 'fs';

const data = JSON.parse(fs.readFileSync('scratch/ocr_output_3x.json', 'utf8'));
const lines = [];

data.blocks.forEach((b) => {
  if (b.paragraphs) {
    b.paragraphs.forEach((p) => {
      if (p.lines) {
        p.lines.forEach((l) => {
          const words = (l.words || []).map((w) => ({
            text: (w.text || '').trim(),
            confidence: w.confidence || 80,
            bbox: w.bbox || l.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
          })).filter((w) => w.text);
          words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
          lines.push({
            text: (l.text || '').trim(),
            confidence: l.confidence || 80,
            bbox: l.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
            words,
          });
        });
      }
    });
  }
});
lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);

lines.forEach((ln, idx) => {
  console.log(`\nLine ${idx}: [y0=${ln.bbox.y0}] "${ln.text}"`);
  console.log('Words:', ln.words.map(w => `"${w.text}"(x0=${w.bbox.x0}, x1=${w.bbox.x1})`).join(' '));
});
