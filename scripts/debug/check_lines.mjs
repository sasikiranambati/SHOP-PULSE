import fs from 'fs';
import { isCandidateHeaderLine } from '../src/services/semanticColumnDetector.ts';

const data = JSON.parse(fs.readFileSync('scratch/sri_balaji_ocr.json', 'utf8'));
data.lines.forEach((l, idx) => {
  const isH = isCandidateHeaderLine(l.text);
  console.log(`[${idx}] (isHeader: ${isH}) "${l.text}"`);
});
