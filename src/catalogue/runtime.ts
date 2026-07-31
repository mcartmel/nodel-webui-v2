import type { NodelActivityLogEntry } from '../api/nodel-types';
import type { NodelControlRuntime, NodelControlSignalState } from '../data/control-runtime';

interface PayloadRecord {
  [key: string]: unknown;
}

interface SignalListener {
  listener: (state: NodelControlSignalState) => void;
}

const busyDelayMs = 1000;

const initialSignals: Record<string, unknown> = {
  PanelVisible: true,
  ConfirmCode: '0420',
  AvailableSources: [
    { value: 'HDMI 1', label: 'HDMI 1' },
    { value: 'HDMI 2', label: 'HDMI 2' },
    { value: 'USB-C', label: 'USB-C' },
    { value: 'Chromecast', label: 'Chromecast' },
    { value: 'TV', label: 'TV' },
    { value: 'Signage', label: 'Signage' }
  ],
  CurrentSource: 'HDMI 1',
  AvailableModes: ['Auto', 'Manual', 'Presentation'],
  CurrentMode: 'Auto',
  Source: 'HDMI 1',
  Temp: 22,
  ZoneA: 70,
  Power: false,
  Shutdown: false,
  VisitorLink: 'https://example.org/visitor-guide',
  DeviceOnline: true,
  NetworkStatus: { level: 1, message: 'Packet loss warning' },
  ShowRunning: false,
  ControlsLocked: false,
  PageTitle: 'Signal-driven page title',
  SectionTitle: 'Signal-driven section title',
  Status: 'Ready for catalogue interaction',
  AlertText: 'Signal-driven warning message',
  MarkdownContent: '## Live operations\n\n- Network ready\n- Controller connected\n\n[Open details](#Text)',
  ClockValue: '2026-07-31T10:15:30Z',
  HostName: 'Demo Host',
  HostAddress: 'demo-host',
  HostUrl: '#HostIcon',
  HostTitle: 'Demo host',
  Zone1: false,
  Zone2: true,
  Zone3: false,
  Zone4: true,
  Zone1Online: true,
  Zone2Online: true,
  Zone3Online: false,
  Zone4Online: true,
  Level1: 20,
  Level2: 50,
  Level3: 80,
  Output5: false,
  Output6: true
};

function isRecord(value: unknown): value is PayloadRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasPayloadArg(payload: unknown): payload is PayloadRecord & { arg: unknown } {
  return isRecord(payload) && Object.prototype.hasOwnProperty.call(payload, 'arg');
}

function nextBooleanValue(value: unknown) {
  return !Boolean(value);
}

function createActivityEntry(seq: number, alias: string, arg: unknown): NodelActivityLogEntry {
  return {
    seq,
    timestamp: new Date().toISOString(),
    source: 'local',
    type: 'event',
    alias,
    arg
  };
}

function seedEntries(signals: Map<string, unknown>, nextSequence: () => number) {
  return Array.from(signals, ([alias, arg]) => createActivityEntry(nextSequence(), alias, arg));
}

function publishSignal(
  signals: Map<string, unknown>,
  listeners: Set<SignalListener>,
  nextSequence: () => number,
  alias: string,
  arg: unknown
) {
  signals.set(alias, arg);
  const entry = createActivityEntry(nextSequence(), alias, arg);
  const state: NodelControlSignalState = {
    loading: false,
    connected: true,
    error: '',
    entries: [entry]
  };

  for (const subscriber of listeners) {
    subscriber.listener(state);
  }
}

function actionSignalAlias(name: string) {
  return name.startsWith('Set') && name.length > 3 ? name.slice(3) : null;
}

function actionValue(payload: unknown, signals: Map<string, unknown>, alias: string) {
  if (hasPayloadArg(payload)) {
    return payload.arg;
  }

  return nextBooleanValue(signals.get(alias));
}

function createMemoryRuntime(): NodelControlRuntime {
  const signals = new Map(Object.entries(initialSignals));
  const listeners = new Set<SignalListener>();
  let sequence = 0;

  const nextSequence = () => {
    sequence += 1;
    return sequence;
  };

  const publish = (alias: string, arg: unknown) => publishSignal(signals, listeners, nextSequence, alias, arg);

  return {
    async callAction(name, payload) {
      if (name === 'CatalogueBusy') {
        await new Promise<void>((resolve) => window.setTimeout(resolve, busyDelayMs));
      } else if (name === 'SetSource') {
        const value = hasPayloadArg(payload) ? payload.arg : signals.get('Source');
        publish('Source', value);
        publish('CurrentSource', value);
      } else if (name === 'SetMode') {
        publish('CurrentMode', hasPayloadArg(payload) ? payload.arg : signals.get('CurrentMode'));
      } else if (name === 'StartShow') {
        publish('ShowRunning', nextBooleanValue(signals.get('ShowRunning')));
      } else if (name === 'RestartNetwork') {
        publish('NetworkStatus', { level: 0, message: 'Network ready' });
      } else {
        const alias = actionSignalAlias(name) ?? (signals.has(name) ? name : null);
        if (alias) {
          publish(alias, actionValue(payload, signals, alias));
        }
      }

      return { demo: true, action: name };
    },

    subscribeSignals(_element, listener) {
      const subscriber = { listener };
      listeners.add(subscriber);
      listener({
        loading: false,
        connected: true,
        error: '',
        entries: seedEntries(signals, nextSequence)
      });

      return {
        dispose() {
          listeners.delete(subscriber);
        }
      };
    }
  };
}

export function createCatalogueRuntime() {
  return createMemoryRuntime();
}

export { busyDelayMs, initialSignals };
