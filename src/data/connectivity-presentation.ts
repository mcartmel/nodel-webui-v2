import type { NodelConnectivityState } from './connectivity';
import type { NodelOfflineMode } from '../components/nodel-connectivity-host';

export interface ConnectivityPresentationTransition {
  mode: NodelOfflineMode;
  requestFocus: boolean;
  focusToken: number;
}

/** Derives app-level connectivity presentation without owning a host or focus. */
export class ConnectivityPresentationController {
  private modalActive = false;
  private focusToken = 0;

  update(state: NodelConnectivityState, mode: NodelOfflineMode): ConnectivityPresentationTransition {
    const modal = state.offline && mode === 'modal';
    const requestFocus = modal && !this.modalActive;
    this.modalActive = modal;
    if (requestFocus) {
      this.focusToken += 1;
    }
    return { mode, requestFocus, focusToken: this.focusToken };
  }

  isFocusCurrent(token: number) {
    return this.modalActive && token === this.focusToken;
  }

  reset() {
    this.modalActive = false;
    this.focusToken += 1;
  }
}
