import { Converter } from 'pagedown';

const converter = new Converter();

const allowedTags = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'del',
  'dd',
  'dl',
  'dt',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'kbd',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'strike',
  'sub',
  'sup',
  'ul'
]);

const allowedAttributes = new Map<string, Set<string>>([
  ['a', new Set(['href', 'title', 'target', 'rel'])],
  ['code', new Set(['class'])],
  ['span', new Set(['class'])]
]);

const removedTags = new Set(['iframe', 'object', 'script', 'style']);

function isSafeUrl(value: string) {
  const trimmed = value.trim().toLowerCase();
  return Boolean(trimmed) && !trimmed.startsWith('javascript:') && !trimmed.startsWith('data:') && !trimmed.startsWith('vbscript:');
}

function sanitizeElement(element: Element) {
  const tagName = element.tagName.toLowerCase();

  if (removedTags.has(tagName)) {
    element.remove();
    return;
  }

  if (!allowedTags.has(tagName)) {
    element.replaceWith(...Array.from(element.childNodes));
    return;
  }

  const allowed = allowedAttributes.get(tagName) ?? new Set<string>();
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value;

    if (name.startsWith('on') || !allowed.has(name)) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if ((name === 'href' || name === 'src') && !isSafeUrl(value)) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (name === 'target' && value !== '_blank') {
      element.removeAttribute(attribute.name);
    }
  }

  if (tagName === 'a' && element.getAttribute('target') === '_blank') {
    element.setAttribute('rel', 'noopener noreferrer');
  }
}

export function sanitizeHtml(html: string) {
  const template = document.createElement('template');
  template.innerHTML = html;

  for (const element of Array.from(template.content.querySelectorAll('*'))) {
    sanitizeElement(element);
  }

  return template.innerHTML;
}

export function renderMarkdown(markdown: string) {
  return sanitizeHtml(converter.makeHtml(markdown));
}
