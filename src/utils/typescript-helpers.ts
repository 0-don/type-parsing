import * as ts from "typescript";
import * as vscode from "vscode";

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

    console.log("[TypeParsing] No union or literal types found in hover text");
    return [];
  } catch (error) {
    console.error("[TypeParsing] Extract union types from position failed:", error);
    return [];
  }
}
