/**
 * JD 截图压缩（技术方案增补 五）：长边 1600px、JPEG 质量 0.8，约 200–500KB。
 * 用浏览器内置能力完成，原图不上传、也不落盘。
 */
import { IMAGE_JPEG_QUALITY, MAX_IMAGE_EDGE } from '@zhipin/shared';
import { ImportError } from './errors';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ImportError('VISION_FAILED'));
    reader.readAsDataURL(blob);
  });
}

export async function compressImage(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    // 移动端截图常见 EXIF 方向问题，交给浏览器按 EXIF 摆正
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImportError('UNSUPPORTED_FILE');
  }

  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new ImportError('VISION_FAILED');

    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', IMAGE_JPEG_QUALITY)
    );
    if (!blob) throw new ImportError('VISION_FAILED');

    return await blobToDataUrl(blob);
  } finally {
    bitmap.close();
  }
}
