import { Tree, joinPathFragments, workspaceRoot } from '@nx/devkit';
import { SyncError } from 'nx/src/utils/sync-generators';
import type { WorkspaceApp } from '@dxs/skaffold';
import { join, relative, sep } from 'path';
import * as ts from 'typescript';

// relative path from a Next.js app's own directory back to the workspace
// root, for its next.config.js's `outputFileTracingRoot` — in a monorepo,
// tracing otherwise defaults to the app's own directory, silently excluding
// workspace dependencies (and pnpm-hoisted node_modules) that live outside
// it from the standalone build. Computed via workspaceRoot rather than
// assuming a fixed nesting depth, so it stays correct regardless of how
// deep the app happens to live.
function getOutputFileTracingRootExpr(appRoot: string): string {
  const relativePath = relative(join(workspaceRoot, appRoot), workspaceRoot);
  const posixPath = relativePath.split(sep).join('/');
  return `path.join(__dirname, '${posixPath}')`;
}

// locates the object literal a next.config.js actually exports, handling
// both shapes @nx/next's own template (and most hand-written configs) use:
// `module.exports = { ... }` / `export default { ... }` directly, or via an
// intermediate `const nextConfig = { ... }` binding.
function findNextConfigObject(
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression | undefined {
  let exported: ts.Expression | undefined;

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      exported = statement.expression;
    } else if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(statement.expression.left) &&
      ts.isIdentifier(statement.expression.left.expression) &&
      statement.expression.left.expression.text === 'module' &&
      statement.expression.left.name.text === 'exports'
    ) {
      exported = statement.expression.right;
    }
  }

  if (!exported) {
    return undefined;
  }
  if (ts.isObjectLiteralExpression(exported)) {
    return exported;
  }
  if (!ts.isIdentifier(exported)) {
    return undefined;
  }

  const boundName = exported.text;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === boundName &&
        declaration.initializer &&
        ts.isObjectLiteralExpression(declaration.initializer)
      ) {
        return declaration.initializer;
      }
    }
  }

  return undefined;
}

function findNextConfigProperty(
  configObject: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  for (const property of configObject.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === name) ||
        (ts.isStringLiteral(property.name) && property.name.text === name))
    ) {
      return property;
    }
  }
  return undefined;
}

// whether the file's own export uses ES module syntax (`export default`)
// rather than CommonJS (`module.exports = `) — determines which form a
// newly-inserted `path` import should use, to match the file's own style.
function usesEsmExport(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(ts.isExportAssignment);
}

// true if the file already binds an identifier named `path` to the `path`
// module, via either `require('path')` or an ES import — needed alongside
// `outputFileTracingRoot`, which is always expressed as `path.join(...)`.
function hasPathModuleImport(sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'path'
    ) {
      return true;
    }
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'path' &&
        declaration.initializer &&
        ts.isCallExpression(declaration.initializer) &&
        ts.isIdentifier(declaration.initializer.expression) &&
        declaration.initializer.expression.text === 'require' &&
        declaration.initializer.arguments.length === 1 &&
        ts.isStringLiteral(declaration.initializer.arguments[0]) &&
        declaration.initializer.arguments[0].text === 'path'
      ) {
        return true;
      }
    }
  }
  return false;
}

type TextEdit = { start: number; end: number; text: string };

// overwrites the property's value if present (whatever it currently is —
// these two properties are generator-managed, unlike the rest of the file),
// or appends a new one right before the object literal's closing brace,
// preserving every other property, comment, and piece of formatting as-is.
function upsertNextConfigProperty(
  configObject: ts.ObjectLiteralExpression,
  name: string,
  valueText: string,
  edits: TextEdit[],
): void {
  const existing = findNextConfigProperty(configObject, name);
  if (existing) {
    if (existing.initializer.getText() !== valueText) {
      edits.push({
        start: existing.initializer.getStart(),
        end: existing.initializer.getEnd(),
        text: valueText,
      });
    }
    return;
  }

  const properties = configObject.properties;
  const needsLeadingComma =
    properties.length > 0 && !properties.hasTrailingComma;
  // `properties.end` (the NodeArray's own end, not the last element's)
  // already extends past an existing trailing comma when there is one —
  // inserting at the last property's own getEnd() instead would land
  // *before* that comma, leaving it orphaned between our insertion and
  // whatever edit updates that same last property's value
  const insertPos =
    properties.length > 0 ? properties.end : configObject.getStart() + 1;

  edits.push({
    start: insertPos,
    end: insertPos,
    text: `${needsLeadingComma ? ',' : ''}\n  ${name}: ${valueText},`,
  });
}

// maintain `output` and `outputFileTracingRoot` in the app's own
// next.config.js — everything else in that file is left exactly as the
// developer wrote it. Unlike the Dockerfile, this file is never fully
// generated/overwritten: these two properties are the only thing this
// adapter owns here.
export function syncNextConfig(tree: Tree, app: WorkspaceApp): void {
  const configPath = joinPathFragments(app.root, 'next.config.js');
  const outputFileTracingRootExpr = getOutputFileTracingRootExpr(app.root);

  if (!tree.exists(configPath)) {
    tree.write(
      configPath,
      `const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: ${outputFileTracingRootExpr},
};

module.exports = nextConfig;
`,
    );
    return;
  }

  const content = tree.read(configPath, 'utf-8') as string;
  const sourceFile = ts.createSourceFile(
    configPath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );

  const configObject = findNextConfigObject(sourceFile);
  if (!configObject) {
    throw new SyncError(
      `Could not find the exported Next.js config object in ${configPath}`,
      [
        `Expected either "module.exports = { ... }" or`,
        `"const x = { ... }; module.exports = x;" (or the "export default"`,
        `equivalent). Adjust the file to one of these shapes, or maintain`,
        `"output" and "outputFileTracingRoot" in it by hand.`,
      ],
    );
  }

  const edits: TextEdit[] = [];
  upsertNextConfigProperty(configObject, 'output', `'standalone'`, edits);
  upsertNextConfigProperty(
    configObject,
    'outputFileTracingRoot',
    outputFileTracingRootExpr,
    edits,
  );

  if (!hasPathModuleImport(sourceFile)) {
    const insertPos =
      sourceFile.statements.length > 0
        ? sourceFile.statements[0].getStart()
        : 0;
    const pathImportText = usesEsmExport(sourceFile)
      ? `import * as path from 'path';\n\n`
      : `const path = require('path');\n\n`;
    edits.push({
      start: insertPos,
      end: insertPos,
      text: pathImportText,
    });
  }

  if (edits.length === 0) {
    return;
  }

  // built by walking the edits in order against the original, untouched
  // `content` — never re-sliced against a progressively-mutated string,
  // since that breaks the moment two edits' start/end offsets coincide
  // (e.g. a value replacement ending exactly where a new property is
  // inserted right after it)
  edits.sort((a, b) => a.start - b.start);
  let newContent = '';
  let cursor = 0;
  for (const edit of edits) {
    newContent += content.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  newContent += content.slice(cursor);

  tree.write(configPath, newContent);
}
