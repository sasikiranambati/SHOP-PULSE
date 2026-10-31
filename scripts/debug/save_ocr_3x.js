import { createWorker } from 'tesseract.js';
import fs from 'fs';

async function main() {
  const worker = await createWorker('eng');
  const ret = await worker.recognize('scratch/test_3x.png', {}, { blocks: true });
  fs.writeFileSync('scratch/ocr_output_3x.json', JSON.stringify({
    text: ret.data.text,
    confidence: ret.data.confidence,
    blocks: ret.data.blocks
  }, null, 2));
  console.log('Saved OCR data with blocks to scratch/ocr_output_3x.json');
  console.log('Blocks count:', ret.data.blocks.length);
  await worker.terminate();
}

main().catch(console.error);
