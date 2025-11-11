import * as ts from "typescript";
import * as vscode from "vscode";
import { extractUnionTypesFromPosition } from "../utils/typescript-helpers";
import { extractValuesFromDeclaration } from "./value-extractor";

/**
 * Main entry point for resolving variable types to their possible values.
 * Uses a simplified strategy that relies primarily on VSCode's language service.
 */
export async function resolveVariable(
  varExpression: string,
  position: vscode.Position | undefined,
  document: vscode.TextDocument,
  sourceFile: ts.SourceFile
): Promise<string[]> {
  // Strategy 1: Use VSCode's language service (hover/type definitions)
  // This handles ~90% of cases including:
  // - Simple variables with union types
  // - Property access (obj.prop)
  // - Function parameters
  // - Typeof patterns
  // - Enums
  if (position) {
    const values = await extractUnionTypesFromPosition(document, position);
    if (values.length > 0) {
      return values;
    }
  }

  // Strategy 2: Fallback to AST-based resolution for edge cases
  // This handles cases where the language service doesn't provide hover info
  const astValues = await resolveViaAST(varExpression, sourceFile, document);
  if (astValues.length > 0) {
    return astValues;
  }

  return [];
}

/**
 * Fallback AST-based resolution for cases where language service fails.
 * This is rare but handles edge cases like variables in certain scopes.
 */
async function resolveViaAST(
  varExpression: string,
  sourceFile: ts.SourceFile,
  document: vscode.TextDocument
): Promise<string[]> {
  // Handle property access (e.g., "obj.prop")
  if (varExpression.includes(".")) {
    const parts = varExpression.split(".");
    const [objectName] = parts;

    // Try to find the declaration in the current file
    const declaration = findVariableDeclaration(sourceFile, objectName);
    if (declaration) {
      return await extractValuesFromDeclaration(declaration, sourceFile, document);
    }
  }

  // Handle simple identifiers
  const declaration = findVariableDeclaration(sourceFile, varExpression);
  if (declaration) {
    // Special case: Check if this is a parameter from Object.values().forEach()
    if (ts.isParameter(declaration)) {
      const objectValuesType = findObjectValuesEnum(declaration, sourceFile);
      if (objectValuesType) {
        const values = await resolveEnumOrTypeDeclaration(
          objectValuesType,
          sourceFile,
          document
        );
        if (values.length > 0) {
          return values;
        }
      }
    }

    return await extractValuesFromDeclaration(declaration, sourceFile, document);
  }

  return [];
}

/**
 * Resolve an enum or type declaration, checking both local and imported declarations.
 */
async function resolveEnumOrTypeDeclaration(
  typeName: string,
  sourceFile: ts.SourceFile,
  document: vscode.TextDocument
): Promise<string[]> {
  // First, try to find it in the current file
  const localDecl = findVariableDeclaration(sourceFile, typeName);
  if (localDecl) {
    return await extractValuesFromDeclaration(localDecl, sourceFile, document);
  }

  // If not found locally, check if it's imported
  const { findImportDeclaration } = await import("../utils/typescript-helpers.js");
  const { resolveImportPath } = await import("./import-resolver.js");

  const importDecl = findImportDeclaration(sourceFile, typeName);
  if (importDecl) {
    try {
      const importPath = await resolveImportPath(importDecl, document);
      if (importPath) {
        const importedDoc = await vscode.workspace.openTextDocument(importPath);
        const importedSourceFile = ts.createSourceFile(
          importedDoc.fileName,
          importedDoc.getText(),
          ts.ScriptTarget.Latest,
          true
        );

        const { findExportedDeclaration } = await import("../utils/typescript-helpers.js");
        const importedDecl = findExportedDeclaration(importedSourceFile, typeName);
        if (importedDecl) {
          return await extractValuesFromDeclaration(
            importedDecl,
            importedSourceFile,
            importedDoc
          );
        }
      }
    } catch (error) {
      // Import resolution failed
    }
  }

  return [];
}

/**
 * Find if a parameter comes from Object.values(EnumName).forEach()
 * Returns the enum name if found.
 */
function findObjectValuesEnum(
  parameter: ts.ParameterDeclaration,
  sourceFile: ts.SourceFile
): string | undefined {
  // Walk up the AST to find the arrow function or function expression
  let parent = parameter.parent;

  // Parameter -> Arrow/Function -> CallExpression (forEach)
  if (!parent || !(ts.isArrowFunction(parent) || ts.isFunctionExpression(parent))) {
    return undefined;
  }

  const functionParent = parent.parent;

  // Check if this is a .forEach() call
  if (!ts.isCallExpression(functionParent)) {
    return undefined;
  }

  const callExpr = functionParent;

  // Check if it's a property access (something.forEach)
  if (!ts.isPropertyAccessExpression(callExpr.expression)) {
    return undefined;
  }

  const propertyAccess = callExpr.expression;

  // Check if the method is "forEach"
  if (propertyAccess.name.text !== "forEach") {
    return undefined;
  }

  // Check if the expression is Object.values(...)
  if (!ts.isCallExpression(propertyAccess.expression)) {
    return undefined;
  }

  const objectValuesCall = propertyAccess.expression;

  // Check if it's Object.values
  if (!ts.isPropertyAccessExpression(objectValuesCall.expression)) {
    return undefined;
  }

  const objectProperty = objectValuesCall.expression;

  if (
    !ts.isIdentifier(objectProperty.expression) ||
    objectProperty.expression.text !== "Object" ||
    objectProperty.name.text !== "values"
  ) {
    return undefined;
  }

  // Get the argument to Object.values()
  const args = objectValuesCall.arguments;
  if (args.length !== 1) {
    return undefined;
  }

  const arg = args[0];
  if (ts.isIdentifier(arg)) {
    return arg.text;
  }

  return undefined;
}

/**
 * Find a variable declaration in the source file.
 * Simplified version that only looks for variable declarations.
 */
function findVariableDeclaration(
  sourceFile: ts.SourceFile,
  name: string
): ts.Node | undefined {
  let found: ts.Node | undefined;

  function visit(node: ts.Node) {
    if (found) return;

    // Variable declarations
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found = node;
      return;
    }

    // Enum declarations
    if (ts.isEnumDeclaration(node) && node.name.text === name) {
      found = node;
      return;
    }

    // Type alias declarations
    if (ts.isTypeAliasDeclaration(node) && node.name.text === name) {
      found = node;
      return;
    }

    // Parameters (for destructured params, etc.)
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}
