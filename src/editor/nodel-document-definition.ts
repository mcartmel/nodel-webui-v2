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
    snippet: '<nodel-toolbar icon-src="./v2/img/logo.png">\n  <nodel-theme-toggle></nodel-theme-toggle>\n</nodel-toolbar>'
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
      { name: 'tone', description: 'Text tone.', values: ['muted', 'default', 'accent', 'danger', 'success'] },
      { name: 'size', description: 'Text size.', values: ['xs', 'sm', 'md', 'lg'] },
      { name: 'surface', description: 'Optional surface style.', values: ['none', 'card'] }
    ],
    snippet: '<nodel-text surface="card">${}</nodel-text>'
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
      { name: 'alt', description: 'Image alt text.' }
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
    name: 'nodel-diagnostics',
    description: 'Host diagnostics table.',
    attributes: []
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
    name: 'nodel-editor',
    description: 'Node file editor using CodeMirror.',
    attributes: [
      { name: 'default-file', description: 'File path to open by default.' }
    ],
    snippet: '<nodel-editor default-file="script.py"></nodel-editor>'
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
  return (element?.attributes ?? []).map((attribute) => ({
    label: attribute.name,
    type: 'property',
    detail: attribute.description,
    apply: attribute.values?.length ? `${attribute.name}="${attribute.values[0]}"` : `${attribute.name}=""`
  }));
}

function valueCompletions(tagName: string, attributeName: string): Completion[] {
  const attribute = findNodelElement(tagName)?.attributes.find((item) => item.name === attributeName);
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
