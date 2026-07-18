import { getHostCapabilities } from '../api/nodel-host-client';
import type { NodelCapabilities } from '../api/nodel-types';
import { registerNodelOneShotSource } from './nodel-data-runtime';
import type { NodelSourceState } from './nodel-data-runtime';

const hostCapabilitiesSource = registerNodelOneShotSource<NodelCapabilities>({
  key: 'host-capabilities',
  fetcher: (signal) => getHostCapabilities({ signal }),
  visibleOnly: false
});

export function subscribeHostCapabilities(
  element: HTMLElement,
  listener: (state: NodelSourceState<NodelCapabilities>) => void
) {
  return hostCapabilitiesSource.subscribe(element, listener);
}

export function refreshHostCapabilities() {
  return hostCapabilitiesSource.refresh();
}
