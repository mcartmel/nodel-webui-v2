import { waitFor } from './helpers';

vi.mock('../src/jsviews/jsviews-link-controller', () => ({
  JsViewsLinkController: class {
    link() {
      return Promise.reject(new Error('Template link failed'));
    }

    unlink() {
      return Promise.resolve();
    }

    whenSettled() {
      return Promise.resolve();
    }
  }
}));

import '../src/components/nodel-params';
import '../src/components/nodel-actsig';
import '../src/components/nodel-bindings';
import '../src/components/nodel-editor';
import '../src/components/nodel-console';
import '../src/components/nodel-log';
import '../src/components/nodel-add-node';
import '../src/components/nodel-node-menu';
import '../src/components/nodel-host-log';
import '../src/components/nodel-diagnostic-charts';
import '../src/components/nodel-node-list';

describe('JsViews initialization errors', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders pre-link failures for every migrated JsViews family', async () => {
    const tags = [
      'nodel-params',
      'nodel-actsig',
      'nodel-bindings',
      'nodel-editor',
      'nodel-console',
      'nodel-log',
      'nodel-add-node',
      'nodel-node-menu',
      'nodel-host-log',
      'nodel-diagnostic-charts',
      'nodel-node-list'
    ];
    for (const tag of tags) {
      document.body.append(document.createElement(tag));
    }

    for (const tag of tags) {
      await waitFor(() => document.querySelector(tag)?.getAttribute('data-state') === 'error', { message: `${tag} did not render its link error` });
    }
    for (const tag of tags) {
      expect(document.querySelector(tag)?.textContent).toContain('Template link failed');
      expect(document.querySelector(`${tag} [role="alert"]`)).not.toBeNull();
    }
  });
});
