import * as ts from "typescript";
import * as vscode from "vscode";
import {
  extractValuesFromNode,
  findDeclarationInFile,
  findExportedDeclaration,
  findImportDeclaration,
  findNodeAtPosition,
} from "../utils/typescript-helpers";
import { resolveImportPath } from "./import-resolver";
import {
  extractValuesFromDeclaration,
  resolvePropertyValue,
} from "./value-extractor";

export async function resolveVariable(
  varExpression: string,
  position: vscode.Position | undefined,
  document: vscode.TextDocument,
  sourceFile: ts.SourceFile
): Promise<string[]> {
  if (varExpression.includes(".")) {
    if (position) {
      const hoverValues = await getTypeFromHover(document, position);
      if (hoverValues.length > 0) {
        return hoverValues;
      }
    }

    const propertyValues = await resolvePropertyAccess(
      varExpression,
      sourceFile,
      document
    );
    if (propertyValues.length > 0) {
      return propertyValues;
    }
  }

  if (position) {
    const languageServerValues = await tryLanguageServerProviders(
      document,
      position
    );
    if (languageServerValues.length > 0) {
      return languageServerValues;
    }
  }

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

      const typeMatch = hoverText.match(/:\s*(\w+)/);
      if (typeMatch) {
        const typeName = typeMatch[1];

        if (
          typeName.includes("Union") ||
          typeName.includes("Enum") ||
          typeName.includes("Type")
        ) {
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

      return parseHoverForUnionTypes(hovers[0]);
    }
  } catch (error) {
    console.error("[TypeParsing] Hover type resolution failed:", error);
  }

  return [];
}

async function tryLanguageServerProviders(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<string[]> {
  try {
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

    const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      document.uri,
      position
    );

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

async function extractValuesFromTypeLocation(
  location: vscode.Location | vscode.LocationLink
): Promise<string[]> {
  try {
    const uri = "uri" in location ? location.uri : location.targetUri;
    const range = "range" in location ? location.range : location.targetRange;

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

    const node = findNodeAtPosition(sourceFile, doc.offsetAt(range.start));

    if (!node) {
      return [];
    }

    return await extractValuesFromNode(
      node,
      sourceFile,
      doc,
      extractValuesFromDeclaration
    );
  } catch (error) {
    console.error("[TypeParsing] Extract from type location failed:", error);
    return [];
  }
}

function parseHoverForUnionTypes(hover: vscode.Hover): string[] {
  const hoverText = hover.contents
    .map((c) => (typeof c === "string" ? c : c.value))
    .join("\n");

  const unionMatches = Array.from(hoverText.matchAll(/"([^"]+)"/g));
  if (unionMatches.length > 1) {
    return unionMatches.map((match) => match[1]);
  }

  const singleLiteralMatch = hoverText.match(/:\s*"([^"]+)"/);
  if (singleLiteralMatch) {
    return [singleLiteralMatch[1]];
  }

  return [];
}

async function resolvePropertyAccess(
  expression: string,
  sourceFile: ts.SourceFile,
  document: vscode.TextDocument
): Promise<string[]> {
  const parts = expression.split(".");
  const objectName = parts[0];

  let objectDecl = findDeclarationInFile(sourceFile, objectName);
  let objectSourceFile = sourceFile;
  let objectDocument = document;

  if (!objectDecl) {
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
          objectDecl = findExportedDeclaration(importedSourceFile, objectName);
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

  if (objectDecl.type) {
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

async function resolveFromLocalScope(
  varName: string,
  sourceFile: ts.SourceFile,
  document: vscode.TextDocument
): Promise<string[]> {
  const declaration = findDeclarationInFile(sourceFile, varName);
  if (!declaration) {
    return [];
  }
  return await extractValuesFromDeclaration(declaration, sourceFile, document);
}

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
