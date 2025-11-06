// src/resolvers/variable-resolver.ts - Variable resolution logic
import * as ts from "typescript";
import * as vscode from "vscode";
import { findDeclarationInFile, findImportDeclaration, findExportedDeclaration, findNodeAtPosition, extractValuesFromNode } from "../utils/typescript-helpers";
import { resolveImportPath } from "./import-resolver";
import { extractValuesFromDeclaration, resolvePropertyValue } from "./value-extractor";

/**
 * Main entry point for resolving a variable expression to its possible values
 */
export async function resolveVariable(
  varExpression: string,
  position: vscode.Position | undefined,
  document: vscode.TextDocument,
  sourceFile: ts.SourceFile
): Promise<string[]> {
  // For property access, use a hybrid approach
  if (varExpression.includes(".")) {
    // First try to get type info from hover (which shows the actual type)
    if (position) {
      const hoverValues = await getTypeFromHover(document, position);
      if (hoverValues.length > 0) {
        return hoverValues;
      }
    }

    // Fallback to manual property resolution
    const propertyValues = await resolvePropertyAccess(
      varExpression,
      sourceFile,
      document
    );
    if (propertyValues.length > 0) {
      return propertyValues;
    }
  }

  // For simple variables, use language server first
  if (position) {
    const languageServerValues = await tryLanguageServerProviders(
      document,
      position
    );
    if (languageServerValues.length > 0) {
      return languageServerValues;
    }
  }

  // Fallback strategies
  const localValues = await resolveFromLocalScope(
    varExpression,
    sourceFile,
    document
  );
  if (localValues.length > 0) {
    return localValues;
  }

  const importValues = await resolveFromImports(
    varExpression,
    sourceFile,
    document
  );
  return importValues;
}

/**
 * Get type information from VSCode hover provider
 */
async function getTypeFromHover(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<string[]> {
  try {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      document.uri,
      position
    );

    if (hovers?.length) {
      const hoverText = hovers[0].contents
        .map((c) => (typeof c === "string" ? c : c.value))
        .join("\n");

      // Look for type annotations like: (property) exchangeType: ExchangeTypeUnion
      const typeMatch = hoverText.match(/:\s*(\w+)/);
      if (typeMatch) {
        const typeName = typeMatch[1];

        // If it's a union or enum type, try to resolve it
        if (
          typeName.includes("Union") ||
          typeName.includes("Enum") ||
          typeName.includes("Type")
        ) {
          // Look for the type definition in current file or imports
          const sourceFile = ts.createSourceFile(
            document.fileName,
            document.getText(),
            ts.ScriptTarget.Latest,
            true
          );

          let typeDecl = findDeclarationInFile(sourceFile, typeName);
          let typeDeclSourceFile = sourceFile;
          let typeDeclDocument = document;

          if (!typeDecl) {
            // Try to find in imports
            const importDecl = findImportDeclaration(sourceFile, typeName);
            if (importDecl) {
              const importPath = await resolveImportPath(importDecl, document);
              if (importPath) {
                const importedDoc = await vscode.workspace.openTextDocument(
                  importPath
                );
                const importedSourceFile = ts.createSourceFile(
                  importedDoc.fileName,
                  importedDoc.getText(),
                  ts.ScriptTarget.Latest,
                  true
                );
                typeDecl = findExportedDeclaration(
                  importedSourceFile,
                  typeName
                );
                if (typeDecl) {
                  typeDeclSourceFile = importedSourceFile;
                  typeDeclDocument = importedDoc;
                }
              }
            }
          }

          if (typeDecl) {
            const values = await extractValuesFromDeclaration(
              typeDecl,
              typeDeclSourceFile,
              typeDeclDocument
            );
            if (values.length > 0) {
              return values;
            }
          }
        }
      }

      // Fallback to parsing union types directly from hover
      return parseHoverForUnionTypes(hovers[0]);
    }
  } catch (error) {
    console.error("[TypeParsing] Hover type resolution failed:", error);
  }

  return [];
}

/**
 * Try using VSCode's language server providers to get type information
 */
async function tryLanguageServerProviders(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<string[]> {
  try {
    // Try type definition provider first
    const typeDefs = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeTypeDefinitionProvider",
      document.uri,
      position
    );

    if (typeDefs?.[0]) {
      const values = await extractValuesFromTypeLocation(typeDefs[0]);
      if (values.length > 0) {
        return values;
      }
    }

    // Try definition provider as fallback
    const definitions = await vscode.commands.executeCommand<
      vscode.Location[]
    >("vscode.executeDefinitionProvider", document.uri, position);

    if (definitions?.[0]) {
      const values = await extractValuesFromTypeLocation(definitions[0]);
      if (values.length > 0) {
        return values;
      }
    }
  } catch (error) {
    console.error("[TypeParsing] Language server error:", error);
  }

  return [];
}

/**
 * Extract values from a type location returned by language server
 */
async function extractValuesFromTypeLocation(
  location: vscode.Location | vscode.LocationLink
): Promise<string[]> {
  try {
    // Handle both Location and LocationLink
    const uri = 'uri' in location ? location.uri : location.targetUri;
    const range = 'range' in location ? location.range : location.targetRange;

    if (!uri || !range) {
      return [];
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const sourceFile = ts.createSourceFile(
      doc.fileName,
      doc.getText(),
      ts.ScriptTarget.Latest,
      true
    );

    const node = findNodeAtPosition(
      sourceFile,
      doc.offsetAt(range.start)
    );

    if (!node) {
      return [];
    }

    return await extractValuesFromNode(node, sourceFile, doc, extractValuesFromDeclaration);
  } catch (error) {
    console.error("[TypeParsing] Extract from type location failed:", error);
    return [];
  }
}

/**
 * Parse hover text for union types
 */
function parseHoverForUnionTypes(hover: vscode.Hover): string[] {
  const hoverText = hover.contents
    .map((c) => (typeof c === "string" ? c : c.value))
    .join("\n");

  // Look for union type patterns like: "MEXC" | "BYBIT" | "PHEMEX"
  const unionMatches = Array.from(hoverText.matchAll(/"([^"]+)"/g));
  if (unionMatches.length > 1) {
    return unionMatches.map((match) => match[1]);
  }

  // Look for single string literal type
  const singleLiteralMatch = hoverText.match(/:\s*"([^"]+)"/);
  if (singleLiteralMatch) {
    return [singleLiteralMatch[1]];
  }

  return [];
}

/**
 * Resolve property access expressions (e.g., obj.property)
 */
async function resolvePropertyAccess(
  expression: string,
  sourceFile: ts.SourceFile,
  document: vscode.TextDocument
): Promise<string[]> {
  const parts = expression.split(".");
  const objectName = parts[0];

  // Find the object declaration - first in local file, then in imports
  let objectDecl = findDeclarationInFile(sourceFile, objectName);
  let objectSourceFile = sourceFile;
  let objectDocument = document;

  if (!objectDecl) {
    // Try to find in imports
    const importDecl = findImportDeclaration(sourceFile, objectName);
    if (importDecl) {
      const importPath = await resolveImportPath(importDecl, document);
      if (importPath) {
        try {
          const importedDoc = await vscode.workspace.openTextDocument(
            importPath
          );
          const importedSourceFile = ts.createSourceFile(
            importedDoc.fileName,
            importedDoc.getText(),
            ts.ScriptTarget.Latest,
            true
          );
          objectDecl = findExportedDeclaration(
            importedSourceFile,
            objectName
          );
          if (objectDecl) {
            objectSourceFile = importedSourceFile;
            objectDocument = importedDoc;
          }
        } catch (error) {
          console.error("[TypeParsing] Import resolution failed:", error);
        }
      }
    }
  }

  if (
    !objectDecl ||
    !ts.isVariableDeclaration(objectDecl) ||
    !objectDecl.initializer
  ) {
    return [];
  }

  // Look for type annotation on the object declaration
  if (objectDecl.type) {
    // If there's an explicit type annotation, use that
    const typeName = objectDecl.type.getText(objectSourceFile);
    let typeDecl = findDeclarationInFile(objectSourceFile, typeName);

    if (!typeDecl) {
      const importDecl = findImportDeclaration(objectSourceFile, typeName);
      if (importDecl) {
        const importPath = await resolveImportPath(importDecl, objectDocument);
        if (importPath) {
          const importedDoc = await vscode.workspace.openTextDocument(
            importPath
          );
          const importedSourceFile = ts.createSourceFile(
            importedDoc.fileName,
            importedDoc.getText(),
            ts.ScriptTarget.Latest,
            true
          );
          typeDecl = findExportedDeclaration(importedSourceFile, typeName);
        }
      }
    }

    if (typeDecl) {
      return await extractValuesFromDeclaration(
        typeDecl,
        objectSourceFile,
        objectDocument
      );
    }
  }

  // Fallback to examining the property itself
  if (ts.isObjectLiteralExpression(objectDecl.initializer)) {
    const propertyName = parts[1];
    const property = objectDecl.initializer.properties.find(
      (prop) =>
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === propertyName
    );

    if (property && ts.isPropertyAssignment(property)) {
      return await resolvePropertyValue(
        property,
        objectSourceFile,
        objectDocument
      );
    }
  }

  return [];
}

/**
 * Resolve variable from local scope
 */
async function resolveFromLocalScope(
  varName: string,
  sourceFile: ts.SourceFile,
  document: vscode.TextDocument
): Promise<string[]> {
  const declaration = findDeclarationInFile(sourceFile, varName);
  if (!declaration) {
    return [];
  }
  return await extractValuesFromDeclaration(
    declaration,
    sourceFile,
    document
  );
}

/**
 * Resolve variable from imports
 */
async function resolveFromImports(
  varName: string,
  sourceFile: ts.SourceFile,
  document: vscode.TextDocument
): Promise<string[]> {
  const importDecl = findImportDeclaration(sourceFile, varName);
  if (!importDecl) {
    return [];
  }

  try {
    const importPath = await resolveImportPath(importDecl, document);
    if (!importPath) {
      return [];
    }

    const importedDoc = await vscode.workspace.openTextDocument(importPath);
    const importedSourceFile = ts.createSourceFile(
      importedDoc.fileName,
      importedDoc.getText(),
      ts.ScriptTarget.Latest,
      true
    );

    const exportedDecl = findExportedDeclaration(importedSourceFile, varName);
    if (exportedDecl) {
      return await extractValuesFromDeclaration(
        exportedDecl,
        importedSourceFile,
        importedDoc
      );
    }
  } catch (error) {
    console.error("[TypeParsing] Import resolution failed:", error);
  }

  return [];
}
