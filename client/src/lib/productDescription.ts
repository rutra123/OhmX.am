const ALLOWED_TAGS = new Set([
  'a',
  'b',
  'br',
  'em',
  'i',
  'li',
  'ol',
  'p',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]);

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function stripHtmlFallback(value: string) {
  return normalizeWhitespace(
    String(value || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
  );
}

export function descriptionToPlainText(value: string, maxLength = 220) {
  if (!value) return '';
  let text = '';

  if (typeof window !== 'undefined' && typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(value, 'text/html');
    text = normalizeWhitespace(doc.body.textContent || '');
  } else {
    text = stripHtmlFallback(value);
  }

  if (!maxLength || text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

export function sanitizeDescriptionHtml(value: string) {
  if (!value) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return value;

  const doc = new DOMParser().parseFromString(value, 'text/html');
  const nodes = [...doc.body.querySelectorAll('*')];

  for (const node of nodes) {
    const tag = node.tagName.toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
      node.replaceWith(...Array.from(node.childNodes));
      continue;
    }

    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();

      if (tag === 'a' && (name === 'href' || name === 'target' || name === 'rel')) continue;
      node.removeAttribute(attr.name);
    }

    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      const safeHref = href.trim();
      if (!/^https?:\/\//i.test(safeHref) && !safeHref.startsWith('/')) {
        node.removeAttribute('href');
      } else if (!node.getAttribute('rel')) {
        node.setAttribute('rel', 'noreferrer');
      }
    }
  }

  return doc.body.innerHTML;
}
