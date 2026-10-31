import type { Asset } from '../engine/project';
import { assetUrl, responseData } from '../storage/client';
import { optimizationCandidate } from '../storage/image-optimization';
import { ImageEncoderUnavailable, optimizeImage } from './optimize-image';

export type ImagePreparation = { done: number; total: number; failed: number; running: boolean; unavailable: boolean };
export const emptyImagePreparation: ImagePreparation = { done: 0, total: 0, failed: 0, running: false, unavailable: false };
export async function prepareGameImages(assets: readonly Asset[], lifetime: AbortSignal, onProgress: (value: ImagePreparation) => void, encode = optimizeImage) {
  const targets = [...new Map(assets.filter(optimizationCandidate).map(asset => [asset.sha256, asset])).values()];
  let done = 0, failed = 0;
  const report = (running: boolean, unavailable = false) => { if (!lifetime.aborted) onProgress({ done, total: targets.length, failed, running, unavailable }); };
  report(true);
  try {
    const signal = AbortSignal.any([lifetime, AbortSignal.timeout(15000)]);
    const data = await responseData(await fetch('/api/assets/optimization', { signal, cache: 'no-store' })) as { completed?: unknown };
    if (!Array.isArray(data.completed) || data.completed.some(value => typeof value !== 'string')) throw new Error('Не удалось проверить подготовленные изображения');
    const completed = new Set(data.completed);
    done = targets.filter(asset => completed.has(asset.sha256)).length; report(true);
    for (const asset of targets) {
      lifetime.throwIfAborted(); if (completed.has(asset.sha256)) continue;
      try {
        const signal = AbortSignal.any([lifetime, AbortSignal.timeout(60000)]);
        const response = await fetch(assetUrl(asset.id), { signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Не удалось получить оригинал');
        const blob = await response.blob();
        if (blob.size !== asset.bytes) throw new Error('Оригинал загружен не полностью');
        const optimized = await encode(blob, signal);
        await responseData(await fetch(assetUrl(asset.id) + '/optimized', {
          method: 'PUT', headers: { 'Content-Type': optimized ? 'image/webp' : 'application/json' }, body: optimized ?? '{"skip":true}', signal,
        }), 'Не удалось сохранить облегчённую копию');
        done++;
      } catch (error) {
        if (lifetime.aborted) return;
        if (error instanceof ImageEncoderUnavailable) { report(false, true); return; }
        failed++; console.warn('Image optimization postponed', asset.id, error instanceof Error ? error.message : 'unknown error');
      }
      report(true);
    }
    report(false);
  } catch { if (!lifetime.aborted) { failed = targets.length - done; report(false); } }
}
