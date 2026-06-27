const autoAriaLabelAttribute = 'data-nodel-auto-aria-label';

export function accessibleLabelText(host: HTMLElement, fallback = '') {
  return host.getAttribute('aria-label') ?? host.getAttribute('label') ?? fallback;
}

export function syncHostAccessibleLabel(host: HTMLElement, fallback = '') {
  const hasLabelledBy = host.hasAttribute('aria-labelledby');
  const hasExplicitAriaLabel = host.hasAttribute('aria-label') && host.getAttribute(autoAriaLabelAttribute) !== 'true';
  const label = host.getAttribute('label') ?? fallback;

  if (hasLabelledBy || hasExplicitAriaLabel) {
    if (host.getAttribute(autoAriaLabelAttribute) === 'true') {
      host.removeAttribute('aria-label');
      host.removeAttribute(autoAriaLabelAttribute);
    }
    return;
  }

  if (label) {
    host.setAttribute(autoAriaLabelAttribute, 'true');
    if (host.getAttribute('aria-label') !== label) {
      host.setAttribute('aria-label', label);
    }
  } else if (host.getAttribute(autoAriaLabelAttribute) === 'true') {
    host.removeAttribute('aria-label');
    host.removeAttribute(autoAriaLabelAttribute);
  }
}

export function syncInternalAccessibleLabel(host: HTMLElement, target: HTMLElement, fallback = '') {
  const labelledBy = host.getAttribute('aria-labelledby');
  if (labelledBy) {
    target.setAttribute('aria-labelledby', labelledBy);
    if (target.getAttribute(autoAriaLabelAttribute) === 'true') {
      target.removeAttribute('aria-label');
      target.removeAttribute(autoAriaLabelAttribute);
    }
    return;
  }

  target.removeAttribute('aria-labelledby');
  const label = accessibleLabelText(host, fallback);
  if (label) {
    target.setAttribute(autoAriaLabelAttribute, 'true');
    if (target.getAttribute('aria-label') !== label) {
      target.setAttribute('aria-label', label);
    }
  } else if (target.getAttribute(autoAriaLabelAttribute) === 'true') {
    target.removeAttribute('aria-label');
    target.removeAttribute(autoAriaLabelAttribute);
  }
}
