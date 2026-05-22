import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const projectRoot = resolve(import.meta.dirname, '..');

const requiredComponents = [
  'src/components/nodel-console.ts',
  'src/components/nodel-log.ts',
  'src/components/nodel-editor.ts'
];

const forbiddenProperties = new Set(['innerHTML', 'outerHTML', 'textContent', 'value', 'checked']);
const forbiddenCalls = new Set(['insertAdjacentHTML', 'replaceChildren', 'createElement', 'appendChild', 'append', 'prepend']);

function lineAndColumn(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${position.line + 1}:${position.character + 1}`;
}

function propertyName(node) {
  return ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name) ? node.name.text : undefined;
}

function isAllowedPropertyAccess(node) {
  const name = propertyName(node);
  if (name !== 'value') {
    return false;
  }

  const expression = node.expression.getText();
  return expression === 'Number' || expression === 'Number.POSITIVE_INFINITY';
}

function validatePositiveRequirements(filePath, text, issues) {
  const requirements = [
    [/linkTemplate/, 'must import and call linkTemplate'],
    [/unlinkTemplate/, 'must import and call unlinkTemplate'],
    [/getJQuery/, 'must use getJQuery for observable updates'],
    [/data-link=/, 'must contain JsViews data-link markup'],
    [/\{\^\{/, 'must contain live JsViews tags such as {^{for}}, {^{if}}, or {^{>...}}'],
    [/linkTemplate\s*\(/, 'must call linkTemplate during component initialization'],
    [/unlinkTemplate\s*\(/, 'must call unlinkTemplate during cleanup'],
    [/\.observable\s*\(/, 'must update linked data through $.observable(...)']
  ];

  for (const [pattern, message] of requirements) {
    if (!pattern.test(text)) {
      issues.push(`${filePath}: ${message}.`);
    }
  }
}

function validateForbiddenPatterns(filePath, text, issues) {
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  function visit(node) {
    if (ts.isPropertyAccessExpression(node)) {
      const name = propertyName(node);
      if (name && forbiddenProperties.has(name) && !isAllowedPropertyAccess(node)) {
        issues.push(`${filePath}:${lineAndColumn(sourceFile, node)} direct DOM data/rendering property '.${name}' is forbidden in JsViews-linked components.`);
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = propertyName(node.expression);
      if (name && forbiddenCalls.has(name)) {
        issues.push(`${filePath}:${lineAndColumn(sourceFile, node.expression)} direct DOM rendering call '.${name}(...)' is forbidden in JsViews-linked components.`);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

async function main() {
  const issues = [];

  for (const filePath of requiredComponents) {
    const absolutePath = resolve(projectRoot, filePath);
    const text = await readFile(absolutePath, 'utf8');
    validatePositiveRequirements(filePath, text, issues);
    validateForbiddenPatterns(filePath, text, issues);
  }

  if (issues.length > 0) {
    console.error('JsViews template compliance check failed:');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('JsViews template compliance check passed.');
}

await main();
