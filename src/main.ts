import './styles.css';

import './components/nodel-app';
import './components/nodel-toolbar';
import './components/nodel-page';
import './components/nodel-row';
import './components/nodel-column';
import './components/nodel-text';
import './components/nodel-host-icon';
import './components/nodel-node-list';
import './components/nodel-add-node';
import './components/nodel-diagnostics';
import './components/nodel-console';
import './components/nodel-log';
import './components/nodel-theme-toggle';

import { updateHostFavicon } from './icons/favicon';
import { bootstrapJsViews } from './jsviews/jsviews-runtime';

updateHostFavicon();

void bootstrapJsViews().catch((error) => {
  console.error('JsViews bootstrap failed', error);
});
