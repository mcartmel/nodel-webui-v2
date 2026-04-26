import $ from 'jquery';

let bootstrapped = false;
let bootPromise: Promise<typeof $> | null = null;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function registerJsViewsHelpers() {
  $.views.helpers({
    highlight(value: string, filter: string) {
      const safeValue = escapeHtml(String(value ?? ''));
      const safeFilter = String(filter ?? '').trim();
      if (!safeFilter) {
        return safeValue;
      }

      const regex = new RegExp(`(${escapeRegex(safeFilter)})`, 'ig');
      return safeValue.replace(regex, '<strong>$1</strong>');
    }
  });
}

export async function bootstrapJsViews(): Promise<typeof $> {
  if (bootstrapped) {
    return $;
  }

  if (!bootPromise) {
    bootPromise = (async () => {
      window.$ = $;
      window.jQuery = $;
      await import('jsviews');
      registerJsViewsHelpers();
      bootstrapped = true;
      return $;
    })();
  }

  return bootPromise;
}

export async function linkTemplate(target: Element | string, template: string, data: unknown) {
  const jq = await bootstrapJsViews();
  const compiled = jq.templates(template);
  const linkedTarget = typeof target === 'string' ? jq(target) : jq(target as HTMLElement);
  compiled.link(linkedTarget as JQuery<HTMLElement>, data);
  return linkedTarget;
}

export async function unlinkTemplate(target: Element | string) {
  const jq = await bootstrapJsViews();
  jq.unlink(typeof target === 'string' ? jq(target) : jq(target as HTMLElement));
}

export function getJQuery(): typeof $ {
  return $;
}
