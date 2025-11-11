import * as ts from "typescript";
import * as vscode from "vscode";
import { resolveImportPath } from "../resolvers/import-resolver";

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

export function hasExportModifier(node: ts.Node): boolean {
  return (
    (ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) ??
    false
  );
}

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

export async function extractUnionTypesFromPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<string[]> {
  try {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      document.uri,
      position
    );

    if (!hovers || hovers.length === 0) {
      console.log("[TypeParsing] No hover information available");
      return [];
    }

    let hoverText = hovers[0].contents
      .map((c) => (typeof c === "string" ? c : c.value))
      .join("\n");

    // If hover is still loading, wait a bit and try again
    if (hoverText.includes("loading")) {
      console.log("[TypeParsing] Hover still loading, retrying...");
      await new Promise(resolve => setTimeout(resolve, 100));

      const retriedHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        document.uri,
        position
      );

      if (retriedHovers && retriedHovers.length > 0) {
        hoverText = retriedHovers[0].contents
          .map((c) => (typeof c === "string" ? c : c.value))
          .join("\n");
      }
    }

    console.log("[TypeParsing] Hover text:", hoverText);

    // Skip if still loading or shows 'any'
    if (hoverText.includes("loading") || hoverText.includes(") any")) {
      console.log("[TypeParsing] Hover not ready or shows 'any', falling back to AST parsing");
      return [];
    }

    // Extract union type values from hover text
    // Matches patterns like: code: "DE" | "EN" or (property) code: "DE" | "EN"
    const unionMatches = Array.from(hoverText.matchAll(/"([^"]+)"/g));
    console.log("[TypeParsing] Union matches found:", unionMatches.length);

    if (unionMatches.length > 1) {
      const values = unionMatches.map((match) => match[1]);
      console.log("[TypeParsing] Extracted union values:", values);
      return values;
    }

    // Check if it's a single literal type
    const literalMatch = hoverText.match(/:\s*"([^"]+)"/);
    if (literalMatch) {
      console.log("[TypeParsing] Single literal value:", literalMatch[1]);
      return [literalMatch[1]];
    }

    // If hover shows a type reference (e.g., "type: FilterType"), try to get type definition
    const typeRefMatch = hoverText.match(/:\s*(\w+)\s*$/m);
    if (typeRefMatch) {
      const typeName = typeRefMatch[1];
      console.log("[TypeParsing] Found type reference:", typeName);

      // Don't try to resolve primitive types or common generic types
      if (['string', 'number', 'boolean', 'any', 'unknown', 'void', 'never', 'Array', 'Promise'].includes(typeName)) {
        console.log("[TypeParsing] Skipping primitive/generic type:", typeName);
        return [];
      }

      // Use VS Code's type definition provider to get the expanded type
      try {
        const typeDefinitions = await vscode.commands.executeCommand<
          (vscode.Location | vscode.LocationLink)[]
        >("vscode.executeTypeDefinitionProvider", document.uri, position);

        console.log("[TypeParsing] Type definitions found:", typeDefinitions?.length ?? 0);

        if (typeDefinitions && typeDefinitions.length > 0) {
          const typeDef = typeDefinitions[0];
          const typeDefUri = 'targetUri' in typeDef ? typeDef.targetUri : typeDef.uri;
          const typeDefRange = 'targetRange' in typeDef ? typeDef.targetRange : typeDef.range;

          if (typeDefUri && typeDefRange) {
            console.log("[TypeParsing] Found type definition, getting hover at type definition");
            const typeDefDoc = await vscode.workspace.openTextDocument(typeDefUri);

            // Get hover at the type definition location
            const typeDefHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
              "vscode.executeHoverProvider",
              typeDefUri,
              typeDefRange.start
            );

            if (typeDefHovers && typeDefHovers.length > 0) {
              const typeDefHoverText = typeDefHovers[0].contents
                .map((c) => (typeof c === "string" ? c : c.value))
                .join("\n");

              console.log("[TypeParsing] Type definition hover:", typeDefHoverText);

              // Try to extract union values from the type definition hover
              const typeDefUnionMatches = Array.from(typeDefHoverText.matchAll(/"([^"]+)"/g));
              if (typeDefUnionMatches.length > 1) {
                const values = typeDefUnionMatches.map((match) => match[1]);
                console.log("[TypeParsing] Extracted union values from type definition:", values);
                return values;
              }

              // Try to parse inline union type like: type FilterType = "A" | "B" | "C"
              const inlineUnionMatch = typeDefHoverText.match(/=\s*(["'][^"']+["'](?:\s*\|\s*["'][^"']+["'])+)/);
              if (inlineUnionMatch) {
                const unionStr = inlineUnionMatch[1];
                const values = Array.from(unionStr.matchAll(/["']([^"']+)["']/g)).map(m => m[1]);
                console.log("[TypeParsing] Extracted union values from inline type:", values);
                return values;
              }
            }

            // Fallback: Read the type definition from the document directly
            const typeDefText = typeDefDoc.getText(typeDefRange);
            console.log("[TypeParsing] Type definition text:", typeDefText);

            const directUnionMatches = Array.from(typeDefText.matchAll(/"([^"]+)"/g));
            if (directUnionMatches.length > 1) {
              const values = directUnionMatches.map((match) => match[1]);
              console.log("[TypeParsing] Extracted union values from type definition text:", values);
              return values;
            }
          }
        } else {
          console.log("[TypeParsing] No type definitions found, trying manual resolution");

          // Fallback: manually find and resolve the type
          const sourceFile = ts.createSourceFile(
            document.fileName,
            document.getText(),
            ts.ScriptTarget.Latest,
            true
          );

          // Look for the type in the current file or imports
          let typeDecl = findDeclarationInFile(sourceFile, typeName);
          let typeDeclSourceFile = sourceFile;
          let typeDeclDocument = document;

          if (!typeDecl) {
            console.log("[TypeParsing] Type not found locally, checking imports");

            // Try to find direct import
            let importDecl = findImportDeclaration(sourceFile, typeName);

            if (importDecl) {
              // Type is directly imported, resolve it
              console.log(`[TypeParsing] Type '${typeName}' is directly imported, resolving...`);
              try {
                const importPath = await resolveImportPath(importDecl, document);
                if (importPath) {
                  console.log("[TypeParsing] Resolved direct import path:", importPath.fsPath);
                  const importedDoc = await vscode.workspace.openTextDocument(importPath);
                  const importedSourceFile = ts.createSourceFile(
                    importedDoc.fileName,
                    importedDoc.getText(),
                    ts.ScriptTarget.Latest,
                    true
                  );
                  typeDecl = findExportedDeclaration(importedSourceFile, typeName);
                  if (typeDecl) {
                    typeDeclSourceFile = importedSourceFile;
                    typeDeclDocument = importedDoc;
                    console.log("[TypeParsing] ✓ Found type declaration via direct import");
                  }
                }
              } catch (error) {
                console.error("[TypeParsing] Direct import resolution failed:", error);
              }
            }

            // If not found via direct import, scan all import statements to find which file might contain this type
            if (!typeDecl && !importDecl) {
              console.log("[TypeParsing] Type not directly imported, scanning all type imports");

              // Collect all import statements (excluding node_modules)
              const typeImports: ts.ImportDeclaration[] = [];
              for (const statement of sourceFile.statements) {
                if (ts.isImportDeclaration(statement)) {
                  const moduleSpec = (statement.moduleSpecifier as ts.StringLiteral).text;

                  // Include local imports: relative paths, path aliases, etc.
                  // Exclude node_modules by checking if it doesn't start with a letter-only package name
                  if (moduleSpec.startsWith('./') ||
                      moduleSpec.startsWith('../') ||
                      moduleSpec.startsWith('@/') ||
                      moduleSpec.startsWith('~/') ||
                      moduleSpec.startsWith('src/')) {
                    typeImports.push(statement);
                  }
                }
              }

              console.log(`[TypeParsing] Found ${typeImports.length} local imports to check`);

              // Try each type import to find the type
              for (const importStmt of typeImports) {
                const moduleSpecifier = (importStmt.moduleSpecifier as ts.StringLiteral).text;
                console.log("[TypeParsing] Checking import module:", moduleSpecifier);

                try {
                  // Use the existing import resolver which handles tsconfig paths
                  const importPath = await resolveImportPath(importStmt, document);

                  if (importPath) {
                    console.log("[TypeParsing] Resolved import path:", importPath.fsPath);
                    const importedDoc = await vscode.workspace.openTextDocument(importPath);
                    const importedSourceFile = ts.createSourceFile(
                      importedDoc.fileName,
                      importedDoc.getText(),
                      ts.ScriptTarget.Latest,
                      true
                    );
                    console.log(`[TypeParsing] Looking for '${typeName}' in imported file`);
                    const foundTypeDecl = findExportedDeclaration(importedSourceFile, typeName);
                    if (foundTypeDecl) {
                      typeDecl = foundTypeDecl;
                      typeDeclSourceFile = importedSourceFile;
                      typeDeclDocument = importedDoc;
                      console.log("[TypeParsing] ✓ Found type declaration in imported file:", importPath.fsPath);
                      break;
                    } else {
                      console.log(`[TypeParsing] ✗ Type '${typeName}' not found in ${moduleSpecifier}`);
                    }
                  } else {
                    console.log(`[TypeParsing] ✗ Could not resolve import path for ${moduleSpecifier}`);
                  }
                } catch (error) {
                  console.error("[TypeParsing] Import resolution failed for", moduleSpecifier, error);
                }
              }
            }
          }

          // Extract values from the type declaration
          if (typeDecl) {
            if (ts.isTypeAliasDeclaration(typeDecl) && typeDecl.type) {
              const typeText = typeDecl.type.getText(typeDeclSourceFile);
              console.log("[TypeParsing] Type alias text:", typeText);

              // Import the helper to resolve const object declarations
              const { findConstObjectDeclaration } = await import("../resolvers/value-extractor.js");

              // Handle the pattern: (typeof X)[keyof typeof X]
              const typeofMatch = typeText.match(/\(typeof\s+(\w+)\)\[keyof\s+typeof\s+\w+\]/);
              if (typeofMatch) {
                const objectName = typeofMatch[1];
                console.log("[TypeParsing] Found typeof pattern, looking for const object:", objectName);

                // Find the const object declaration using the improved helper
                const objectDecl = findConstObjectDeclaration(typeDeclSourceFile, objectName);
                if (objectDecl && objectDecl.initializer) {
                  console.log("[TypeParsing] Found const object declaration");

                  // Handle both direct object literals and "as const" expressions
                  let objectLiteral: ts.ObjectLiteralExpression | undefined;
                  if (ts.isObjectLiteralExpression(objectDecl.initializer)) {
                    objectLiteral = objectDecl.initializer;
                  } else if (ts.isAsExpression(objectDecl.initializer) &&
                             ts.isObjectLiteralExpression(objectDecl.initializer.expression)) {
                    objectLiteral = objectDecl.initializer.expression;
                  }

                  if (objectLiteral) {
                    const values = objectLiteral.properties
                      .filter(ts.isPropertyAssignment)
                      .map((prop) => prop.name.getText(typeDeclSourceFile).replace(/"/g, ""));
                    if (values.length > 0) {
                      console.log("[TypeParsing] Extracted values from typeof pattern:", values);
                      return values;
                    }
                  }
                }
              }

              // Fallback: try direct union type extraction
              const values = await extractStringLiteralsFromType(
                typeDecl.type,
                typeDeclSourceFile,
                async (decl, sf, doc) => {
                  // Inline simple extraction to avoid circular dependency
                  if (ts.isTypeAliasDeclaration(decl) && ts.isUnionTypeNode(decl.type)) {
                    return decl.type.types
                      .filter((t) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))
                      .map((t) => (t as ts.LiteralTypeNode).literal.getText(sf).replace(/"/g, ""));
                  }
                  return [];
                }
              );
              if (values.length > 0) {
                console.log("[TypeParsing] Extracted values from manual resolution:", values);
                return values;
              }
            }
          }
        }
      } catch (error) {
        console.error("[TypeParsing] Type definition resolution failed:", error);
      }
    }

    console.log("[TypeParsing] No union or literal types found in hover text");
    return [];
  } catch (error) {
    console.error("[TypeParsing] Extract union types from position failed:", error);
    return [];
  }
}
