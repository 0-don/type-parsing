// src/utils/typescript-helpers.ts - TypeScript AST helper functions
import * as ts from "typescript";
import * as vscode from "vscode";

/**
 * Find a declaration in a source file by name
 */
export function findDeclarationInFile(
  sourceFile: ts.SourceFile,
  name: string
): ts.Node | undefined {
  let found: ts.Node | undefined;

  function visit(node: ts.Node) {
    if (found) {
      return;
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found = node;
      return;
    }

    if (ts.isEnumDeclaration(node) && node.name.text === name) {
      found = node;
      return;
    }

    if (ts.isTypeAliasDeclaration(node) && node.name.text === name) {
      found = node;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/**
 * Find an import declaration for a specific variable name
 */
export function findImportDeclaration(
  sourceFile: ts.SourceFile,
  varName: string
): ts.ImportDeclaration | undefined {
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        const found = bindings.elements.find(
          (element) => element.name.text === varName
        );
        if (found) {
          return statement;
        }
      }
    }
  }
  return undefined;
}

/**
 * Find an exported declaration in a source file
 */
export function findExportedDeclaration(
  sourceFile: ts.SourceFile,
  name: string
): ts.Node | undefined {
  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      const found = statement.exportClause.elements.find(
        (element) => element.name.text === name
      );
      if (found) {
        return findDeclarationInFile(sourceFile, found.name.text);
      }
    }

    if (hasExportModifier(statement)) {
      if (ts.isVariableStatement(statement)) {
        const decl = statement.declarationList.declarations.find(
          (d) => ts.isIdentifier(d.name) && d.name.text === name
        );
        if (decl) {
          return decl;
        }
      }
      if (ts.isEnumDeclaration(statement) && statement.name.text === name) {
        return statement;
      }
      if (
        ts.isTypeAliasDeclaration(statement) &&
        statement.name.text === name
      ) {
        return statement;
      }
    }
  }

  return findDeclarationInFile(sourceFile, name);
}

/**
 * Check if a node has an export modifier
 */
export function hasExportModifier(node: ts.Node): boolean {
  return (
    (ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) ??
    false
  );
}

/**
 * Find a node at a specific position in the source file
 */
export function findNodeAtPosition(
  sourceFile: ts.SourceFile,
  position: number
): ts.Node | undefined {
  function find(node: ts.Node): ts.Node | undefined {
    if (position >= node.getStart() && position < node.getEnd()) {
      return ts.forEachChild(node, find) || node;
    }
  }
  return find(sourceFile);
}

/**
 * Extract string literals from a TypeScript type node
 */
export async function extractStringLiteralsFromType(
  typeNode: ts.TypeNode,
  sourceFile: ts.SourceFile,
  extractValuesFromDeclaration: (
    declaration: ts.Node,
    sourceFile: ts.SourceFile,
    document?: vscode.TextDocument
  ) => Promise<string[]>
): Promise<string[]> {
  if (ts.isUnionTypeNode(typeNode)) {
    return typeNode.types
      .filter((t) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))
      .map((t) =>
        (t as ts.LiteralTypeNode).literal.getText(sourceFile).replace(/"/g, "")
      );
  }

  if (
    ts.isIndexedAccessTypeNode(typeNode) &&
    ts.isTypeQueryNode(typeNode.objectType)
  ) {
    const exprName = typeNode.objectType.exprName;
    if (ts.isIdentifier(exprName)) {
      const objectDecl = findDeclarationInFile(sourceFile, exprName.text);
      if (objectDecl) {
        return await extractValuesFromDeclaration(objectDecl, sourceFile);
      }
    }
  }

  return [];
}

/**
 * Extract values from a TypeScript node by traversing up the AST
 */
export async function extractValuesFromNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  document: vscode.TextDocument,
  extractValuesFromDeclaration: (
    declaration: ts.Node,
    sourceFile: ts.SourceFile,
    document?: vscode.TextDocument
  ) => Promise<string[]>
): Promise<string[]> {
  let current: ts.Node | undefined = node;

  while (current) {
    const values = await extractValuesFromDeclaration(
      current,
      sourceFile,
      document
    );
    if (values.length > 0) {
      return values;
    }
    current = current.parent;
  }

  return [];
}
