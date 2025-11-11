import * as ts from "typescript";
import * as vscode from "vscode";
import { findImportDeclaration } from "../utils/typescript-helpers";
import { resolveImportPath } from "./import-resolver";

/**
 * Extract string literal values from a TypeScript declaration node.
 * Handles enums, union types, const objects, and typeof patterns.
 */
export async function extractValuesFromDeclaration(
  declaration: ts.Node,
  sourceFile: ts.SourceFile,
  document?: vscode.TextDocument
): Promise<string[]> {
  // Enums: enum Foo { A = "A", B = "B" }
  if (ts.isEnumDeclaration(declaration)) {
    return extractEnumValues(declaration, sourceFile);
  }

  // Variable declarations: const foo = { A: "A" } as const
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    return await extractFromVariableDeclaration(
      declaration,
      sourceFile,
      document
    );
  }

  // Type aliases: type Foo = "A" | "B" | (typeof X)[keyof typeof X]
  if (ts.isTypeAliasDeclaration(declaration)) {
    return await extractFromTypeAlias(declaration, sourceFile, document);
  }

  // Property signatures: interface { prop: "A" | "B" }
  if (ts.isPropertySignature(declaration) && declaration.type) {
    return await extractFromPropertySignature(
      declaration,
      sourceFile,
      document
    );
  }

  // Parameters: function foo(param: "A" | "B")
  if (ts.isParameter(declaration) && declaration.type) {
    return extractFromTypeNode(declaration.type, sourceFile);
  }

  return [];
}

/**
 * Extract values from enum declarations.
 */
function extractEnumValues(
  enumDecl: ts.EnumDeclaration,
  sourceFile: ts.SourceFile
): string[] {
  return enumDecl.members.map((member) =>
    member.initializer && ts.isStringLiteral(member.initializer)
      ? member.initializer.text
      : member.name.getText(sourceFile)
  );
}

/**
 * Extract values from variable declarations.
 */
async function extractFromVariableDeclaration(
  declaration: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
  document?: vscode.TextDocument
): Promise<string[]> {
  const initializer = declaration.initializer!;

  // Direct object literal: const foo = { A: "A", B: "B" }
  if (ts.isObjectLiteralExpression(initializer)) {
    return extractFromObjectLiteral(initializer, sourceFile);
  }

  // As const expression: const foo = { A: "A" } as const
  if (
    ts.isAsExpression(initializer) &&
    ts.isObjectLiteralExpression(initializer.expression)
  ) {
    return extractFromObjectLiteral(initializer.expression, sourceFile);
  }

  // String literal: const foo = "value"
  if (ts.isStringLiteral(initializer)) {
    return [initializer.text];
  }

  return [];
}

/**
 * Extract values from type alias declarations.
 */
async function extractFromTypeAlias(
  declaration: ts.TypeAliasDeclaration,
  sourceFile: ts.SourceFile,
  document?: vscode.TextDocument
): Promise<string[]> {
  const typeText = declaration.type.getText(sourceFile);

  // Handle typeof pattern: type T = (typeof X)[keyof typeof X]
  const typeofMatch = typeText.match(
    /\(typeof\s+(\w+)\)\[keyof\s+typeof\s+\w+\]/
  );
  if (typeofMatch) {
    const objectName = typeofMatch[1];
    const objectDecl = findConstObjectDeclaration(sourceFile, objectName);
    if (objectDecl) {
      const values = await extractFromVariableDeclaration(
        objectDecl,
        sourceFile,
        document
      );
      if (values.length > 0) {
        return values;
      }
    }
  }

  // Handle union types: type T = "A" | "B" | "C"
  return extractFromTypeNode(declaration.type, sourceFile);
}

/**
 * Extract values from property signatures.
 */
async function extractFromPropertySignature(
  declaration: ts.PropertySignature,
  sourceFile: ts.SourceFile,
  document?: vscode.TextDocument
): Promise<string[]> {
  const typeName = declaration.type!.getText(sourceFile);

  // Try to find and resolve the type declaration
  const typeDecl = findDeclaration(sourceFile, typeName);
  if (typeDecl) {
    const values = await extractValuesFromDeclaration(
      typeDecl,
      sourceFile,
      document
    );
    if (values.length > 0) {
      return values;
    }
  }

  // If it's a union type node, extract directly
  if (declaration.type && ts.isUnionTypeNode(declaration.type)) {
    return extractFromTypeNode(declaration.type, sourceFile);
  }

  return [];
}

/**
 * Extract string literals from a type node (union types, literal types, etc.)
 */
function extractFromTypeNode(
  typeNode: ts.TypeNode,
  sourceFile: ts.SourceFile
): string[] {
  // Union type: "A" | "B" | "C"
  if (ts.isUnionTypeNode(typeNode)) {
    return typeNode.types
      .filter((t) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))
      .map((t) =>
        (t as ts.LiteralTypeNode).literal.getText(sourceFile).replace(/"/g, "")
      );
  }

  // Single literal type: "value"
  if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) {
    return [typeNode.literal.text];
  }

  return [];
}

/**
 * Extract property names from an object literal expression.
 */
function extractFromObjectLiteral(
  objectLiteral: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile
): string[] {
  return objectLiteral.properties
    .filter(ts.isPropertyAssignment)
    .map((prop) => prop.name.getText(sourceFile).replace(/"/g, ""));
}

/**
 * Find a const object declaration (for typeof patterns).
 * Specifically looks for const variable declarations with object literal initializers.
 */
export function findConstObjectDeclaration(
  sourceFile: ts.SourceFile,
  name: string
): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;

  function visit(node: ts.Node) {
    if (found) return;

    if (ts.isVariableStatement(node)) {
      const declaration = node.declarationList.declarations.find((decl) => {
        if (
          !ts.isIdentifier(decl.name) ||
          decl.name.text !== name ||
          !decl.initializer
        ) {
          return false;
        }

        // Direct object literal or "as const" pattern
        return (
          ts.isObjectLiteralExpression(decl.initializer) ||
          (ts.isAsExpression(decl.initializer) &&
            ts.isObjectLiteralExpression(decl.initializer.expression))
        );
      });

      if (declaration) {
        found = declaration;
        return;
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/**
 * Find any declaration (variable, enum, type alias) in the source file.
 */
function findDeclaration(
  sourceFile: ts.SourceFile,
  name: string
): ts.Node | undefined {
  let found: ts.Node | undefined;

  function visit(node: ts.Node) {
    if (found) return;

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
