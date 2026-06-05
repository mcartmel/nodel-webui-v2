import { flush, waitFor } from './helpers';

const paramsMock = vi.hoisted(() => ({
  getNodeParams: vi.fn(),
  getNodeParamsSchema: vi.fn(),
  saveNodeParams: vi.fn()
}));

vi.mock('../src/api/nodel-host-client', () => ({
  getNodeParams: paramsMock.getNodeParams,
  getNodeParamsSchema: paramsMock.getNodeParamsSchema,
  saveNodeParams: paramsMock.saveNodeParams
}));

import '../src/components/nodel-params';

async function mountParams() {
  document.body.innerHTML = '<nodel-params></nodel-params>';
  await customElements.whenDefined('nodel-params');
  await waitFor(() => paramsMock.getNodeParamsSchema.mock.calls.length === 1 && paramsMock.getNodeParams.mock.calls.length === 1, {
    attempts: 100,
    intervalMs: 1
  });
  await waitFor(() => !document.body.textContent?.includes('Loading parameters'), {
    attempts: 100,
    intervalMs: 1
  });
  await flush();
  return document.querySelector('nodel-params')!;
}

function submitForm() {
  document.querySelector<HTMLFormElement>('[data-params-form]')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

async function setInputValue(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}

async function setCheckboxValue(input: HTMLInputElement, checked: boolean) {
  input.checked = checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}

async function openDetails(details: HTMLDetailsElement) {
  details.open = true;
  details.dispatchEvent(new Event('toggle', { bubbles: true }));
  await flush();
}

function schemaDetailsByLabel(label: string) {
  return Array.from(document.querySelectorAll<HTMLDetailsElement>('details.nodel-schema-nested'))
    .find((details) => details.querySelector('.nodel-collapse-label')?.textContent?.trim() === label) ?? null;
}

function directChildrenWithClass(element: Element, className: string) {
  return Array.from(element.children).filter((child) => child.classList.contains(className));
}

describe('nodel-params', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    paramsMock.getNodeParams.mockReset().mockResolvedValue({});
    paramsMock.getNodeParamsSchema.mockReset().mockResolvedValue({ type: 'object', properties: {} });
    paramsMock.saveNodeParams.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('loads schema and params, hydrates values, and saves raw parameter payloads', async () => {
    paramsMock.getNodeParamsSchema.mockResolvedValue({
      type: 'object',
      properties: {
        testParam: { type: 'string', title: 'Test Parameter', order: 1 },
        numberParam: { type: 'integer', title: 'Number Parameter', order: 2 },
        enabled: { type: 'boolean', title: 'Enabled', order: 3 },
        mode: { type: 'string', title: 'Mode', enum: ['Auto', 'Manual'], order: 4 }
      }
    });
    paramsMock.getNodeParams.mockResolvedValue({
      testParam: 'ready',
      numberParam: 7,
      enabled: true,
      mode: 'Auto'
    });

    await mountParams();

    const textInput = document.querySelector<HTMLInputElement>('input[type="text"]')!;
    const numberInput = document.querySelector<HTMLInputElement>('input[type="number"]')!;
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const select = document.querySelector<HTMLSelectElement>('select')!;

    expect(textInput.value).toBe('ready');
    expect(numberInput.value).toBe('7');
    expect(checkbox.checked).toBe(true);
    expect(select.value).toBe('Auto');

    await setInputValue(textInput, 'updated');
    await setInputValue(numberInput, '12');
    await setCheckboxValue(checkbox, false);
    await setInputValue(select, 'Manual');

    submitForm();
    await waitFor(() => paramsMock.saveNodeParams.mock.calls.length === 1);

    expect(paramsMock.saveNodeParams).toHaveBeenCalledWith({
      testParam: 'updated',
      numberParam: 12,
      enabled: false,
      mode: 'Manual'
    });
    expect(document.body.textContent).toContain('Saved');
  });

  it('preserves original JSON property names inside object parameters', async () => {
    paramsMock.getNodeParamsSchema.mockResolvedValue({
      type: 'object',
      properties: {
        network: {
          type: 'object',
          title: 'Network',
          properties: {
            'ip-address': { type: 'string', title: 'IP address', order: 1 },
            retry_count: { type: 'integer', title: 'Retry count', order: 2 }
          }
        }
      }
    });
    paramsMock.getNodeParams.mockResolvedValue({
      network: {
        'ip-address': '10.0.0.5',
        retry_count: 2
      }
    });

    await mountParams();
    await openDetails(document.querySelector<HTMLDetailsElement>('details')!);

    const textInput = document.querySelector<HTMLInputElement>('input[type="text"]')!;
    const numberInput = document.querySelector<HTMLInputElement>('input[type="number"]')!;
    await setInputValue(textInput, '10.0.0.10');
    await setInputValue(numberInput, '5');

    submitForm();
    await waitFor(() => paramsMock.saveNodeParams.mock.calls.length === 1);

    expect(paramsMock.saveNodeParams).toHaveBeenCalledWith({
      network: {
        'ip-address': '10.0.0.10',
        retry_count: 5
      }
    });
  });

  it('renders an empty state when there are no parameter schema fields', async () => {
    paramsMock.getNodeParamsSchema.mockResolvedValue({ type: 'object', properties: {} });
    paramsMock.getNodeParams.mockResolvedValue({});

    await mountParams();

    expect(document.body.textContent).toContain('No parameters.');
    submitForm();
    await flush();
    expect(paramsMock.saveNodeParams).not.toHaveBeenCalled();
  });

  it('renders load and save errors', async () => {
    paramsMock.getNodeParamsSchema.mockRejectedValueOnce(new Error('Schema unavailable'));
    paramsMock.getNodeParams.mockResolvedValueOnce({});

    await mountParams();

    expect(document.body.textContent).toContain('Schema unavailable');
    expect(document.body.textContent).not.toContain('No parameters.');

    paramsMock.getNodeParamsSchema.mockResolvedValueOnce({
      type: 'object',
      properties: {
        testParam: { type: 'string', title: 'Test Parameter' }
      }
    });
    paramsMock.getNodeParams.mockResolvedValueOnce({ testParam: 'ready' });
    paramsMock.saveNodeParams.mockRejectedValueOnce(new Error('Save failed'));

    await mountParams();
    submitForm();
    await waitFor(() => document.body.textContent?.includes('Save failed'));

    expect(paramsMock.saveNodeParams).toHaveBeenCalledWith({ testParam: 'ready' });
  });

  it('supports array add, remove, and move controls from the shared schema form', async () => {
    paramsMock.getNodeParamsSchema.mockResolvedValue({
      type: 'object',
      properties: {
        servers: {
          type: 'array',
          title: 'Servers',
          items: { type: 'string' }
        }
      }
    });
    paramsMock.getNodeParams.mockResolvedValue({ servers: ['alpha', 'beta'] });

    await mountParams();
    await openDetails(document.querySelector<HTMLDetailsElement>('details')!);

    const firstRemove = document.querySelector<HTMLButtonElement>('[data-schema-array-remove]')!;
    firstRemove.click();
    await flush();

    document.querySelector<HTMLButtonElement>('[data-schema-array-add]')?.click();
    await flush();

    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"]'));
    expect(inputs.map((input) => input.value)).toEqual(['beta', '']);
    await setInputValue(inputs[1], 'gamma');

    const moveUpButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-schema-array-move="up"]'));
    moveUpButtons[1].click();
    await flush();

    submitForm();
    await waitFor(() => paramsMock.saveNodeParams.mock.calls.length === 1);

    expect(paramsMock.saveNodeParams).toHaveBeenCalledWith({
      servers: ['gamma', 'beta']
    });
  });

  it('uses shared schema stacks for nested object arrays and array entries', async () => {
    paramsMock.getNodeParamsSchema.mockResolvedValue({
      type: 'object',
      properties: {
        lighting: {
          type: 'object',
          title: 'Lighting',
          properties: {
            mode: { type: 'string', title: 'Mode', order: 1 },
            segments: {
              type: 'array',
              title: 'Segments',
              order: 2,
              items: {
                type: 'object',
                properties: {
                  segmentId: { type: 'integer', title: 'Segment ID', order: 1 },
                  startLed: { type: 'integer', title: 'Start LED', order: 2 },
                  colours: {
                    type: 'array',
                    title: 'Colours',
                    order: 3,
                    items: {
                      type: 'object',
                      properties: {
                        red: { type: 'integer', title: 'Red', order: 1 },
                        green: { type: 'integer', title: 'Green', order: 2 }
                      }
                    }
                  },
                  effect: { type: 'string', title: 'Effect', order: 4 }
                }
              }
            }
          }
        }
      }
    });
    paramsMock.getNodeParams.mockResolvedValue({
      lighting: {
        mode: 'solid',
        segments: [
          {
            segmentId: 1,
            startLed: 0,
            colours: [{ red: 255, green: 0 }],
            effect: 'blink'
          }
        ]
      }
    });

    await mountParams();

    expect(document.querySelector('.nodel-schema-form')?.classList.contains('nodel-schema-stack')).toBe(true);

    const lighting = schemaDetailsByLabel('Lighting')!;
    await openDetails(lighting);
    expect(lighting.querySelector('.nodel-schema-nested-content')?.classList.contains('nodel-schema-stack')).toBe(true);

    const segments = schemaDetailsByLabel('Segments')!;
    await openDetails(segments);

    const segmentEntry = segments.querySelector('.nodel-schema-array-entry')!;
    expect(directChildrenWithClass(segmentEntry, 'nodel-schema-field')).toHaveLength(0);
    const segmentEntryStacks = directChildrenWithClass(segmentEntry, 'nodel-schema-stack');
    expect(segmentEntryStacks).toHaveLength(1);
    expect(directChildrenWithClass(segmentEntryStacks[0], 'nodel-schema-field').length).toBeGreaterThan(1);

    const colours = schemaDetailsByLabel('Colours')!;
    await openDetails(colours);
    expect(colours.querySelector('.nodel-schema-nested-content')?.classList.contains('nodel-schema-stack')).toBe(true);

    const colourEntry = colours.querySelector('.nodel-schema-array-entry')!;
    expect(directChildrenWithClass(colourEntry, 'nodel-schema-field')).toHaveLength(0);
    const colourEntryStacks = directChildrenWithClass(colourEntry, 'nodel-schema-stack');
    expect(colourEntryStacks).toHaveLength(1);
    expect(directChildrenWithClass(colourEntryStacks[0], 'nodel-schema-field').length).toBeGreaterThan(1);
  });

  it('refreshes schema and values after a node restart', async () => {
    paramsMock.getNodeParamsSchema.mockResolvedValueOnce({
      type: 'object',
      properties: {
        first: { type: 'string', title: 'First' }
      }
    });
    paramsMock.getNodeParams.mockResolvedValueOnce({ first: 'ready' });

    const element = await mountParams();
    expect(document.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('ready');

    paramsMock.getNodeParamsSchema.mockResolvedValueOnce({
      type: 'object',
      properties: {
        second: { type: 'string', title: 'Second' }
      }
    });
    paramsMock.getNodeParams.mockResolvedValueOnce({ second: 'fresh' });

    await (element as any).refreshAfterRestart();
    await waitFor(() => document.querySelector<HTMLInputElement>('input[type="text"]')?.value === 'fresh');

    expect(document.body.textContent).toContain('Second');
    expect(document.body.textContent).not.toContain('First');
    expect(paramsMock.getNodeParamsSchema).toHaveBeenCalledTimes(2);
    expect(paramsMock.getNodeParams).toHaveBeenCalledTimes(2);
  });
});
