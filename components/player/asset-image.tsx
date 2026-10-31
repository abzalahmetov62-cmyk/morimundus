'use client';
import { useEffect, useRef, type ComponentProps } from 'react';
import { recoverImage } from '@/lib/player/asset-loading';

export function AssetImage({ src, ...props }: Omit<ComponentProps<'img'>, 'ref' | 'src'> & { src: string }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => { if (image.current) return recoverImage(image.current, src); }, [src]);
  return <img {...props} ref={image} src={src} />;
}
