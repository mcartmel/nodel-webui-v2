import { flush } from './helpers';
import '../src/components/nodel-template';

describe('nodel-template', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders one clone by default from a native template child', async () => {
    document.body.innerHTML = `
      <section>
        <nodel-template name="Zone">
          <template>
            <button data-item="{{item}}">{{name}} {{number}}</button>
          </template>
        </nodel-template>
      </section>
    `;
    await customElements.whenDefined('nodel-template');
    await flush();

    const buttons = Array.from(document.querySelectorAll('button'));
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent?.trim()).toBe('Zone 1');
    expect(buttons[0].dataset.item).toBe('Zone1');
  });

  it('renders repeated clones and replaces placeholders in text and attributes', async () => {
    document.body.innerHTML = `
      <section>
        <nodel-template name="Zone" repeat="3">
          <template>
            <button action="Set{{item}}" signal="{{item}}">{{index}}: {{item}} of {{repeat}}</button>
          </template>
        </nodel-template>
      </section>
    `;
    await customElements.whenDefined('nodel-template');
    await flush();

    const buttons = Array.from(document.querySelectorAll('button'));
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      '0: Zone1 of 3',
      '1: Zone2 of 3',
      '2: Zone3 of 3'
    ]);
    expect(buttons.map((button) => button.getAttribute('action'))).toEqual(['SetZone1', 'SetZone2', 'SetZone3']);
    expect(buttons.map((button) => button.getAttribute('signal'))).toEqual(['Zone1', 'Zone2', 'Zone3']);
  });

  it('uses start and step for number and item placeholders', async () => {
    document.body.innerHTML = `
      <section>
        <nodel-template name="Output" repeat="3" start="2" step="2">
          <template>
            <span>{{number}} {{item}}</span>
          </template>
        </nodel-template>
      </section>
    `;
    await customElements.whenDefined('nodel-template');
    await flush();

    expect(Array.from(document.querySelectorAll('span')).map((span) => span.textContent?.trim())).toEqual([
      '2 Output2',
      '4 Output4',
      '6 Output6'
    ]);
  });

  it('supports data placeholders in hyphenated and camelCase forms', async () => {
    document.body.innerHTML = `
      <section>
        <nodel-template name="Zone" repeat="1" data-action-prefix="SetZone" data-room="Gallery">
          <template>
            <button action="{{actionPrefix}}{{number}}" data-alt-action="{{action-prefix}}{{number}}">{{room}} {{item}}</button>
          </template>
        </nodel-template>
      </section>
    `;
    await customElements.whenDefined('nodel-template');
    await flush();

    const button = document.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('action')).toBe('SetZone1');
    expect(button.dataset.altAction).toBe('SetZone1');
    expect(button.textContent?.trim()).toBe('Gallery Zone1');
  });

  it('renders shared templates by id in multiple locations', async () => {
    document.body.innerHTML = `
      <template id="shared-button">
        <button action="{{actionPrefix}}{{number}}">{{name}} {{number}}</button>
      </template>
      <section>
        <nodel-template template="shared-button" name="Zone" repeat="2" data-action-prefix="SetZone"></nodel-template>
      </section>
      <aside>
        <nodel-template template="shared-button" name="Output" repeat="2" start="3" data-action-prefix="SetOutput"></nodel-template>
      </aside>
    `;
    await customElements.whenDefined('nodel-template');
    await flush();

    const buttons = Array.from(document.querySelectorAll('button'));
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'Zone 1',
      'Zone 2',
      'Output 3',
      'Output 4'
    ]);
    expect(buttons.map((button) => button.getAttribute('action'))).toEqual([
      'SetZone1',
      'SetZone2',
      'SetOutput3',
      'SetOutput4'
    ]);
  });

  it('does not render when an explicit shared template id is missing', async () => {
    document.body.innerHTML = `
      <section>
        <nodel-template template="missing-template" name="Zone" repeat="2">
          <template>
            <button>{{item}}</button>
          </template>
        </nodel-template>
      </section>
    `;
    await customElements.whenDefined('nodel-template');
    await flush();

    expect(document.querySelectorAll('button')).toHaveLength(0);
  });

  it('re-renders when attributes change and removes stale rendered nodes', async () => {
    document.body.innerHTML = `
      <section>
        <nodel-template name="Zone" repeat="2">
          <template>
            <button>{{item}}</button>
          </template>
        </nodel-template>
      </section>
    `;
    await customElements.whenDefined('nodel-template');
    await flush();

    const host = document.querySelector('nodel-template') as HTMLElement;
    host.setAttribute('name', 'Area');
    host.setAttribute('repeat', '3');
    await flush();

    expect(Array.from(document.querySelectorAll('button')).map((button) => button.textContent?.trim())).toEqual([
      'Area1',
      'Area2',
      'Area3'
    ]);
  });

  it('removes rendered sibling nodes when disconnected', async () => {
    document.body.innerHTML = `
      <section>
        <nodel-template name="Zone" repeat="2">
          <template>
            <button>{{item}}</button>
          </template>
        </nodel-template>
      </section>
    `;
    await customElements.whenDefined('nodel-template');
    await flush();

    expect(document.querySelectorAll('button')).toHaveLength(2);
    document.querySelector('nodel-template')?.remove();

    expect(document.querySelectorAll('button')).toHaveLength(0);
  });

  it('leaves unknown placeholders unchanged', async () => {
    document.body.innerHTML = `
      <section>
        <nodel-template name="Zone">
          <template>
            <button>{{missing}} {{item}}</button>
          </template>
        </nodel-template>
      </section>
    `;
    await customElements.whenDefined('nodel-template');
    await flush();

    expect(document.querySelector('button')?.textContent?.trim()).toBe('{{missing}} Zone1');
  });
});
