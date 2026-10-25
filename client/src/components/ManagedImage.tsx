import { useEffect, useState } from 'react';
import { CategoryPlaceholder } from './CategoryPlaceholder';

const MIRRORED_PRODUCT_IMAGE_RE = /^\/storage\/images\/products\/(.+)\.(?:jpe?g|png|webp|gif)$/i;

// Mirrored product photos have 320px WebP thumbnails under /storage/images/thumbs (same relative path).
export function productThumbUrl(src?: string) {
  const match = String(src || '').match(MIRRORED_PRODUCT_IMAGE_RE);
  return match ? `/storage/images/thumbs/${match[1]}.webp` : '';
}

export function ManagedImage({
  src,
  alt,
  className,
  placeholderTitle,
  placeholderSubtitle,
  variant = 'category',
  thumb = false,
}: {
  src?: string;
  alt?: string;
  className?: string;
  placeholderTitle: string;
  placeholderSubtitle?: string;
  variant?: 'category' | 'product';
  /** Use the small WebP thumbnail when one exists (lists, cards); falls back to the original. */
  thumb?: boolean;
}) {
  const thumbSrc = thumb ? productThumbUrl(src) : '';
  // 0 = thumbnail (if any), 1 = original, 2 = placeholder
  const [stage, setStage] = useState(thumbSrc ? 0 : 1);

  useEffect(() => {
    setStage(thumbSrc ? 0 : 1);
  }, [src, thumbSrc]);

  if (!src || stage === 2) {
    return <CategoryPlaceholder title={placeholderTitle} subtitle={placeholderSubtitle} variant={variant} />;
  }

  return (
    <img
      src={stage === 0 ? thumbSrc : src}
      alt={alt || ''}
      className={className}
      onError={() => setStage((current) => current + 1)}
      loading="lazy"
      decoding="async"
    />
  );
}
