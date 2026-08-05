import type { NodelAttributeDefinition, NodelElementDefinition } from '../nodel-component-metadata';
import {
  findNodelElement,
  getEffectiveCatalogueAttributes,
  nodelDocumentElements
} from '../nodel-component-metadata';
import '../components/nodel-collapse';

const commonAttributeNames = new Set(['signals', 'visibility', 'visible-value', 'visible-values']);

export interface CatalogueReferenceOptions {
  root?: ParentNode;
  strict?: boolean;
  /** Restrict missing-marker validation to this subset (useful for focused tests). */
  requiredElements?: Iterable<string>;
}

export interface CatalogueReferenceIssue {
  code: 'unknown' | 'non-catalogue' | 'duplicate' | 'missing';
  element: string;
  message: string;
}

export class CatalogueReferenceError extends Error {
  readonly issues: CatalogueReferenceIssue[];

  constructor(issues: CatalogueReferenceIssue[]) {
    super(issues.map((issue) => issue.message).join('\n'));
    this.name = 'CatalogueReferenceError';
    this.issues = issues;
  }
}

function code(text: string): HTMLElement {
  const node = document.createElement('code');
  node.textContent = text;
  return node;
}

function appendLabel(cell: HTMLElement, name: string, attribute: NodelAttributeDefinition) {
  cell.append(code(name));
  if (attribute.common || commonAttributeNames.has(name)) {
    const badge = document.createElement('span');
    badge.className = 'nodel-catalogue-reference-badge';
    badge.dataset.catalogueReferenceBadge = 'common';
    badge.textContent = 'common';
    badge.setAttribute('aria-label', 'Common attribute');
    cell.append(' ', badge);
  }
}

function appendAcceptedValue(cell: HTMLElement, attribute: NodelAttributeDefinition) {
  if (attribute.values?.length) {
    attribute.values.forEach((value, index) => {
      if (index) cell.append(', ');
      cell.append(code(value));
    });
    if (attribute.valueType === 'enum-or-string') {
      cell.append(', or ', code(attribute.syntax ?? 'string'));
    }
    return;
  }

  if (attribute.valueType === 'boolean') {
    cell.append(code('present'), ' or ', code('omitted'));
    return;
  }

  if (attribute.valueType === 'presence-or-text') {
    cell.append(code('present'), ', ', code('"text"'), ', or ', code('omitted'));
    return;
  }

  if (attribute.numeric || attribute.valueType === 'number' || attribute.valueType === 'integer') {
    const type = attribute.valueType === 'integer' || attribute.numeric?.integer ? 'integer' : 'number';
    cell.append(attribute.syntax ? code(attribute.syntax) : document.createTextNode(`Finite ${type}`));
    const numeric = attribute.numeric;
    if (numeric) {
      const bounds: string[] = [];
      const unit = numeric.unit ? ` ${numeric.unit}` : '';
      if (numeric.min !== undefined) bounds.push(`${numeric.exclusiveMin ? '>' : '>='} ${numeric.min}${unit}`);
      if (numeric.max !== undefined) bounds.push(`<= ${numeric.max}${unit}`);
      if (bounds.length && !numeric.clamp) cell.append(` (${bounds.join(' and ')})`);
      if (numeric.normalizesToInteger) cell.append('; normalizes to integer');
      if (bounds.length && numeric.clamp) cell.append(`; normalized to ${bounds.join(' and ')}`);
    }
    return;
  }

  const syntax = attribute.syntax ?? (attribute.valueType === 'binding'
    ? 'SignalName[.path]:target'
    : attribute.valueType === 'template-data' ? 'data-name="value"' : undefined);
  cell.append(code(syntax ?? 'string'));
}

function appendDefault(cell: HTMLElement, attribute: NodelAttributeDefinition) {
  if (attribute.defaultValue !== undefined) {
    cell.append(code(attribute.defaultValue));
  } else if (attribute.defaultDescription) {
    cell.textContent = attribute.defaultDescription;
  } else {
    cell.textContent = 'Not set';
  }
}

function makeTable(element: NodelElementDefinition): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'nodel-catalogue-reference-table';
  table.dataset.catalogueReferenceTable = element.name;

  const caption = document.createElement('caption');
  caption.textContent = `${element.name} attributes`;
  table.append(caption);

  const head = document.createElement('thead');
  const headingRow = document.createElement('tr');
  for (const heading of ['Attribute', 'Accepted value', 'Default', 'Description']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = heading;
    headingRow.append(th);
  }
  head.append(headingRow);
  table.append(head);

  const body = document.createElement('tbody');
  const seen = new Set<string>();
  for (const attribute of getEffectiveCatalogueAttributes(element)) {
    if (seen.has(attribute.name)) continue;
    seen.add(attribute.name);
    const row = document.createElement('tr');
    row.dataset.catalogueReferenceRow = attribute.name;

    const name = document.createElement('th');
    name.scope = 'row';
    name.dataset.catalogueReferenceAttribute = attribute.name;
    appendLabel(name, attribute.name, attribute);
    row.append(name);

    const accepted = document.createElement('td');
    appendAcceptedValue(accepted, attribute);
    row.append(accepted);

    const defaultCell = document.createElement('td');
    appendDefault(defaultCell, attribute);
    row.append(defaultCell);

    const description = document.createElement('td');
    description.className = 'nodel-catalogue-reference-description';
    description.textContent = attribute.description;
    if (attribute.legacy) {
      const legacy = document.createElement('span');
      legacy.className = 'nodel-catalogue-reference-legacy';
      legacy.textContent = `Legacy: ${attribute.legacy}`;
      description.append(' ', legacy);
    }
    row.append(description);
    body.append(row);
  }
  table.append(body);
  return table;
}

function makeReference(element: NodelElementDefinition): HTMLElement {
  const collapse = document.createElement('nodel-collapse');
  collapse.setAttribute('label', `${element.name} attributes`);
  const count = getEffectiveCatalogueAttributes(element).length;
  collapse.setAttribute('preview', `${count} attribute${count === 1 ? '' : 's'}`);
  collapse.dataset.catalogueReferenceFor = element.name;

  const wrapper = document.createElement('div');
  wrapper.className = 'nodel-catalogue-reference-table-scroll';
  wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'region');
  wrapper.setAttribute('aria-label', `${element.name} attribute table`);
  wrapper.append(makeTable(element));
  collapse.append(wrapper);
  return collapse;
}

function makeIssueAlert(issue: CatalogueReferenceIssue): HTMLElement {
  const alert = document.createElement('div');
  alert.className = 'nodel-alert nodel-alert-danger nodel-catalogue-reference-error';
  alert.setAttribute('role', 'alert');
  alert.dataset.catalogueReferenceError = issue.code;
  alert.textContent = issue.message;
  return alert;
}

function markerElements(root: ParentNode): HTMLElement[] {
  const markers: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches('[data-catalogue-reference]')) markers.push(root);
  markers.push(...Array.from(root.querySelectorAll<HTMLElement>('[data-catalogue-reference]')));
  return markers;
}

function requiredNames(options: CatalogueReferenceOptions): string[] {
  return Array.from(options.requiredElements ?? nodelDocumentElements.filter((element) => element.catalogue).map((element) => element.name))
    .sort();
}

export function renderCatalogueReferences(options: CatalogueReferenceOptions = {}): CatalogueReferenceIssue[] {
  if (typeof document === 'undefined') return [];
  const root = options.root ?? document;
  const markers = markerElements(root);
  const issues: CatalogueReferenceIssue[] = [];
  const values = markers.map((marker) => (marker.getAttribute('data-catalogue-reference') ?? '').trim());
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));

  markers.forEach((marker, index) => {
    const name = values[index];
    const element = findNodelElement(name);
    let issue: CatalogueReferenceIssue | undefined;
    if (!name || !element) {
      issue = { code: 'unknown', element: name, message: `Catalogue reference is unknown: ${name || '(empty)'}.` };
    } else if (!element.catalogue) {
      issue = { code: 'non-catalogue', element: name, message: `Catalogue reference is not catalogue-enabled: ${name}.` };
    } else if ((counts.get(name) ?? 0) > 1) {
      issue = { code: 'duplicate', element: name, message: `Catalogue reference is duplicated: ${name}.` };
    }

    if (issue) {
      issues.push(issue);
      marker.replaceWith(makeIssueAlert(issue));
    } else {
      marker.replaceWith(makeReference(element!));
    }
  });

  if (options.strict || options.requiredElements !== undefined) {
    const renderedNames = new Set(values.filter((name) => findNodelElement(name)?.catalogue));
    for (const name of requiredNames(options)) {
      if (!renderedNames.has(name)) {
        const issue: CatalogueReferenceIssue = { code: 'missing', element: name, message: `Catalogue reference marker is missing: ${name}.` };
        issues.push(issue);
        const parent = root instanceof Document ? root.body : root;
        parent?.append(makeIssueAlert(issue));
      }
    }
  }

  issues.sort((a, b) => `${a.code}:${a.element}`.localeCompare(`${b.code}:${b.element}`));
  if (options.strict && issues.length) throw new CatalogueReferenceError(issues);
  return issues;
}

if (typeof document !== 'undefined') {
  renderCatalogueReferences();
}
