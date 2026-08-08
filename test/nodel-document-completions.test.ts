import { CompletionContext } from '@codemirror/autocomplete';
import { htmlLanguage } from '@codemirror/lang-html';
import { xmlLanguage } from '@codemirror/lang-xml';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { authoredPageHead, authoredPageScaffold, completeNodelDocument } from '../src/editor/nodel-document-definition';
import { nodelHtmlCompletionSource } from '../src/editor/nodel-html-document-support';
import { nodelXmlCompletionSource } from '../src/editor/nodel-xml-document-support';

function context(text: string, language: typeof htmlLanguage | typeof xmlLanguage = htmlLanguage, explicit = true) {
  const state = EditorState.create({ doc: text, extensions: [language] });
  return new CompletionContext(state, text.length, explicit);
}

function result(text: string, source = completeNodelDocument, language = htmlLanguage) {
  const value = source(context(text, language));
  if (!value || value instanceof Promise) throw new Error('Expected synchronous completion result');
  return value;
}

function applyOption(text: string, label: string, source = nodelHtmlCompletionSource, language = htmlLanguage) {
  const host = document.createElement('div');
  document.body.append(host);
  const state = EditorState.create({ doc: text, extensions: [language] });
  const view = new EditorView({ state, parent: host });
  const completion = source(new CompletionContext(view.state, view.state.doc.length, true));
  if (!completion || completion instanceof Promise) throw new Error('Expected synchronous completion result');
  const option = completion.options.find((item) => item.label === label);
  if (!option) throw new Error(`Missing completion ${label}`);
  if (typeof option.apply === 'function') option.apply(view, option, completion.from, completion.to ?? view.state.doc.length);
  else {
    const insert = typeof option.apply === 'string' ? option.apply : option.label;
    view.dispatch({ changes: { from: completion.from, to: completion.to ?? view.state.doc.length, insert }, selection: { anchor: completion.from + insert.length } });
  }
  const output = { text: view.state.doc.toString(), cursor: view.state.selection.main.head };
  view.destroy();
  host.remove();
  return output;
}

describe('native Nodel document completions', () => {
  it('keeps native HTML completion alongside recommended and hidden Nodel tags', () => {
    const completion = result('<sec', nodelHtmlCompletionSource);
    const labels = completion.options.map((option) => option.label);
    expect(labels).toContain('section');
    expect(labels).toContain('nodel-button');
    expect(labels).not.toContain('nodel-toast-host');
    expect(new Set(labels).size).toBe(labels.length);
    expect(completion.options.find((option) => option.label === 'nodel-button')?.boost).toBeGreaterThan(0);
    expect(completion.options.find((option) => option.label === 'nodel-console')?.boost).toBeLessThan(0);
    expect(completion.options.find((option) => option.label === 'nodel-template')?.info).toContain('{{item}}');
    const ordinary = result('<di', nodelHtmlCompletionSource);
    expect(ordinary.options.map((option) => option.label)).toContain('div');
    expect(result('<div cl', nodelHtmlCompletionSource).options.map((option) => option.label)).toContain('class');
    expect(result('<div signal="', nodelHtmlCompletionSource).options.map((option) => option.label)).not.toContain('signals');
  });

  it('uses syntax-tree ranges and metadata for multiline quoted attributes', () => {
    const completion = result('<nodel-button\n  va', nodelHtmlCompletionSource);
    expect(completion.from).toBe('<nodel-button\n  '.length);
    expect(completion.to).toBe('<nodel-button\n  va'.length);
    const signal = result('<nodel-button\n  action="thing:c', nodelHtmlCompletionSource);
    expect(signal.from).toBe('<nodel-button\n  action="thing:'.length);
    expect(signal.options.map((option) => option.label)).toEqual(expect.arrayContaining(['click', 'press', 'release']));
    expect(signal.options[0]?.detail).toContain('phase');
    expect(result('<nodel-button sig', nodelHtmlCompletionSource).options.find((option) => option.label === 'signals')?.detail).toContain('syntax:');
  });

  it('uses XML schema completion without removing native XML closing behavior', () => {
    const completion = result('<nodel-button si', nodelXmlCompletionSource, xmlLanguage);
    expect(completion.options.map((option) => option.label)).toContain('signal');
    expect(completion.options.find((option) => option.label === 'signal')?.detail).toContain('dynamic');
    const closing = result('<nodel-page></', nodelXmlCompletionSource, xmlLanguage);
    expect(closing.options.map((option) => option.label)).toContain('nodel-page>');
    expect(closing.options.find((option) => option.label === 'nodel-page>')?.apply).toBeUndefined();
  });

  it('adds XML-only binding hints without replacing XML native ranges', () => {
    const phase = result('<nodel-button signal="value:la', nodelXmlCompletionSource, xmlLanguage);
    expect(phase.from).toBe('<nodel-button signal="value:'.length);
    expect(phase.options.map((option) => option.label)).toContain('active');
    const classes = result('<nodel-button class="nodel-button ', nodelXmlCompletionSource, xmlLanguage);
    expect(classes.options.map((option) => option.label)).toContain('is-disabled');
    const selfClosingClasses = result('<nodel-button class="nodel-button  ', nodelXmlCompletionSource, xmlLanguage);
    expect(selfClosingClasses.options.map((option) => option.label)).toContain('is-disabled');
    expect(result('<nodel-toggle value="o', nodelXmlCompletionSource, xmlLanguage).options.map((option) => option.label)).toContain('"off"');
    expect(nodelXmlCompletionSource(context('<nodel-button value="o', xmlLanguage))).toBeNull();
  });

  it('completes signal targets, aggregation, classes, and static page ids', () => {
    const target = result('<nodel-button signal="name:', nodelHtmlCompletionSource);
    expect(target.options.map((option) => option.label)).toEqual(expect.arrayContaining(['active', 'disabled']));
    const aggregate = result('<nodel-button signal="name:active(', nodelHtmlCompletionSource);
    expect(aggregate.options.map((option) => option.label)).toEqual(expect.arrayContaining(['any', 'all']));
    const classes = result('<nodel-button class="nodel-button ', nodelHtmlCompletionSource);
    expect(classes.from).toBe('<nodel-button class="nodel-button '.length);
    expect(classes.options.map((option) => option.label)).not.toContain('nodel-button');
    expect(classes.options.map((option) => option.label)).toContain('is-disabled');
    const ids = result('<nodel-page title="Main Page" nav-id="main"></nodel-page><nodel-page title="Other Page"></nodel-page><div id="static-id"></div><nodel-link href="#', nodelHtmlCompletionSource);
    expect(ids.options.map((option) => option.label)).toContain('OtherPage');
    expect(ids.options.map((option) => option.label)).toContain('main');
    expect(ids.options.map((option) => option.label)).toContain('static-id');
    expect(result('<nodel-page title="Own Page" nav-id="own"', nodelHtmlCompletionSource).options).toEqual([]);
    expect(result('<nodel-row signals="Ready:', nodelHtmlCompletionSource).options.map((option) => option.label)).toEqual(['visibility']);
    expect(result('<nodel-button join="Run:', nodelHtmlCompletionSource).options).toEqual([]);
    expect(result('<nodel-button actions="First:click;Second', nodelHtmlCompletionSource).options).toEqual([]);
    const ambiguous = result('<nodel-page nav-id="same"></nodel-page><nodel-page nav-id="same"></nodel-page><nodel-link href="#', nodelHtmlCompletionSource);
    expect(ambiguous.options.map((option) => option.label)).not.toContain('same');
    const explicitDerived = result('<nodel-page nav-id="same"></nodel-page><nodel-page title="same"></nodel-page><nodel-link href="#', nodelHtmlCompletionSource);
    expect(explicitDerived.options.map((option) => option.label)).not.toContain('same');
    const pageStatic = result('<nodel-page title="Static"></nodel-page><div id="Static"></div><nodel-link href="#', nodelHtmlCompletionSource);
    expect(pageStatic.options.map((option) => option.label)).not.toContain('Static');
    const duplicateStatic = result('<div id="duplicate"></div><span id="duplicate"></span><nodel-link href="#', nodelHtmlCompletionSource);
    expect(duplicateStatic.options.map((option) => option.label)).not.toContain('duplicate');
  });

  it('applies snippets and keeps the shared authored-page document structurally valid', () => {
    const page = applyOption('', 'nodel page scaffold');
    expect(page.text).not.toContain('${');
    expect(page.text).toContain('<nodel-column>');
    expect(page.cursor).toBeGreaterThan(page.text.indexOf('<nodel-column>'));
    expect(page.cursor).toBeLessThan(page.text.indexOf('</nodel-column>'));
    const document = applyOption('', 'nodel custom page head');
    expect(document.text).toBe(authoredPageScaffold);
    expect(document.cursor).toBeGreaterThan(document.text.indexOf('<nodel-column>'));
    expect(document.cursor).toBeLessThan(document.text.indexOf('</nodel-column>'));
    expect(authoredPageScaffold).toBe(`${authoredPageHead}\n<body>\n  <nodel-app>\n    <nodel-toolbar></nodel-toolbar>\n    <nodel-page title="Page">\n      <nodel-row>\n        <nodel-column>\n          \n        </nodel-column>\n      </nodel-row>\n    </nodel-page>\n  </nodel-app>\n</body>\n</html>`);
    expect(authoredPageHead.indexOf('<link')).toBeLessThan(authoredPageHead.indexOf('nodel-webui.js'));
    expect(authoredPageHead).toContain('<!doctype html>');
    expect(authoredPageHead).toContain('<html lang="en">');
    expect(authoredPageHead).toContain('name="viewport"');
    expect(authoredPageScaffold).not.toContain('${');
  });

  it('applies native structural completions without doubled delimiters', () => {
    expect(applyOption('<', 'div')).toEqual({ text: '<div', cursor: 4 });
    expect(applyOption('<nodel-b', 'nodel-button')).toEqual({ text: '<nodel-button', cursor: 13 });
    expect(applyOption('<nodel-button variant="pr', 'primary')).toEqual({ text: '<nodel-button variant="primary"', cursor: 31 });
    expect(applyOption("<nodel-button variant='pr", 'primary')).toEqual({ text: "<nodel-button variant='primary'", cursor: 31 });
    expect(applyOption('<nodel-page></', 'nodel-page>', nodelXmlCompletionSource, xmlLanguage)).toEqual({ text: '<nodel-page></nodel-page>', cursor: 25 });
    expect(applyOption('<nodel-button\n  variant="pr', 'primary')).toEqual({ text: '<nodel-button\n  variant="primary"', cursor: 33 });
  });
});
