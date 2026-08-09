(function () {
  'use strict';

  var doc = globalThis.document;
  var win = globalThis.window;
  var controlId = 'nodel-ui-version-toggle-v1';
  var styleId = controlId + '-style';

  function v2Href() {
    var parts = win.location.pathname.split('/');
    if (parts.length > 2 && parts[1].toLowerCase() === 'nodes' && parts[2]) return 'nodel.html';

    var page = (parts[parts.length - 1] || '').toLowerCase();
    if (page === 'nodes.xml') return '/nodes.html#Network';
    if (page === 'diagnostics.xml') return '/nodes.html#Diagnostics';
    if (page === 'toolkit.xml') return '/toolkit.html';
    return '/nodes.html#Locals';
  }

  function addStyles() {
    if (doc.getElementById(styleId)) return;
    var style = doc.createElement('style');
    style.id = styleId;
    style.textContent = [
      '#' + controlId + '{display:inline-flex;overflow:hidden;height:42px;margin:4px 8px 4px 0;padding:0;border:1px solid rgba(127,127,127,.55);border-radius:4px;vertical-align:top}',
      '#' + controlId + ' a,#' + controlId + ' span{display:flex;align-items:center;justify-content:center;min-width:40px;height:40px;padding:0 8px;color:inherit;font-size:12px;font-weight:600;line-height:1;text-decoration:none}',
      '#' + controlId + ' span{background:rgba(127,127,127,.24)}',
      '#' + controlId + ' a:hover,#' + controlId + ' a:focus{background:rgba(127,127,127,.18);color:inherit;text-decoration:none}',
      '#' + controlId + ' a:focus-visible{outline:2px solid #66afe9;outline-offset:-2px}',
      '#' + controlId + ' a:active{transform:translateY(1px)}',
      '@media(max-width:767px){#' + controlId + '{float:none;margin:8px 15px}}'
    ].join('');
    doc.head.appendChild(style);
  }

  function mount() {
    if (doc.getElementById(controlId)) return;
    var target = doc.querySelector('.navbar-right');
    if (!target) return;

    addStyles();
    var control = doc.createElement('nav');
    control.id = controlId;
    control.className = 'navbar-text';
    control.setAttribute('aria-label', 'User interface version');

    var current = doc.createElement('span');
    current.setAttribute('aria-current', 'page');
    current.title = 'Current UI';
    current.textContent = 'V1';

    var alternate = doc.createElement('a');
    alternate.href = v2Href();
    alternate.title = 'Open V2 UI';
    alternate.textContent = 'V2';

    control.appendChild(current);
    control.appendChild(alternate);
    target.insertBefore(control, target.querySelector('#clock'));
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
}());
