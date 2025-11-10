import * as ts from "typescript";
import * as vscode from "vscode";
import {
  extractUnionTypesFromPosition,
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
  console.log(`[TypeParsing] Resolving variable: ${varExpression}`);

  if (position) {
    // For property access (e.g., lang.code), directly extract union types from hover
    if (varExpression.includes(".")) {
      console.log(
        `[TypeParsing] Property access detected, extracting union types from position`
      );
      const unionValues = await extractUnionTypesFromPosition(document, position);
      if (unionValues.length > 0) {
        console.log(`[TypeParsing] Union values from position:`, unionValues);
        return unionValues;
      }
    }

    // First try to use TypeScript's language service - this handles most cases
    const languageServiceValues = await getTypeFromLanguageService(
      varExpression,
      position,
      document
    );
    if (languageServiceValues.length > 0) {
      console.log(
        `[TypeParsing] Language service values:`,
        languageServiceValues
      );
      return languageServiceValues;
    }
  }

  // First try to resolve type assertions
  const typeAssertionValues = await resolveTypeAssertion(
    varExpression,
    sourceFile,
    document
  );
  if (typeAssertionValues.length > 0) {
    console.log(
      `[TypeParsing] Found type assertion values:`,
      typeAssertionValues
    );
    return typeAssertionValues;
  }

  if (varExpression.includes(".")) {
    console.log(
      `[TypeParsing] Variable contains dot, resolving property access`
    );

    if (position) {
      const hoverValues = await getTypeFromHover(document, position);
      if (hoverValues.length > 0) {
        console.log(`[TypeParsing] Found hover values:`, hoverValues);
        return hoverValues;
      }
    }

    const propertyValues = await resolvePropertyAccess(
      varExpression,
      sourceFile,
      document
    );
    if (propertyValues.length > 0) {
      console.log(
        `[TypeParsing] Found property access values:`,
        propertyValues
      );
      return propertyValues;
    }
  }

  if (position) {
    const languageServerValues = await tryLanguageServerProviders(
      document,
      position
    );
    if (languageServerValues.length > 0) {
      console.log(
        `[TypeParsing] Found language server values:`,
        languageServerValues
      );
      return languageServerValues;
    }
  }

  const localValues = await resolveFromLocalScope(
    varExpression,
    sourceFile,
    document
  );
  if (localValues.length > 0) {
    console.log(`[TypeParsing] Found local scope values:`, localValues);
    return localValues;
  }

  const importValues = await resolveFromImports(
    varExpression,
    sourceFile,
    document
  );
  console.log(`[TypeParsing] Import values:`, importValues);
  return importValues;
}

async function getTypeFromLanguageService(
  varExpression: string,
  position: vscode.Position,
  document: vscode.TextDocument
): Promise<string[]> {
  try {
    // Use VS Code's TypeScript language service
    const typeDefinitions = await vscode.commands.executeCommand<
      vscode.LocationLink[]
    >("vscode.executeTypeDefinitionProvider", document.uri, position);

    const completions =
      await vscode.commands.executeCommand<vscode.CompletionList>(
        "vscode.executeCompletionItemProvider",
        document.uri,
        position,
        "" // trigger character
      );

    // Try to get hover information which often contains union types
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      document.uri,
      position
    );

    if (hovers && hovers.length > 0) {
      const hoverText = hovers[0].contents
        .map((c) => (typeof c === "string" ? c : c.value))
        .join("\n");

      // Extract union type values from hover text
      const unionMatches = hoverText.match(/"([^"]+)"/g);
      if (unionMatches && unionMatches.length > 1) {
        return unionMatches.map((match) => match.replace(/"/g, ""));
      }

      // Extract single literal type
      const literalMatch = hoverText.match(/:\s*"([^"]+)"/);
      if (literalMatch) {
        return [literalMatch[1]];
      }
    }

    return [];
  } catch (error) {
    console.error("[TypeParsing] Language service failed:", error);
    return [];
  }
}

async function resolveTypeAssertion(
  varExpression: string,
  sourceFile: ts.SourceFile,
  document: vscode.TextDocument
): Promise<string[]> {
  console.log(`[TypeParsing] Resolving type assertion for: ${varExpression}`);

  // Find the variable declaration
  let declaration = findDeclarationInFile(sourceFile, varExpression);

  if (!declaration) {
    console.log(`[TypeParsing] No declaration found for: ${varExpression}`);
    return [];
  }

  console.log(
    `[TypeParsing] Found declaration type: ${ts.SyntaxKind[declaration.kind]}`
  );

  if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) {
    console.log(`[TypeParsing] Not a variable declaration or no initializer`);
    return [];
  }

  console.log(
    `[TypeParsing] Initializer type: ${
      ts.SyntaxKind[declaration.initializer.kind]
    }`
  );

  // Check if it's a type assertion (as Type)
  if (ts.isAsExpression(declaration.initializer)) {
    console.log(`[TypeParsing] Found type assertion`);
    const typeName = declaration.initializer.type.getText(sourceFile);
    console.log(`[TypeParsing] Type name: ${typeName}`);

    // Try to resolve the asserted type
    let typeDecl = findDeclarationInFile(sourceFile, typeName);
    let typeDeclSourceFile = sourceFile;
    let typeDeclDocument = document;

    if (!typeDecl) {
      console.log(`[TypeParsing] Type not found locally, checking imports`);
      try {
        const importDecl = findImportDeclaration(sourceFile, typeName);
        if (importDecl) {
          console.log(`[TypeParsing] Found import declaration`);
          const importPath = await resolveImportPath(importDecl, document);
          if (importPath) {
            console.log(
              `[TypeParsing] Resolved import path: ${importPath.fsPath}`
            );
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
            if (typeDecl) {
              console.log(
                `[TypeParsing] Found type declaration in imported file`
              );
              typeDeclSourceFile = importedSourceFile;
              typeDeclDocument = importedDoc;
            }
          }
        }
      } catch (error) {
        console.error(
          "[TypeParsing] Type assertion import resolution failed:",
          error
        );
      }
    } else {
      console.log(`[TypeParsing] Found type declaration locally`);
    }

    if (typeDecl) {
      console.log(`[TypeParsing] Extracting values from type declaration`);
      const values = await extractValuesFromDeclaration(
        typeDecl,
        typeDeclSourceFile,
        typeDeclDocument
      );
      console.log(`[TypeParsing] Extracted values:`, values);
      return values;
    } else {
      console.log(`[TypeParsing] No type declaration found`);
    }
  } else {
    console.log(`[TypeParsing] Not a type assertion expression`);
  }

  return [];
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
