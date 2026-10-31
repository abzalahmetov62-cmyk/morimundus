import * as THREE from 'three';
import { assetUrl } from '../storage/client';
import type { AlphaMask } from './picking';
import { ResourcePool } from './resource-pool';
import { abortable, retryAsset, fetchAssetImage } from './asset-loading';

export type ImageResource = { texture: THREE.Texture; alpha: AlphaMask; aspect: number };

export class PlayerAssets {
  private disposed = false;
  private pool = new ResourcePool<ImageResource>({
    load: (id, signal) => this.loadImage(id, signal), bytes: image => image.alpha.width * image.alpha.height * 12,
    dispose: image => { image.texture.dispose(); const canvas = image.texture.image as HTMLCanvasElement; canvas.width = canvas.height = 0; image.alpha.values = new Uint8Array(0); },
  });

  acquire(id: string) { return this.pool.acquire(id); }
  preload(ids: readonly string[]) { this.pool.preload(ids); }
  stats() { return this.pool.stats(); }

  private async loadImage(id: string, lifetime: AbortSignal): Promise<ImageResource> {
    return retryAsset(async attempt => {
      const signal = AbortSignal.any([lifetime, AbortSignal.timeout(45000)]);
      const blob = await fetchAssetImage(assetUrl(id, attempt < 2 ? 'game' : undefined), signal, attempt);
      const url = URL.createObjectURL(blob), image = new Image();
      const cancel = () => { image.src = ''; };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        signal.throwIfAborted(); image.src = url; await abortable(image.decode(), signal); signal.throwIfAborted();
        if (this.disposed) throw new DOMException('Проигрыватель закрыт', 'AbortError');
        const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Не удалось прочитать рисунок');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const values = new Uint8Array(canvas.width * canvas.height);
        for (let i = 0; i < values.length; i++) values[i] = pixels[i * 4 + 3];
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
        return { texture, alpha: { width: canvas.width, height: canvas.height, values }, aspect: image.naturalWidth / image.naturalHeight };
      } finally { signal.removeEventListener('abort', cancel); image.src = ''; URL.revokeObjectURL(url); }
    }, lifetime);
  }

  placeholder(number: number) {
    const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось создать заглушку предмета');
    context.fillStyle = '#d7cbbc'; context.fillRect(0, 0, 192, 256);
    context.strokeStyle = '#4a4940'; context.lineWidth = 5; context.strokeRect(8, 8, 176, 240);
    context.font = '48px Georgia'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = '#4a4940'; context.fillText(String(number), 96, 128);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
  tiled(texture: THREE.Texture, width: number, depth: number) {
    const copy = texture.clone(); copy.wrapS = copy.wrapT = THREE.RepeatWrapping; copy.repeat.set(Math.max(.1, width / 2), Math.max(.1, depth / 2)); copy.needsUpdate = true;
    return copy;
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.pool.dispose(); }
}
