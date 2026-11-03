import { createWorker } from 'tesseract.js';
import fs from 'fs';

async function test() {
  const worker = await createWorker('eng');
  console.log('Worker created');
  const ret = await worker.recognize('scratch/test_invoice.jpeg');
  console.log('Keys in ret.data:', Object.keys(ret.data));
  console.log('Confidence:', ret.data.confidence);
  console.log('Text preview:', ret.data.text.slice(0, 500));
  if (ret.data.blocks) console.log('Blocks count:', ret.data.blocks.length);
  if (ret.data.lines) console.log('Lines count:', ret.data.lines.length);
  if (ret.data.words) console.log('Words count:', ret.data.words.length);
  await worker.terminate();
}

test().catch(console.error);
