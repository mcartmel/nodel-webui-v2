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
import './components/nodel-theme-toggle';

import { bootstrapJsViews } from './jsviews/jsviews-runtime';

void bootstrapJsViews().catch((error) => {
  console.error('JsViews bootstrap failed', error);
});
