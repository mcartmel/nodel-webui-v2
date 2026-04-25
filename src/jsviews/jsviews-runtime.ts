import $ from 'jquery';

let bootstrapped = false;
let bootPromise: Promise<typeof $> | null = null;

export async function bootstrapJsViews(): Promise<typeof $> {
  if (bootstrapped) {
    return $;
  }

  if (!bootPromise) {
    bootPromise = (async () => {
      window.$ = $;
      window.jQuery = $;
      await import('jsviews');
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

export function getJQuery(): typeof $ {
  return $;
}
