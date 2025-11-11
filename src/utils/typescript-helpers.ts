import * as ts from "typescript";
import * as vscode from "vscode";
import { resolveImportPath } from "../resolvers/import-resolver";
import { extractEnumValues } from "../resolvers/value-extractor";

/**
 * Find a declaration (variable, enum, type alias, parameter) in a source file.
 * This is the canonical declaration finder used throughout the codebase.
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

    // Parameters (for function parameters, arrow function params, etc.)
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found = node;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/**
 * Find an import declaration that imports a specific name.
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
 * Find an exported declaration in a source file.
 */
export function findExportedDeclaration(
  sourceFile: ts.SourceFile,
  name: string
): ts.Node | undefined {
  for (const statement of sourceFile.statements) {
    // Named exports: export { Foo }
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

    // Direct exports: export const Foo = ...
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

  // Fallback: look for non-exported declarations
  return findDeclarationInFile(sourceFile, name);
}

/**
 * Check if a node has an export modifier.
 */
function hasExportModifier(node: ts.Node): boolean {
  return (
    (ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) ??
    false
  );
}

/**
 * Main function to extract union type values from a position in a document.
 * This is the primary resolution strategy that uses VSCode's language service.
 */
export async function extractUnionTypesFromPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<string[]> {
  try {
    // Get hover information from VSCode's language service
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      document.uri,
      position
    );

    if (!hovers || hovers.length === 0) {
      return [];
    }

    let hoverText = hovers[0].contents
      .map((c) => (typeof c === "string" ? c : c.value))
      .join("\n");

    // If hover is still loading, wait and retry
    if (hoverText.includes("loading")) {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const retriedHovers = await vscode.commands.executeCommand<
        vscode.Hover[]
      >("vscode.executeHoverProvider", document.uri, position);

      if (retriedHovers && retriedHovers.length > 0) {
        hoverText = retriedHovers[0].contents
          .map((c) => (typeof c === "string" ? c : c.value))
          .join("\n");
      }
    }

    // Skip if still loading or shows 'any'
    if (hoverText.includes("loading") || hoverText.includes(") any")) {
      return [];
    }

    // Extract union type values directly from hover text: "A" | "B" | "C"
    const unionMatches = Array.from(hoverText.matchAll(/"([^"]+)"/g));

    if (unionMatches.length > 1) {
      return unionMatches.map((match) => match[1]);
    }

    // Check if it's a single literal type: "value"
    const literalMatch = hoverText.match(/:\s*"([^"]+)"/);
    if (literalMatch) {
      return [literalMatch[1]];
    }

    // Check for enum member reference: EnumName.MEMBER
    const enumMemberMatch = hoverText.match(/:\s*(\w+)\.(\w+)\s*$/m);
    if (enumMemberMatch) {
      const enumName = enumMemberMatch[1];
      const memberName = enumMemberMatch[2];

      // Resolve the enum and return all its values
      const enumValues = await resolveTypeReference(
        enumName,
        document,
        position
      );
      if (enumValues.length > 0) {
        return enumValues;
      }
    }

    // If hover shows a type reference (e.g., "type: FilterType"), resolve it
    const typeRefMatch = hoverText.match(/:\s*(\w+)\s*$/m);
    if (typeRefMatch) {
      const typeName = typeRefMatch[1];

      // Don't try to resolve primitive types
      const primitiveTypes = [
        "string",
        "number",
        "boolean",
        "any",
        "unknown",
        "void",
        "never",
        "Array",
        "Promise",
      ];
      if (primitiveTypes.includes(typeName)) {
        return [];
      }

      // Try to resolve the type using type definitions or manual resolution
      return await resolveTypeReference(typeName, document, position);
    }

    return [];
  } catch (error) {
    return [];
  }
}

/**
 * Resolve a type reference to its union values.
 * Uses VSCode's type definition provider or falls back to manual AST resolution.
 */
async function resolveTypeReference(
  typeName: string,
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<string[]> {
  try {
    // Try VSCode's type definition provider first
    const typeDefinitions = await vscode.commands.executeCommand<
      (vscode.Location | vscode.LocationLink)[]
    >("vscode.executeTypeDefinitionProvider", document.uri, position);

    if (typeDefinitions && typeDefinitions.length > 0) {
      const typeDef = typeDefinitions[0];
      const typeDefUri =
        "targetUri" in typeDef ? typeDef.targetUri : typeDef.uri;
      const typeDefRange =
        "targetRange" in typeDef ? typeDef.targetRange : typeDef.range;

      if (typeDefUri && typeDefRange) {
        const typeDefDoc = await vscode.workspace.openTextDocument(typeDefUri);
        const typeDefText = typeDefDoc.getText(typeDefRange);

        // Extract union values directly from the type definition text
        const unionMatches = Array.from(typeDefText.matchAll(/"([^"]+)"/g));
        if (unionMatches.length > 1) {
          return unionMatches.map((match) => match[1]);
        }
      }
    }

    // Fallback: Manual AST-based resolution
    return await manualTypeResolution(typeName, document);
  } catch (error) {
    return [];
  }
}

/**
 * Manual type resolution using AST parsing.
 * This is the fallback when language service doesn't provide type definitions.
 */
async function manualTypeResolution(
  typeName: string,
  document: vscode.TextDocument
): Promise<string[]> {
  const sourceFile = ts.createSourceFile(
    document.fileName,
    document.getText(),
    ts.ScriptTarget.Latest,
    true
  );

  // Look for the type in the current file or imports
  let typeDecl = findDeclarationInFile(sourceFile, typeName);
  let typeDeclSourceFile = sourceFile;

  if (!typeDecl) {
    // Check if the type is directly imported
    const importDecl = findImportDeclaration(sourceFile, typeName);
    if (importDecl) {
      try {
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
          typeDecl = findExportedDeclaration(importedSourceFile, typeName);
          if (typeDecl) {
            typeDeclSourceFile = importedSourceFile;
          }
        }
      } catch (error) {
        // Import resolution failed, continue with fallback
      }
    }

    // If not found via direct import, scan all local imports
    if (!typeDecl) {
      typeDecl = await findTypeInImports(typeName);
      if (typeDecl) {
        typeDeclSourceFile = typeDecl.getSourceFile();
      }
    }
  }

  // Extract values from the type declaration
  if (typeDecl) {
    // Handle enum declarations
    if (ts.isEnumDeclaration(typeDecl)) {
      const values = extractEnumValues(typeDecl, typeDeclSourceFile);
      if (values.length > 0) {
        return values;
      }
    }

    // Handle type alias declarations
    if (ts.isTypeAliasDeclaration(typeDecl) && typeDecl.type) {
      const typeText = typeDecl.type.getText(typeDeclSourceFile);

      // Handle typeof pattern: (typeof X)[keyof typeof X]
      const typeofMatch = typeText.match(
        /\(typeof\s+(\w+)\)\[keyof\s+typeof\s+\w+\]/
      );
      if (typeofMatch) {
        const objectName = typeofMatch[1];

        const { findConstObjectDeclaration } = await import(
          "../resolvers/value-extractor.js"
        );
        const objectDecl = findConstObjectDeclaration(
          typeDeclSourceFile,
          objectName
        );
        if (objectDecl && objectDecl.initializer) {
          let objectLiteral: ts.ObjectLiteralExpression | undefined;
          if (ts.isObjectLiteralExpression(objectDecl.initializer)) {
            objectLiteral = objectDecl.initializer;
          } else if (
            ts.isAsExpression(objectDecl.initializer) &&
            ts.isObjectLiteralExpression(objectDecl.initializer.expression)
          ) {
            objectLiteral = objectDecl.initializer.expression;
          }

          if (objectLiteral) {
            const values = objectLiteral.properties
              .filter(ts.isPropertyAssignment)
              .map((prop) =>
                prop.name.getText(typeDeclSourceFile).replace(/"/g, "")
              );
            if (values.length > 0) {
              return values;
            }
          }
        }
      }

      // Handle direct union types: "A" | "B" | "C"
      if (ts.isUnionTypeNode(typeDecl.type)) {
        const values = typeDecl.type.types
          .filter(
            (t) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)
          )
          .map((t) =>
            (t as ts.LiteralTypeNode).literal
              .getText(typeDeclSourceFile)
              .replace(/"/g, "")
          );
        if (values.length > 0) {
          return values;
        }
      }
    }
  }

  return [];
}

/**
 * Search for a type declaration using VSCode's workspace symbol search.
 * This is more dynamic than scanning imports and works across the entire project.
 */
async function findTypeInImports(
  typeName: string
): Promise<ts.Node | undefined> {
  // First, try using VSCode's workspace symbols to find the type dynamically
  try {
    const symbols = await vscode.commands.executeCommand<
      vscode.SymbolInformation[]
    >("vscode.executeWorkspaceSymbolProvider", typeName);

    if (symbols && symbols.length > 0) {
      // Look for exact type alias or interface matches
      const typeSymbol = symbols.find(
        (s) =>
          s.name === typeName &&
          (s.kind === vscode.SymbolKind.TypeParameter ||
            s.kind === vscode.SymbolKind.Interface ||
            s.kind === vscode.SymbolKind.Enum ||
            s.kind === vscode.SymbolKind.Class)
      );

      if (typeSymbol) {
        try {
          const symbolDoc = await vscode.workspace.openTextDocument(
            typeSymbol.location.uri
          );
          const symbolSourceFile = ts.createSourceFile(
            symbolDoc.fileName,
            symbolDoc.getText(),
            ts.ScriptTarget.Latest,
            true
          );
          const foundDecl = findExportedDeclaration(symbolSourceFile, typeName);
          if (foundDecl) {
            return foundDecl;
          }
        } catch {
          // Symbol not accessible, continue
        }
      }
    }
  } catch {
    // Workspace symbol search not available, fall back to import scanning
  }

  return undefined;
}
