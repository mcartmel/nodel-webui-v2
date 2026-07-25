import { installControlRuntime } from '../data/control-runtime';
import { createCatalogueRuntime } from './runtime';

const runtimeMarker = 'script[type="module"][data-nodel-runtime="memory"]';

export function catalogueRuntimeRequested(root: ParentNode = document) {
  return Boolean(root.querySelector(runtimeMarker));
}

if (catalogueRuntimeRequested()) {
  installControlRuntime(createCatalogueRuntime());
}
