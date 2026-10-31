'use client';
import { useEffect, useRef, useState } from 'react';
import type { Asset } from '../engine/project';
import { optimizationCandidate } from '../storage/image-optimization';
import { emptyImagePreparation, prepareGameImages } from './image-preparation';

export function useImageOptimization(assets: readonly Asset[] | undefined, paused: boolean) {
  const latest = useRef(assets); latest.current = assets;
  const signature = (assets ?? []).filter(optimizationCandidate).map(asset => asset.id + ':' + asset.sha256).sort().join('|');
  const [progress, setProgress] = useState(emptyImagePreparation), [retry, setRetry] = useState(0);
  useEffect(() => {
    const online = () => setRetry(value => value + 1); window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, []);
  useEffect(() => {
    if (paused || !signature) { setProgress(emptyImagePreparation); return; }
    const lifetime = new AbortController();
    // Yield the initial connection to the editor; prepare only one image at a time.
    const timer = setTimeout(() => { void prepareGameImages(latest.current ?? [], lifetime.signal, setProgress); }, 1500);
    return () => { clearTimeout(timer); lifetime.abort(); };
  }, [signature, paused, retry]);
  return progress;
}
