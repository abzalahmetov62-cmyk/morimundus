import { abortable } from '../player/asset-loading';
import { animatedImage, imageSize, worthwhileImage } from '../storage/image-optimization';

export class ImageEncoderUnavailable extends Error {}
export async function optimizeImage(source: Blob, signal: AbortSignal): Promise<Blob | null> {
  signal.throwIfAborted();
  if (animatedImage(new Uint8Array(await source.arrayBuffer()), source.type)) return null;
  const url = URL.createObjectURL(source), image = new Image(), canvas = document.createElement('canvas');
  const cancel = () => { image.src = ''; };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    image.src = url; await abortable(image.decode(), signal); signal.throwIfAborted();
    const { width, height } = imageSize(image.naturalWidth, image.naturalHeight);
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) throw new ImageEncoderUnavailable('Браузер не поддерживает подготовку изображений');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);
    const result = await abortable(new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', .92)), signal);
    signal.throwIfAborted();
    if (!result || result.type !== 'image/webp') throw new ImageEncoderUnavailable('Браузер не поддерживает сжатие WebP');
    return worthwhileImage(source.size, result.size) ? result : null;
  } finally { signal.removeEventListener('abort', cancel); image.src = ''; URL.revokeObjectURL(url); canvas.width = canvas.height = 0; }
}
