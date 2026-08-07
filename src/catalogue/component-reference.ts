import {
  componentContractCommonAttributes,
  componentContracts,
  findComponentContract
} from '../component-contract';
import type { ComponentAttributeContract, ComponentContract } from '../component-contract';
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

function appendBadge(cell: HTMLElement, kind: string, text: string, label: string, classification = false): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'nodel-catalogue-reference-badge';
  if (kind === 'common') badge.dataset.catalogueReferenceBadge = kind;
  else badge.dataset.catalogueReferenceMetadata = kind;
  if (classification) badge.dataset.catalogueReferenceClassification = kind;
  badge.textContent = text;
  badge.setAttribute('aria-label', label);
  badge.title = label;
  cell.append(' ', badge);
  return badge;
}

function appendLabel(cell: HTMLElement, name: string, attribute: ComponentAttributeContract) {
  cell.append(code(name));
  if (attribute.common || commonAttributeNames.has(name)) {
    appendBadge(cell, 'common', 'common', 'Common attribute');
  }
  const consumptionBadge = appendBadge(cell, 'consumption', attribute.consumption, `Consumption: ${attribute.consumption}${attribute.consumer ? `; consumer: ${attribute.consumer}` : ''}`);
  consumptionBadge.dataset.catalogueReferenceConsumption = attribute.consumption;
  const completionBadge = appendBadge(cell, 'completion', attribute.completion, `Attribute completion: ${attribute.completion}`);
  completionBadge.dataset.catalogueReferenceCompletion = attribute.completion;
  const lifecycleBadge = appendBadge(cell, 'lifecycle', attribute.lifecycle, `Attribute lifecycle: ${attribute.lifecycle}`);
  lifecycleBadge.dataset.catalogueReferenceLifecycle = attribute.lifecycle;
}

function appendAcceptedValue(cell: HTMLElement, attribute: ComponentAttributeContract) {
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

function appendDefault(cell: HTMLElement, attribute: ComponentAttributeContract) {
  if (attribute.defaultValue !== undefined) {
    cell.append(code(attribute.defaultValue));
  } else if (attribute.defaultDescription) {
    cell.textContent = attribute.defaultDescription;
  } else {
    cell.textContent = 'Not set';
  }
}

function effectiveAttributes(element: ComponentContract): ComponentAttributeContract[] {
  const attributes = [...element.attributes];
  const seen = new Set(attributes.map((attribute) => attribute.name));
  for (const attribute of componentContractCommonAttributes) {
    if (attribute.name === 'signals' && seen.has(attribute.name)) {
      const index = attributes.findIndex((candidate) => candidate.name === attribute.name);
      const existing = attributes[index];
      if (!existing.description.includes(attribute.description)) {
        attributes[index] = {
          ...existing,
          description: `${existing.description} ${attribute.description}`,
          syntax: [existing.syntax, attribute.syntax].filter(Boolean).join('; '),
          common: true
        };
      }
    } else if (!seen.has(attribute.name)) {
      attributes.push(attribute);
      seen.add(attribute.name);
    }
  }
  return attributes;
}

function makeClassificationSummary(element: ComponentContract): HTMLElement {
  const summary = document.createElement('div');
  summary.className = 'nodel-catalogue-reference-classifications';
  summary.setAttribute('aria-label', `${element.name} classifications`);
  for (const [kind, value] of [['audience', element.audience], ['registration', element.registration], ['completion', element.completion]] as const) {
    appendBadge(summary, kind, value, `Element ${kind}: ${value}`, true);
  }
  return summary;
}

function appendSummaryHeading(parent: HTMLElement, text: string) {
  const heading = document.createElement('h4');
  heading.className = 'nodel-section-heading';
  heading.textContent = text;
  parent.append(heading);
}

function makeStructuredSummaries(element: ComponentContract): HTMLElement | undefined {
  const summaries = document.createElement('div');
  summaries.className = 'nodel-catalogue-reference-summaries';

  if (element.actionBindings.length) {
    const section = document.createElement('section');
    section.dataset.catalogueReferenceActions = '';
    appendSummaryHeading(section, 'Action bindings');
    const list = document.createElement('ul');
    for (const binding of element.actionBindings) {
      const item = document.createElement('li');
      item.dataset.catalogueReferenceActionBinding = binding.attribute;
      item.append(code(binding.attribute));
      if (binding.phases.length) {
        item.append(': ');
        binding.phases.forEach((phase, index) => {
          if (index) item.append(', ');
          appendBadge(item, 'action-phase', phase, `Action phase: ${phase}`);
        });
      }
      if (binding.defaultPhase) appendBadge(item, 'action-default-phase', `default: ${binding.defaultPhase}`, `Default action phase: ${binding.defaultPhase}`);
      list.append(item);
    }
    section.append(list);
    summaries.append(section);
  }

  if (element.signalBindings.length) {
    const section = document.createElement('section');
    section.dataset.catalogueReferenceSignals = '';
    appendSummaryHeading(section, 'Signal bindings');
    const list = document.createElement('ul');
    for (const binding of element.signalBindings) {
      const item = document.createElement('li');
      item.dataset.catalogueReferenceSignalBinding = binding.attribute;
      item.append(code(binding.attribute));
      if (binding.defaultTarget) appendBadge(item, 'signal-default', `default: ${binding.defaultTarget}`, `Default signal target: ${binding.defaultTarget}`);
      if (binding.targets.length) {
        const targets = document.createElement('span');
        targets.dataset.catalogueReferenceSignalTargets = '';
        targets.append(' targets: ');
        binding.targets.forEach((target, index) => {
          if (index) targets.append(', ');
          const text = target.aggregations.length ? `${target.name} (${target.aggregations.join('/')})` : target.name;
          appendBadge(targets, 'signal-target', text, `Signal target: ${target.name}${target.aggregations.length ? `; aggregations: ${target.aggregations.join(', ')}` : ''}`);
        });
        item.append(targets);
      }
      list.append(item);
    }
    section.append(list);
    summaries.append(section);
  }

  if (element.events.length) {
    const section = document.createElement('section');
    section.dataset.catalogueReferenceEvents = '';
    appendSummaryHeading(section, 'Public events');
    const list = document.createElement('ul');
    for (const event of element.events) {
      const item = document.createElement('li');
      item.dataset.catalogueReferenceEvent = event.name;
      item.append(code(event.name), `: ${event.description} `);
      appendBadge(item, 'event-bubbles', event.bubbles ? 'bubbles' : 'does not bubble', `Event bubbles: ${event.bubbles}`);
      appendBadge(item, 'event-composed', event.composed ? 'composed' : 'not composed', `Event composed: ${event.composed}`);
      if (event.detailFields.length) item.append(` detail: ${event.detailFields.join(', ')}`);
      list.append(item);
    }
    section.append(list);
    summaries.append(section);
  }

  if (element.composition) {
    const section = document.createElement('section');
    section.dataset.catalogueReferenceComposition = '';
    appendSummaryHeading(section, 'Composition');
    const list = document.createElement('ul');
    const composition = element.composition;
    if (composition.requiredParent) {
      const item = document.createElement('li');
      item.append('Required parent: ', code(composition.requiredParent));
      list.append(item);
    }
    if (composition.requiredDirectChildren?.length) {
      const item = document.createElement('li');
      item.append('Required direct children: ', composition.requiredDirectChildren.map((child) => child).join(', '));
      list.append(item);
    }
    if (composition.advisoryDirectChildren?.length) {
      const item = document.createElement('li');
      item.append('Advisory direct children: ', composition.advisoryDirectChildren.join(', '));
      list.append(item);
    }
    if (list.childElementCount) {
      section.append(list);
      summaries.append(section);
    }
  }

  return summaries.childElementCount ? summaries : undefined;
}

function makeTable(element: ComponentContract): HTMLTableElement {
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
  for (const attribute of effectiveAttributes(element)) {
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

function makeReference(element: ComponentContract): HTMLElement {
  const collapse = document.createElement('nodel-collapse');
  collapse.setAttribute('label', `${element.name} attributes`);
  const count = effectiveAttributes(element).length;
  collapse.setAttribute('preview', `${count} attribute${count === 1 ? '' : 's'} · audience: ${element.audience} · registration: ${element.registration} · completion: ${element.completion}`);
  collapse.dataset.catalogueReferenceFor = element.name;
  collapse.dataset.catalogueReferenceAudience = element.audience;
  collapse.dataset.catalogueReferenceRegistration = element.registration;
  collapse.dataset.catalogueReferenceCompletion = element.completion;

  const wrapper = document.createElement('div');
  wrapper.className = 'nodel-catalogue-reference-table-scroll';
  wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'region');
  wrapper.setAttribute('aria-label', `${element.name} attribute table`);
  collapse.append(makeClassificationSummary(element));
  const summaries = makeStructuredSummaries(element);
  if (summaries) collapse.append(summaries);
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
  return Array.from(options.requiredElements ?? componentContracts.filter((element) => element.catalogue).map((element) => element.name))
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
    const element = findComponentContract(name);
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
    const renderedNames = new Set(values.filter((name) => findComponentContract(name)?.catalogue));
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
