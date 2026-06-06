import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';

export interface NodelAttributeDefinition {
  name: string;
  description: string;
  values?: string[];
}

export interface NodelElementDefinition {
  name: string;
  description: string;
  attributes: NodelAttributeDefinition[];
  snippet?: string;
}

const commonNodelAttributes: NodelAttributeDefinition[] = [
  {
    name: 'visibility',
    description: 'Local signal controlling component visibility. visible/true/1 shows; hidden/false/0 hides.'
  }
];

export const nodelDocumentElements: NodelElementDefinition[] = [
  {
    name: 'nodel-app',
    description: 'Top-level Nodel application shell.',
    attributes: [
      { name: 'title', description: 'Runtime page title.' },
      { name: 'theme', description: 'Theme selection.', values: ['default', 'light', 'dark'] }
    ],
    snippet: '<nodel-app title="Nodel">\n  ${}\n</nodel-app>'
  },
  {
    name: 'nodel-toolbar',
    description: 'Toolbar with generated navigation and actions slot.',
    attributes: [
      { name: 'title', description: 'Toolbar title override.' },
      { name: 'icon-src', description: 'Static toolbar icon URL.' },
      { name: 'icon-alt', description: 'Static toolbar icon alt text.' }
    ],
    snippet: '<nodel-toolbar icon-src="./v2/img/logo.png">\n  ${}\n</nodel-toolbar>'
  },
  {
    name: 'nodel-page',
    description: 'Selectable app page or nav group.',
    attributes: [
      { name: 'title', description: 'Page title used for heading/navigation.' },
      { name: 'nav-id', description: 'Stable explicit navigation id.' }
    ],
    snippet: '<nodel-page title="Page">\n  ${}\n</nodel-page>'
  },
  {
    name: 'nodel-row',
    description: 'Responsive layout row.',
    attributes: [],
    snippet: '<nodel-row>\n  <nodel-column>\n    ${}\n  </nodel-column>\n</nodel-row>'
  },
  {
    name: 'nodel-column',
    description: 'Responsive layout column.',
    attributes: [
      { name: 'span', description: 'Base 12-column span.' },
      { name: 'sm', description: 'Small breakpoint 12-column span.' },
      { name: 'md', description: 'Medium breakpoint 12-column span.' },
      { name: 'lg', description: 'Large breakpoint 12-column span.' }
    ],
    snippet: '<nodel-column md="6">\n  ${}\n</nodel-column>'
  },
  {
    name: 'nodel-control-grid',
    description: 'Equal-cell grid for touch controls.',
    attributes: [
      { name: 'columns', description: 'Base control column count.' },
      { name: 'sm', description: 'Small breakpoint control column count.' },
      { name: 'md', description: 'Medium breakpoint control column count.' },
      { name: 'lg', description: 'Large breakpoint control column count.' }
    ],
    snippet: '<nodel-control-grid columns="3">\n  ${}\n</nodel-control-grid>'
  },
  {
    name: 'nodel-control-space',
    description: 'Empty placeholder cell inside a nodel-control-grid.',
    attributes: [],
    snippet: '<nodel-control-space></nodel-control-space>'
  },
  {
    name: 'nodel-button',
    description: 'Touch-sized action or state button.',
    attributes: [
      { name: 'variant', description: 'Button visual variant.', values: ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost', 'link'] },
      { name: 'layout', description: 'Button child layout.', values: ['inline', 'stack'] },
      { name: 'action', description: 'Current-node action name to call on click.' },
      { name: 'arg', description: 'Optional action argument value.' },
      { name: 'arg-type', description: 'Parser for arg.', values: ['string', 'number', 'boolean', 'json'] },
      { name: 'disabled', description: 'Disable the button.' },
      { name: 'active', description: 'Mark the button active/pressed.' },
      { name: 'active-value', description: 'Optional active-state signal value when it differs from arg.' },
      { name: 'aria-label', description: 'Accessible label for icon-only or image-only buttons.' },
      { name: 'title', description: 'Native button title text.' },
      { name: 'signal', description: 'Signal binding in SignalName:target format, or shorthand signal name for active.' },
      { name: 'signals', description: 'Signal bindings in SignalName:target format. Supported targets: active, label, disabled.' }
    ],
    snippet: '<nodel-button action="ActionName">${}</nodel-button>'
  },
  {
    name: 'nodel-image',
    description: 'Standalone or inline control image.',
    attributes: [
      { name: 'src', description: 'Image URL.' },
      { name: 'alt', description: 'Alternative text.' },
      { name: 'label', description: 'Optional visible label.' },
      { name: 'fit', description: 'Image fit mode.', values: ['contain', 'cover'] },
      { name: 'shape', description: 'Image shape.', values: ['none', 'rounded', 'circle'] },
      { name: 'size', description: 'Image size.', values: ['auto', 'sm', 'md', 'lg', 'xl'] },
      { name: 'variant', description: 'Standalone media treatment.', values: ['plain', 'soft', 'bordered'] },
      { name: 'signal', description: 'Signal binding in SignalName:target format, or shorthand signal name for src.' },
      { name: 'signals', description: 'Signal bindings in SignalName:target format. Supported targets: src, alt, label.' }
    ],
    snippet: '<nodel-image src="${}" alt=""></nodel-image>'
  },
  {
    name: 'nodel-icon',
    description: 'Standalone or inline control icon.',
    attributes: [
      { name: 'name', description: 'Built-in icon name.' },
      { name: 'label', description: 'Optional visible/accessible label.' },
      { name: 'alt', description: 'Accessible label without visible text.' },
      { name: 'tone', description: 'Icon tone.', values: ['default', 'muted', 'accent', 'success', 'info', 'warning', 'danger'] },
      { name: 'size', description: 'Icon size.', values: ['auto', 'sm', 'md', 'lg', 'xl'] },
      { name: 'variant', description: 'Standalone media treatment.', values: ['plain', 'soft', 'bordered'] },
      { name: 'signal', description: 'Signal binding in SignalName:target format, or shorthand signal name for name.' },
      { name: 'signals', description: 'Signal bindings in SignalName:target format. Supported targets: name, alt, label, tone.' }
    ],
    snippet: '<nodel-icon name="power"></nodel-icon>'
  },
  {
    name: 'nodel-status-indicator',
    description: 'Small signal-driven status indicator for control children.',
    attributes: [
      { name: 'signal', description: 'Signal binding in SignalName:target format, or shorthand signal name for value.' },
      { name: 'signals', description: 'Signal bindings in SignalName:target format. Supported targets: value, label.' },
      { name: 'value', description: 'Current indicator value.' },
      { name: 'on-value', description: 'Exact value that means on.' },
      { name: 'off-value', description: 'Exact value that means off.' },
      { name: 'tone', description: 'On-state tone.', values: ['success', 'info', 'warning', 'danger'] },
      { name: 'off-tone', description: 'Off-state tone.', values: ['off', 'muted'] },
      { name: 'label', description: 'Accessible status label.' }
    ],
    snippet: '<nodel-status-indicator signal="${}" label="Status"></nodel-status-indicator>'
  },
  {
    name: 'nodel-collapse',
    description: 'Collapsible section, closed by default.',
    attributes: [
      { name: 'label', description: 'Visible section label.' },
      { name: 'preview', description: 'Fallback preview text shown while collapsed.' },
      { name: 'open', description: 'Start expanded.' }
    ],
    snippet: '<nodel-collapse label="Section">\n  ${}\n</nodel-collapse>'
  },
  {
    name: 'nodel-description',
    description: 'Current node description rendered as markdown with a collapsed preview.',
    attributes: [
      { name: 'collapsed-height', description: 'Collapsed preview height, e.g. 8rem or 160px.' },
      { name: 'open', description: 'Start expanded.' }
    ],
    snippet: '<nodel-description></nodel-description>'
  },
  {
    name: 'nodel-text',
    description: 'Theme-aware text block.',
    attributes: [
      { name: 'tone', description: 'Text tone.', values: ['muted', 'default', 'accent', 'success', 'info', 'warning', 'danger'] },
      { name: 'size', description: 'Text size.', values: ['xs', 'sm', 'md', 'lg', 'xl'] },
      { name: 'surface', description: 'Optional surface style.', values: ['none', 'card'] },
      { name: 'signal', description: 'Signal binding in SignalName:target format, or shorthand signal name for value.' },
      { name: 'signals', description: 'Signal bindings in SignalName:target format. Use target value for text content.' }
    ],
    snippet: '<nodel-text surface="card">${}</nodel-text>'
  },
  {
    name: 'nodel-title',
    description: 'Theme-aware visible title or section heading.',
    attributes: [
      { name: 'level', description: 'Heading level.', values: ['1', '2', '3'] },
      { name: 'tone', description: 'Title tone.', values: ['default', 'muted', 'accent'] },
      { name: 'signal', description: 'Signal binding in SignalName:target format, or shorthand signal name for value.' },
      { name: 'signals', description: 'Signal bindings in SignalName:target format. Use target value for title content.' }
    ],
    snippet: '<nodel-title level="1">${}</nodel-title>'
  },
  {
    name: 'nodel-theme-toggle',
    description: 'Theme toggle button for the nearest nodel-app.',
    attributes: []
  },
  {
    name: 'nodel-host-icon',
    description: 'Generated host identicon.',
    attributes: [
      { name: 'host', description: 'Displayed/semantic host.' },
      { name: 'icon-host', description: 'Host used to generate the identicon.' },
      { name: 'href', description: 'Optional link target.' },
      { name: 'title', description: 'Title text.' },
      { name: 'alt', description: 'Image alt text.' },
      { name: 'signal', description: 'Signal binding in SignalName:target format, or shorthand signal name for host.' },
      { name: 'signals', description: 'Signal bindings in SignalName:target format. Supported targets: host, icon-host, href, title, alt.' }
    ]
  },
  {
    name: 'nodel-node-list',
    description: 'Local or network node list.',
    attributes: [
      { name: 'scope', description: 'Node list scope.', values: ['local', 'network'] },
      { name: 'poll-interval', description: 'Polling interval in milliseconds.' },
      { name: 'page-size', description: 'Initial number of visible rows.' },
      { name: 'show-filter', description: 'Show filter control.', values: ['true', 'false'] },
      { name: 'show-total', description: 'Show total count.', values: ['true', 'false'] }
    ],
    snippet: '<nodel-node-list scope="local"></nodel-node-list>'
  },
  {
    name: 'nodel-add-node',
    description: 'Create or duplicate a node.',
    attributes: [
      { name: 'redirect', description: 'Redirect after creating node.', values: ['true', 'false'] },
      { name: 'recipes', description: 'Enable recipe selection.', values: ['true', 'false'] },
      { name: 'duplicate', description: 'Enable duplicate-from-existing-node.', values: ['true', 'false'] }
    ],
    snippet: '<nodel-add-node redirect="false"></nodel-add-node>'
  },
  {
    name: 'nodel-node-menu',
    description: 'Current-node drawer menu for theme, rename, restart, delete, custom UIs, and reference links.',
    attributes: [],
    snippet: '<nodel-node-menu></nodel-node-menu>'
  },
  {
    name: 'nodel-diagnostics',
    description: 'Host diagnostics table.',
    attributes: []
  },
  {
    name: 'nodel-host-log',
    description: 'Host/server log viewer.',
    attributes: [],
    snippet: '<nodel-host-log></nodel-host-log>'
  },
  {
    name: 'nodel-diagnostic-charts',
    description: 'Host diagnostics measurement charts.',
    attributes: [],
    snippet: '<nodel-diagnostic-charts></nodel-diagnostic-charts>'
  },
  {
    name: 'nodel-toolkit',
    description: 'Host scripting toolkit reference.',
    attributes: [],
    snippet: '<nodel-toolkit></nodel-toolkit>'
  },
  {
    name: 'nodel-console',
    description: 'Node console history and command prompt.',
    attributes: [
      { name: 'collapse-preview', description: 'Emit preview updates for a parent nodel-collapse.', values: ['last-line'] }
    ]
  },
  {
    name: 'nodel-log',
    description: 'Node activity log with hold, filter, and limits.',
    attributes: []
  },
  {
    name: 'nodel-actsig',
    description: 'Schema-driven current-node actions and signals UI.',
    attributes: [],
    snippet: '<nodel-actsig></nodel-actsig>'
  },
  {
    name: 'nodel-params',
    description: 'Schema-driven current-node parameters form.',
    attributes: [],
    snippet: '<nodel-params></nodel-params>'
  },
  {
    name: 'nodel-bindings',
    description: 'Current-node remote binding workbench.',
    attributes: [],
    snippet: '<nodel-bindings></nodel-bindings>'
  },
  {
    name: 'nodel-editor',
    description: 'Node file editor using CodeMirror.',
    attributes: [
      { name: 'default-file', description: 'File path to open by default.' }
    ],
    snippet: '<nodel-editor default-file="script.py"></nodel-editor>'
  },
  {
    name: 'nodel-toast-host',
    description: 'App-level toast notification host.',
    attributes: []
  }
];

export const nodelDocumentSnippets: Completion[] = [
  {
    label: 'nodel-page scaffold',
    type: 'text',
    apply: '<nodel-page title="Page">\n  <nodel-row>\n    <nodel-column>\n      ${}\n    </nodel-column>\n  </nodel-row>\n</nodel-page>',
    detail: 'Nodel page with row and column'
  },
  {
    label: 'nodel custom page head',
    type: 'text',
    apply: '<link rel="stylesheet" href="./v2/nodel-webui.css" />\n<script type="module" src="./v2/nodel-webui.js"></script>',
    detail: 'Stable v2 asset references'
  }
];

export function findNodelElement(name: string) {
  return nodelDocumentElements.find((element) => element.name === name);
}

function elementCompletions(): Completion[] {
  return nodelDocumentElements.map((element) => ({
    label: element.name,
    type: 'class',
    detail: element.description,
    apply: element.snippet ?? `<${element.name}></${element.name}>`
  }));
}

function attributeCompletions(tagName: string): Completion[] {
  const element = findNodelElement(tagName);
  const attributes = tagName.startsWith('nodel-')
    ? [...(element?.attributes ?? []), ...commonNodelAttributes.filter((common) => !element?.attributes.some((attribute) => attribute.name === common.name))]
    : (element?.attributes ?? []);

  return attributes.map((attribute) => ({
    label: attribute.name,
    type: 'property',
    detail: attribute.description,
    apply: attribute.values?.length ? `${attribute.name}="${attribute.values[0]}"` : `${attribute.name}=""`
  }));
}

function valueCompletions(tagName: string, attributeName: string): Completion[] {
  const element = findNodelElement(tagName);
  const attribute = element?.attributes.find((item) => item.name === attributeName)
    ?? (tagName.startsWith('nodel-') ? commonNodelAttributes.find((item) => item.name === attributeName) : undefined);

  return (attribute?.values ?? []).map((value) => ({
    label: value,
    type: 'constant',
    apply: value
  }));
}

export function completeNodelDocument(context: CompletionContext): CompletionResult | null {
  const before = context.state.sliceDoc(Math.max(0, context.pos - 160), context.pos);
  const tagName = before.match(/<\/?([a-z][\w-]*)[^<>]*$/i)?.[1] ?? '';
  const attributeValue = before.match(/<([a-z][\w-]*)[^<>]*\s([a-z][\w-]*)="[^"]*$/i);

  if (attributeValue) {
    return {
      from: context.pos,
      options: valueCompletions(attributeValue[1], attributeValue[2])
    };
  }

  if (tagName && before.includes('<') && !before.endsWith('</')) {
    const word = context.matchBefore(/[\w-]*$/);
    return {
      from: word?.from ?? context.pos,
      options: attributeCompletions(tagName)
    };
  }

  const tag = context.matchBefore(/<\/?[\w-]*$/);
  if (tag) {
    const slashOffset = tag.text.startsWith('</') ? 2 : 1;
    return {
      from: tag.from + slashOffset,
      options: elementCompletions()
    };
  }

  const word = context.matchBefore(/[\w-]*$/);
  if (context.explicit && word) {
    return {
      from: word.from,
      options: [...elementCompletions(), ...nodelDocumentSnippets]
    };
  }

  return null;
}
