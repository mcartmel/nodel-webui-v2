import { ConnectivityPresentationController } from '../src/data/connectivity-presentation';
import type { NodelConnectivityState } from '../src/data/connectivity';

const online: NodelConnectivityState = { offline: false, reason: '', retryAttempt: 0 };
const offline: NodelConnectivityState = { offline: true, reason: 'network', retryAttempt: 1 };

describe('ConnectivityPresentationController', () => {
  it('requests focus only when entering modal presentation', () => {
    const controller = new ConnectivityPresentationController();
    expect(controller.update(online, 'modal').requestFocus).toBe(false);
    const modal = controller.update(offline, 'modal');
    expect(modal.requestFocus).toBe(true);
    expect(controller.update(offline, 'modal').requestFocus).toBe(false);
    expect(controller.update(offline, 'overlay').requestFocus).toBe(false);
    expect(controller.update(offline, 'modal').requestFocus).toBe(true);
  });

  it('clears modal state on recovery and rejects stale focus tokens', () => {
    const controller = new ConnectivityPresentationController();
    const first = controller.update(offline, 'modal');
    expect(controller.isFocusCurrent(first.focusToken)).toBe(true);
    controller.update(online, 'modal');
    expect(controller.isFocusCurrent(first.focusToken)).toBe(false);
    const second = controller.update(offline, 'modal');
    controller.reset();
    expect(controller.isFocusCurrent(second.focusToken)).toBe(false);
  });
});
