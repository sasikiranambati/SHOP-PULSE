import subprocess
import sys
import os

bridge_code = """
import { createWorker } from 'tesseract.js';
import fs from 'fs';

async function main() {
  const imgPath = process.argv[2];
  if (!imgPath || !fs.existsSync(imgPath)) {
    console.error('File not found:', imgPath);
    process.exit(1);
  }
  const worker = await createWorker('eng');
  const ret = await worker.recognize(imgPath);
  await worker.terminate();
  process.stdout.write(JSON.stringify({
    text: ret.data.text,
    confidence: ret.data.confidence
  }));
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
"""

with open("scratch/ocr_worker.mjs", "w", encoding="utf-8") as f:
    f.write(bridge_code)

res = subprocess.run(["node", "scratch/ocr_worker.mjs", "scratch/test_invoice.jpeg"], capture_output=True, text=True)
print("Return code:", res.returncode)
print("Stdout length:", len(res.stdout))
print("Stderr:", res.stderr)
if res.returncode == 0:
    import json
    data = json.loads(res.stdout)
    print("Confidence:", data["confidence"])
    print("First 300 chars of text:\n", data["text"][:300])
