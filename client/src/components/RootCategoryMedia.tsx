import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

type RootCategoryMediaProps = {
  imageUrl?: string | null;
  alt?: string;
  fallback: ReactNode;
};

export function RootCategoryMedia({ imageUrl, alt = '', fallback }: RootCategoryMediaProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  return (
    <div className="root-category-media">
      {imageUrl && !failed ? (
        <img
          src={imageUrl}
          alt={alt}
          className="root-category-media__image"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="root-category-media__fallback" aria-hidden={alt ? undefined : true}>
          {fallback}
        </div>
      )}
    </div>
  );
}
