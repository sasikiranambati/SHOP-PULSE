/**
 * @file imagePreprocessor.ts
 * @description Advanced image preprocessing for OCR text and table extraction.
 * Handles grayscale conversion, noise reduction, deskewing, adaptive thresholding,
 * text sharpening, and table border preservation.
 */

export interface PreprocessedImageResult {
  processedDataUrl: string;
  originalDataUrl: string;
  base64Raw: string;
  width: number;
  height: number;
  skewAngle: number;
}

/**
 * Loads a File into an HTMLImageElement.
 */
function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => resolve(img);
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Rescales image dimensions while maintaining aspect ratio.
 */
function getScaledDimensions(
  width: number,
  height: number,
  maxDimension: number = 2000
): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }
  if (width > height) {
    return {
      width: maxDimension,
      height: Math.round((height * maxDimension) / width),
    };
  }
  return {
    width: Math.round((width * maxDimension) / height),
    height: maxDimension,
  };
}

/**
 * Converts image buffer to grayscale array.
 */
function toGrayscale(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Standard ITU-R BT.601 luma formula
    gray[p] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return gray;
}

/**
 * Applies a 3x3 median filter to denoise sensor noise and speckles without blurring sharp text edges.
 */
function denoiseGrayscale(gray: Uint8Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(width * height);
  const window = new Uint8Array(9);

  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    for (let x = 1; x < width - 1; x++) {
      let idx = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const lineOffset = (y + dy) * width;
        for (let dx = -1; dx <= 1; dx++) {
          window[idx++] = gray[lineOffset + (x + dx)];
        }
      }
      // Simple insertion sort for 9 elements
      for (let i = 1; i < 9; i++) {
        const val = window[i];
        let j = i - 1;
        while (j >= 0 && window[j] > val) {
          window[j + 1] = window[j];
          j--;
        }
        window[j + 1] = val;
      }
      output[rowOffset + x] = window[4]; // median value
    }
  }

  // Copy boundaries
  for (let x = 0; x < width; x++) {
    output[x] = gray[x];
    output[(height - 1) * width + x] = gray[(height - 1) * width + x];
  }
  for (let y = 0; y < height; y++) {
    output[y * width] = gray[y * width];
    output[y * width + (width - 1)] = gray[y * width + (width - 1)];
  }

  return output;
}

/**
 * Calculates skew angle using Radon / projection profile variance across angles -12° to +12°.
 */
function detectSkewAngle(gray: Uint8Array, width: number, height: number): number {
  // Subsample for fast deskew angle detection
  const sampleStep = Math.max(1, Math.floor(Math.min(width, height) / 400));
  const sampleW = Math.floor(width / sampleStep);
  const sampleH = Math.floor(height / sampleStep);

  let bestAngle = 0;
  let maxVariance = -1;

  // Search angles with 0.5 degree steps
  for (let angleDeg = -12; angleDeg <= 12; angleDeg += 0.5) {
    const angleRad = (angleDeg * Math.PI) / 180;
    const tan = Math.tan(angleRad);

    const profile = new Float32Array(sampleH);
    for (let y = 0; y < sampleH; y++) {
      let count = 0;
      for (let x = 0; x < sampleW; x++) {
        const srcX = x * sampleStep;
        const srcY = Math.floor(y * sampleStep + (x - sampleW / 2) * sampleStep * tan);
        if (srcY >= 0 && srcY < height && srcX >= 0 && srcX < width) {
          if (gray[srcY * width + srcX] < 128) {
            count++;
          }
        }
      }
      profile[y] = count;
    }

    // Calculate variance of horizontal projection profile
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < sampleH; i++) {
      sum += profile[i];
      sumSq += profile[i] * profile[i];
    }
    const mean = sum / sampleH;
    const variance = sumSq / sampleH - mean * mean;

    if (variance > maxVariance) {
      maxVariance = variance;
      bestAngle = angleDeg;
    }
  }

  return bestAngle;
}

/**
 * Fast integral image for Bradley-Roth adaptive thresholding.
 * Normalizes uneven shadows, camera lighting, and thermal receipt backgrounds.
 */
function adaptiveThreshold(
  gray: Uint8Array,
  width: number,
  height: number,
  windowSizeRatio: number = 0.08,
  thresholdMarginPercent: number = 10
): Uint8Array {
  const binary = new Uint8Array(width * height);
  const integral = new Float64Array(width * height);

  // 1. Build integral image
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const rowOffset = y * width;
    const prevRowOffset = (y - 1) * width;
    for (let x = 0; x < width; x++) {
      rowSum += gray[rowOffset + x];
      if (y === 0) {
        integral[rowOffset + x] = rowSum;
      } else {
        integral[rowOffset + x] = integral[prevRowOffset + x] + rowSum;
      }
    }
  }

  // 2. Adaptive thresholding window
  const s = Math.max(8, Math.round(width * windowSizeRatio));
  const s2 = Math.floor(s / 2);
  const multiplier = (100 - thresholdMarginPercent) / 100;

  for (let y = 0; y < height; y++) {
    const y1 = Math.max(0, y - s2);
    const y2 = Math.min(height - 1, y + s2);
    const rowOffset = y * width;

    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - s2);
      const x2 = Math.min(width - 1, x + s2);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);

      // Sum from integral image: D - B - C + A
      const sum =
        integral[y2 * width + x2] -
        (x1 > 0 ? integral[y2 * width + (x1 - 1)] : 0) -
        (y1 > 0 ? integral[(y1 - 1) * width + x2] : 0) +
        (x1 > 0 && y1 > 0 ? integral[(y1 - 1) * width + (x1 - 1)] : 0);

      const localThreshold = (sum / count) * multiplier;
      binary[rowOffset + x] = gray[rowOffset + x] <= localThreshold ? 0 : 255;
    }
  }

  return binary;
}

/**
 * Sharpens text edges using unsharp masking while preserving horizontal/vertical table borders.
 */
function sharpenAndPreserveTables(
  binary: Uint8Array,
  gray: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const result = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      // Detect continuous horizontal or vertical table lines
      const isHorizontalLine =
        binary[idx] === 0 && binary[idx - 1] === 0 && binary[idx + 1] === 0;
      const isVerticalLine =
        binary[idx] === 0 && binary[idx - width] === 0 && binary[idx + width] === 0;

      if (isHorizontalLine || isVerticalLine) {
        result[idx] = 0; // Keep table borders solid black
      } else {
        // High-contrast text sharpening
        const center = gray[idx];
        const laplacian =
          center * 5 -
          (gray[idx - 1] + gray[idx + 1] + gray[idx - width] + gray[idx + width]);

        if (laplacian < 110) {
          result[idx] = 0; // Text stroke
        } else if (laplacian > 140) {
          result[idx] = 255; // Background
        } else {
          result[idx] = binary[idx];
        }
      }
    }
  }

  return result;
}

/**
 * Main Image Preprocessing Pipeline for Invoice OCR.
 * Steps:
 * 1. Rescale large phone images
 * 2. Convert to Grayscale
 * 3. Median Denoise
 * 4. Detect Skew & Rotate Canvas
 * 5. Adaptive Threshold (Otsu/Bradley shadow removal)
 * 6. Sharpen Text & Preserve Table Borders
 */
export async function preprocessInvoiceImage(file: File): Promise<PreprocessedImageResult> {
  const img = await loadImageFromFile(file);
  const { width: initW, height: initH } = getScaledDimensions(img.naturalWidth, img.naturalHeight, 2000);

  // 1. Render initial scaled image
  const initialCanvas = document.createElement('canvas');
  initialCanvas.width = initW;
  initialCanvas.height = initH;
  const initialCtx = initialCanvas.getContext('2d', { willReadFrequently: true });
  if (!initialCtx) {
    throw new Error('Canvas 2D context unavailable.');
  }
  initialCtx.drawImage(img, 0, 0, initW, initH);
  const originalDataUrl = initialCanvas.toDataURL('image/jpeg', 0.95);

  const imgData = initialCtx.getImageData(0, 0, initW, initH);
  let gray = toGrayscale(imgData.data, initW, initH);

  // 2. Denoise
  gray = denoiseGrayscale(gray, initW, initH);

  // 3. Deskew angle detection
  const skewAngle = detectSkewAngle(gray, initW, initH);

  let finalCanvas = initialCanvas;
  let finalCtx = initialCtx;
  let curW = initW;
  let curH = initH;

  // Apply deskew rotation if skew is significant (> 0.6 degrees)
  if (Math.abs(skewAngle) > 0.6 && Math.abs(skewAngle) < 15) {
    const rad = (-skewAngle * Math.PI) / 180;
    const rotatedCanvas = document.createElement('canvas');
    rotatedCanvas.width = initW;
    rotatedCanvas.height = initH;
    const rotCtx = rotatedCanvas.getContext('2d', { willReadFrequently: true });
    if (rotCtx) {
      rotCtx.fillStyle = '#FFFFFF';
      rotCtx.fillRect(0, 0, initW, initH);
      rotCtx.translate(initW / 2, initH / 2);
      rotCtx.rotate(rad);
      rotCtx.drawImage(initialCanvas, -initW / 2, -initH / 2);
      finalCanvas = rotatedCanvas;
      finalCtx = rotCtx;

      // Recompute grayscale after deskew
      const rotatedData = finalCtx.getImageData(0, 0, initW, initH);
      gray = toGrayscale(rotatedData.data, initW, initH);
      curW = initW;
      curH = initH;
    }
  }

  // 4. Adaptive Thresholding (removes thermal paper shadows, creases, uneven lighting)
  const binary = adaptiveThreshold(gray, curW, curH, 0.08, 12);

  // 5. Sharpen Text & Preserve Table Borders
  const refined = sharpenAndPreserveTables(binary, gray, curW, curH);

  // 6. Write binary refined image back into final canvas
  const outputImgData = finalCtx.createImageData(curW, curH);
  const outData = outputImgData.data;
  for (let i = 0, p = 0; i < outData.length; i += 4, p++) {
    const v = refined[p];
    outData[i] = v;
    outData[i + 1] = v;
    outData[i + 2] = v;
    outData[i + 3] = 255;
  }
  finalCtx.putImageData(outputImgData, 0, 0);

  const processedDataUrl = finalCanvas.toDataURL('image/png');
  const base64Raw = processedDataUrl.split(',')[1] || '';

  return {
    processedDataUrl,
    originalDataUrl,
    base64Raw,
    width: curW,
    height: curH,
    skewAngle,
  };
}
