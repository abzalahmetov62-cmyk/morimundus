export class AssetLoadError extends Error {
  constructor(message: string, readonly retryable = true) { super(message); }
}
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(signal.reason ?? new DOMException('Загрузка отменена', 'AbortError')); };
    if (signal.aborted) { cancel(); void promise.catch(() => {}); return; }
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(value => { signal.removeEventListener('abort', cancel); resolve(value); }, error => { signal.removeEventListener('abort', cancel); reject(error); });
  });
}
export async function retryAsset<T>(load: (attempt: number) => Promise<T>, signal: AbortSignal, delay = (attempt: number) => 500 * 3 ** attempt): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { return await load(attempt); }
    catch (error) {
      signal.throwIfAborted();
      if (attempt >= 2 || error instanceof AssetLoadError && !error.retryable) throw error;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await abortable(new Promise<void>(resolve => { timer = setTimeout(resolve, delay(attempt)); }), signal); }
      finally { clearTimeout(timer); }
    }
  }
}
export async function fetchAssetImage(url: string, signal: AbortSignal, attempt: number) {
  const response = await fetch(url, { signal, cache: attempt ? 'reload' : 'default' });
  if (!response.ok) throw new AssetLoadError('Рисунок недоступен (' + response.status + ')', [408, 425, 429].includes(response.status) || response.status >= 500);
  const blob = await response.blob(), length = response.headers.get('content-length');
  if (!blob.size || length !== null && !response.headers.has('content-encoding') && Number(length) !== blob.size) throw new AssetLoadError('Рисунок загружен не полностью');
  if (blob.type && !blob.type.startsWith('image/')) throw new AssetLoadError('Вместо рисунка получен другой файл', false);
  return blob;
}
export function retryImageUrl(src: string, attempt: number) {
  if (attempt >= 2 && src.startsWith('/api/assets/')) {
    const original = new URL(src, 'https://image.invalid'); original.searchParams.delete('variant');
    src = original.pathname + original.search + original.hash;
  }
  return src + (src.includes('?') ? '&' : '?') + 'image_retry=' + attempt;
}
export function recoverImage(image: HTMLImageElement, src: string, host: Window = window) {
  let attempt = 0, sequence = 0, failed = false, disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined, watchdog: ReturnType<typeof setTimeout> | undefined;
  const loaded = () => { failed = false; clearTimeout(timer); clearTimeout(watchdog); timer = watchdog = undefined; };
  const watch = () => { clearTimeout(watchdog); watchdog = setTimeout(failedLoad, 45000); };
  const failedLoad = () => {
    clearTimeout(watchdog); watchdog = undefined;
    if (disposed || timer !== undefined) return;
    failed = true;
    if (attempt >= 2) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!disposed) { attempt++; image.src = retryImageUrl(src, ++sequence); watch(); }
    }, 500 * 3 ** attempt);
  };
  const online = () => { if (failed && !disposed) { clearTimeout(timer); timer = undefined; attempt = 0; failedLoad(); } };
  image.addEventListener('load', loaded); image.addEventListener('error', failedLoad); host.addEventListener('online', online);
  if (!image.complete) watch();
  else if (image.naturalWidth === 0) failedLoad();
  return () => {
    disposed = true; clearTimeout(timer); clearTimeout(watchdog);
    image.removeEventListener('load', loaded); image.removeEventListener('error', failedLoad); host.removeEventListener('online', online);
  };
}
