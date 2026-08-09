import { AppNavigationController, type AppNavigationPage } from '../src/navigation/app-navigation-controller';

interface Page { name: string; }

function page(name: string, options: Partial<Omit<AppNavigationPage<Page>, 'page'>> = {}): AppNavigationPage<Page> {
  return { page: { name }, navId: null, navLabel: null, title: null, ...options };
}

describe('AppNavigationController', () => {
  it('models direct pages and groups with stable explicit and derived IDs', () => {
    const controller = new AppNavigationController<Page>();
    const group = page('group', { navId: 'areas', navLabel: 'Areas', children: [page('one', { title: 'Room 1' }), page('two', { title: 'Room 1' })] });
    const transition = controller.sync([page('overview', { title: 'Overview' }), group, page('custom', { navId: 'Overview', title: 'Ignored' })], '');

    expect(transition.detail).toEqual({
      activePageId: 'Overview',
      items: [
        { type: 'page', id: 'Overview', title: 'Overview' },
        { type: 'group', id: 'areas', title: 'Areas', children: [{ type: 'page', id: 'Room1', title: 'Room 1' }, { type: 'page', id: 'Room12', title: 'Room 1' }] },
        { type: 'page', id: 'Overview2', title: 'Ignored' }
      ]
    });
    expect(transition.visibility.map(({ page, active, group }) => [page.name, active, group]))
      .toEqual([['overview', true, false], ['group', false, true], ['one', false, false], ['two', false, false], ['custom', false, false]]);
  });

  it('prioritizes valid hash, retains a valid selection, and ignores invalid or group hashes', () => {
    const controller = new AppNavigationController<Page>();
    const pages = [page('first', { title: 'First' }), page('group', { title: 'Group', children: [page('leaf', { title: 'Leaf' })] })];
    expect(controller.sync(pages, '#Leaf').detail.activePageId).toBe('Leaf');
    expect(controller.sync(pages, '#missing').detail.activePageId).toBe('Leaf');
    expect(controller.sync(pages, '#Group').detail.activePageId).toBe('Leaf');
    expect(controller.sync(pages, '#%E0%A4%A').detail.activePageId).toBe('Leaf');
    expect(controller.select('Group')).toBeNull();
  });

  it('returns encoded hash writes and activates initial, hash, explicit, and reselected pages only', () => {
    const controller = new AppNavigationController<Page>();
    const first = page('first', { title: 'First' });
    const second = page('second', { navId: 'other value' });
    expect(controller.sync([first, second], '').pageToActivate).toBe(first.page);
    expect(controller.sync([first, second], '').pageToActivate).toBeNull();
    expect(controller.handleHash('#other%20value')?.pageToActivate).toBe(second.page);
    const explicit = controller.select('other value')!;
    expect(explicit.hashWrite).toBe('#other%20value');
    expect(explicit.pageToActivate).toBe(second.page);
    expect(controller.select('other value')?.pageToActivate).toBe(second.page);
  });

  it('ignores the hash event after sync already handled the same active hash', () => {
    const controller = new AppNavigationController<Page>();
    const first = page('first', { title: 'First' });
    const pages = [first, page('second', { title: 'Second' })];

    controller.sync(pages, '#Second');

    expect(controller.handleHash('#Second')).toBeNull();
    expect(controller.handleHash('#First')?.pageToActivate).toBe(first.page);
  });

  it('does not reactivate retained pages during rediscovery and exposes group-parent visibility', () => {
    const controller = new AppNavigationController<Page>();
    const group = page('group', { title: 'Group', children: [page('leaf', { title: 'Leaf' })] });
    controller.sync([group], '');
    const selected = controller.select('Leaf')!;
    expect(selected.visibility.filter((state) => state.active).map((state) => state.page.name)).toEqual(['group', 'leaf']);
    expect(controller.sync([group, page('added', { title: 'Added' })], '').pageToActivate).toBeNull();
  });

  it('falls back after removing the active page without reactivating the fallback', () => {
    const controller = new AppNavigationController<Page>();
    const first = page('first', { title: 'First' });
    const second = page('second', { title: 'Second' });
    controller.sync([first, second], '');
    controller.select('Second');

    const fallback = controller.sync([first], '');
    expect(fallback.detail.activePageId).toBe('First');
    expect(fallback.pageToActivate).toBeNull();
  });
});
