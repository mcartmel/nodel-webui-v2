import './components/nodel-app';
import './components/nodel-toolbar';
import './components/nodel-page';
import './components/nodel-row';
import './components/nodel-column';
import './components/nodel-collapse';
import './components/nodel-description';
import './components/nodel-text';
import './components/nodel-host-icon';
import './components/nodel-node-list';
import './components/nodel-add-node';
import './components/nodel-node-menu';
import './components/nodel-diagnostics';
import './components/nodel-console';
import './components/nodel-log';
import './components/nodel-actsig';
import './components/nodel-params';
import './components/nodel-bindings';
import './components/nodel-editor';
import './components/nodel-theme-toggle';
import './components/nodel-toast-host';

import { updateHostFavicon } from './icons/favicon';
import { bootstrapJsViews } from './jsviews/jsviews-runtime';

updateHostFavicon();

void bootstrapJsViews().catch((error) => {
  console.error('JsViews bootstrap failed', error);
});
