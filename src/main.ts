import './catalogue/runtime-bootstrap';

import './components/nodel-app';
import './components/nodel-toolbar';
import './components/nodel-page';
import './components/nodel-row';
import './components/nodel-column';
import './components/nodel-footer';
import './components/nodel-control-grid';
import './components/nodel-control-space';
import './components/nodel-group';
import './components/nodel-template';
import './components/nodel-button';
import './components/nodel-toggle';
import './components/nodel-segmented';
import './components/nodel-select';
import './components/nodel-meter';
import './components/nodel-fader';
import './components/nodel-stepper';
import './components/nodel-pad';
import './components/nodel-readout';
import './components/nodel-palette';
import './components/nodel-image';
import './components/nodel-icon';
import './components/nodel-qrcode';
import './components/nodel-status-indicator';
import './components/nodel-status';
import './components/nodel-collapse';
import './components/nodel-text';
import './components/nodel-markdown';
import './components/nodel-title';
import './components/nodel-clock';
import './components/nodel-host-icon';
import './components/nodel-theme-toggle';
import './components/nodel-toast-host';
import './components/nodel-confirm-host';
import './components/nodel-connectivity-host';

import { bootstrapSignalVisibilityBindings } from './data/signal-bindings';
import { bootstrapNodelComponentLoader, loadNodelComponent } from './nodel-component-loader';

export { loadNodelComponent };

bootstrapSignalVisibilityBindings();
bootstrapNodelComponentLoader();
