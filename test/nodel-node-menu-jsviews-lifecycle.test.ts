import { flush, waitFor } from './helpers';

const menuLinkMock = vi.hoisted(() => {
  const links: Array<{ generation: number; resolve: () => void; result?: boolean }> = [];
  return {
    links,
    reset: () => {
      links.length = 0;
    },
    add(generation: number, target: HTMLElement, scope: { isCurrent(): boolean }) {
      let resolve!: () => void;
      const ready = new Promise<void>((done) => {
        resolve = done;
      });
      links.push({ generation, resolve });
      return ready.then(() => {
        if (!scope.isCurrent()) {
          return false;
        }
        target.innerHTML = '<input data-node-menu-rename-input>';
        return true;
      });
    }
  };
});

const menuLifecycleMock = vi.hoisted(() => ({
  getNodeDetails: vi.fn(),
  listCustomUiEntries: vi.fn(),
  removeCurrentNode: vi.fn(),
  renameCurrentNode: vi.fn(),
  restartCurrentNode: vi.fn(),
  waitForNodeReady: vi.fn()
}));

vi.mock('../src/jsviews/jsviews-link-controller', () => ({
  JsViewsLinkController: class DelayedJsViewsLinkController {
      constructor(private readonly target: HTMLElement) {}

      link(scope: any) {
        const call = menuLinkMock.links.length;
        return menuLinkMock.add(scope.generation, this.target, scope).then((linked) => {
          menuLinkMock.links[call]!.result = linked;
          return linked;
        });
      }
    }
}));

vi.mock('../src/jsviews/jsviews-runtime', () => ({
  getJQuery: () => ({
    observable: (value: any) => ({
      setProperty: (values: object) => Object.assign(value, values)
    })
  })
}));

vi.mock('../src/api/nodel-host-client', () => ({
  getNodeDetails: menuLifecycleMock.getNodeDetails,
  listCustomUiEntries: menuLifecycleMock.listCustomUiEntries,
  removeCurrentNode: menuLifecycleMock.removeCurrentNode,
  renameCurrentNode: menuLifecycleMock.renameCurrentNode,
  restartCurrentNode: menuLifecycleMock.restartCurrentNode,
  waitForNodeReady: menuLifecycleMock.waitForNodeReady
}));

import '../src/components/nodel-node-menu';

describe('nodel-node-menu JsViews lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState(undefined, '', '/nodes/Current/nodel.html');
    menuLinkMock.reset();
    menuLifecycleMock.getNodeDetails.mockReset().mockResolvedValue({ name: 'Current' });
    menuLifecycleMock.listCustomUiEntries.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('prevents a stale delayed link from loading data or binding document listeners', async () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const menu = document.createElement('nodel-node-menu');
    document.body.append(menu);
    await waitFor(() => menuLinkMock.links.length === 1);

    menu.remove();
    document.body.append(menu);
    await waitFor(() => menuLinkMock.links.length === 2);

    menuLinkMock.links[0]!.resolve();
    await flush();
    expect(menuLinkMock.links[0]!.result).toBe(false);
    expect(menuLifecycleMock.getNodeDetails).not.toHaveBeenCalled();
    expect(menuLifecycleMock.listCustomUiEntries).not.toHaveBeenCalled();
    expect(addEventListener.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);

    menuLinkMock.links[1]!.resolve();
    await waitFor(() => menuLifecycleMock.getNodeDetails.mock.calls.length === 1);
    await flush();

    expect(menuLinkMock.links[1]!.result).toBe(true);
    expect(menuLifecycleMock.listCustomUiEntries).toHaveBeenCalledOnce();
    expect(addEventListener.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);

    menu.remove();
    expect(removeEventListener.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
  });
});
