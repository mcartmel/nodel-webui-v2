import $ from 'jquery';
import { escapeHtml } from '../utils/html';

let bootstrapped = false;
let bootPromise: Promise<typeof $> | null = null;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

export async function linkTemplate(target: Element | string, template: string, data: unknown, helpersOrContext?: object) {
  const jq = await bootstrapJsViews();
  const compiled = jq.templates(template);
  const linkedTarget = typeof target === 'string' ? jq(target) : jq(target as HTMLElement);
  compiled.link(linkedTarget as JQuery<HTMLElement>, data, helpersOrContext);
  return linkedTarget;
}

export async function unlinkTemplate(target: Element | string) {
  const jq = await bootstrapJsViews();
  jq.unlink(typeof target === 'string' ? jq(target) : jq(target as HTMLElement));
}

export function getJQuery(): typeof $ {
  return $;
}
