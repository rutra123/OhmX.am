import { sanitizeDescriptionHtml } from '../lib/productDescription';

type RichTextBlockProps = {
  html: string;
  className?: string;
  fallback?: string;
};

export function RichTextBlock({ html, className = '', fallback = '' }: RichTextBlockProps) {
  const safeHtml = sanitizeDescriptionHtml(html);

  if (!safeHtml) {
    return fallback ? <div className={className}>{fallback}</div> : null;
  }

  return <div className={className} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
