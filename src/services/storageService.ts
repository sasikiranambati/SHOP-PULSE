/**
 * @file storageService.ts
 * @description Cloud Storage service helper methods for uploading and managing product images.
 * Belongs in `src/services/storageService.ts`.
 */

import { 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject 
} from 'firebase/storage';
import { storage } from './firebase';

const PRODUCTS_IMAGE_FOLDER = 'products';

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Upload a product image to Cloud Storage.
 * Falls back safely to client data URL if storage is unconfigured or offline.
 * 
 * @param file - File object to upload.
 * @param customPath - Optional custom path inside bucket.
 * @returns Public download URL or data URL of uploaded image.
 */
export async function uploadProductImage(file: File, customPath?: string): Promise<string> {
  try {
    const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const path = customPath || `${PRODUCTS_IMAGE_FOLDER}/${fileName}`;
    
    const storageRef = ref(storage, path);
    const snapshot = await uploadBytes(storageRef, file);
    return await getDownloadURL(snapshot.ref);
  } catch (err) {
    console.warn('Cloud Storage upload failed, falling back to local data URL:', err);
    return await fileToDataUrl(file);
  }
}

/**
 * Replace an existing product image with a new file.
 */
export async function replaceProductImage(oldImageUrl: string, newFile: File): Promise<string> {
  if (oldImageUrl && !oldImageUrl.startsWith('data:')) {
    await deleteProductImage(oldImageUrl);
  }
  return uploadProductImage(newFile);
}

/**
 * Delete a product image from Cloud Storage by path or URL.
 * 
 * @param imagePathOrUrl - Storage relative path or download URL.
 */
export async function deleteProductImage(imagePathOrUrl: string): Promise<void> {
  if (!imagePathOrUrl || imagePathOrUrl.startsWith('data:')) return;
  try {
    const storageRef = ref(storage, imagePathOrUrl);
    await deleteObject(storageRef);
  } catch (err) {
    console.warn(`Could not delete image at path ${imagePathOrUrl}:`, err);
  }
}

/**
 * Get the download URL for an image path in Cloud Storage.
 * 
 * @param imagePath - Storage relative path.
 * @returns Promise resolving to public URL string.
 */
export async function getProductImageUrl(imagePath: string): Promise<string> {
  const storageRef = ref(storage, imagePath);
  return getDownloadURL(storageRef);
}
