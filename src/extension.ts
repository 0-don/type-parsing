// src/extension.ts - Fixed version
import * as ts from "typescript";
import * as vscode from "vscode";

let decorationType: vscode.TextEditorDecorationType;

export async function activate(context: vscode.ExtensionContext) {
  decorationType = vscode.window.createTextEditorDecorationType({
    after: {
      margin: "0 0 0 1em",
      color: new vscode.ThemeColor("editorCodeLens.foreground"),
      fontStyle: "italic",
    },
  });

  let activeEditor = vscode.window.activeTextEditor;
  let timeout: NodeJS.Timeout | undefined;

  const scheduleUpdate = (editor: vscode.TextEditor, delay: number) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (vscode.window.activeTextEditor === editor) {
        updateDecorations(editor);
      }
    }, delay);
  };

  if (activeEditor) {
    scheduleUpdate(activeEditor, 1000);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        activeEditor = editor;
        scheduleUpdate(editor, 500);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (activeEditor && event.document === activeEditor.document) {
        scheduleUpdate(activeEditor, 500);
      }
    })
  );

  async function updateDecorations(editor: vscode.TextEditor) {
    try {
      const document = editor.document;
      if (
        document.uri.scheme !== "file" ||
        !document.fileName.match(/\.(tsx?|jsx?)$/)
      ) {
        return;
      }

      const positions = findTemplateLiterals(document);
      const decorations = await buildDecorations(positions, document);
      editor.setDecorations(decorationType, decorations);
    } catch (error) {
      console.error("[TypeParsing] Update failed:", error);
    }
  }

  async function buildDecorations(
    positions: ReturnType<typeof findTemplateLiterals>,
    document: vscode.TextDocument
  ): Promise<vscode.DecorationOptions[]> {
    const grouped = groupByLineEnd(positions);
    const decorations: vscode.DecorationOptions[] = [];

    for (const group of grouped.values()) {
      const varValues = await resolveVariableValues(group, document);
      if (varValues.size === 0) {
        continue;
      }

      const combinations = generateCombinations(
        group[0].templateParts,
        varValues
      );
      if (combinations.length > 0) {
        const displayText =
          combinations.length > 5
            ? `${combinations.slice(0, 5).join(", ")}... (${
                combinations.length
              } total)`
            : combinations.join(", ");

        decorations.push({
          range: new vscode.Range(
            group[0].lineEndPosition,
            group[0].lineEndPosition
          ),
          renderOptions: {
            after: { contentText: ` // ${displayText}` },
          },
        });
      }
    }

    return decorations;
  }

  function groupByLineEnd(positions: ReturnType<typeof findTemplateLiterals>) {
    const map = new Map<string, typeof positions>();
    for (const pos of positions) {
      const key = `${pos.lineEndPosition.line}:${pos.lineEndPosition.character}`;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(pos);
    }
    return map;
  }

  async function resolveVariableValues(
    group: ReturnType<typeof findTemplateLiterals>,
    document: vscode.TextDocument
  ): Promise<Map<string, string[]>> {
    const varValues = new Map<string, string[]>();
    const sourceFile = ts.createSourceFile(
      document.fileName,
      document.getText(),
      ts.ScriptTarget.Latest,
      true
    );

    for (const pos of group) {
      for (const part of pos.templateParts) {
        if (part.type === "variable") {
          const values = await resolveVariable(
            part.value,
            part.position,
            document,
            sourceFile
          );
          if (values.length > 0) {
            varValues.set(part.value, values);
          }
        }
      }
    }

    return varValues;
  }

  async function resolveVariable(
    varExpression: string,
    position: vscode.Position | undefined,
    document: vscode.TextDocument,
    sourceFile: ts.SourceFile
  ): Promise<string[]> {
    // Handle property access expressions (e.g., mockExchange.exchangeType)
    if (varExpression.includes(".")) {
      return await resolvePropertyAccess(varExpression, sourceFile, document);
    }

    // Rest of the function stays the same...
    const strategies = [
      () =>
        position
          ? tryLanguageServerProviders(document, position)
          : Promise.resolve([]),
      () => resolveFromLocalScope(varExpression, sourceFile),
      () => resolveFromImports(varExpression, sourceFile, document),
    ];

    for (const strategy of strategies) {
      try {
        const values = await strategy();
        if (values.length > 0) {
          return values;
        }
      } catch (error) {
        console.error("[TypeParsing] Strategy failed:", error);
      }
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
    const propertyName = parts[1];

    // Find the object declaration
    const objectDecl = findDeclarationInFile(sourceFile, objectName);
    if (!objectDecl) {
      return [];
    }

    // Extract the property value and type
    if (ts.isVariableDeclaration(objectDecl) && objectDecl.initializer) {
      if (ts.isObjectLiteralExpression(objectDecl.initializer)) {
        const property = objectDecl.initializer.properties.find(
          (prop) =>
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === propertyName
        );

        if (property && ts.isPropertyAssignment(property)) {
          // If it's a type assertion (as ExchangeTypeEnum), resolve the type
          if (ts.isAsExpression(property.initializer)) {
            const typeName = property.initializer.type.getText(sourceFile);

            // First try to find it in the current file
            let typeDecl = findDeclarationInFile(sourceFile, typeName);

            // If not found locally, try to resolve from imports
            if (!typeDecl) {
              try {
                const importDecl = findImportDeclaration(sourceFile, typeName);
                if (importDecl) {
                  const importPath = resolveImportPath(importDecl, document);
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
                  }
                }
              } catch (error) {
                console.error("[TypeParsing] Import resolution failed:", error);
              }
            }

            if (typeDecl) {
              const typeValues = extractValuesFromDeclaration(
                typeDecl,
                sourceFile
              );
              if (typeValues.length > 0) {
                return typeValues;
              }
            }

            // Fallback to the actual value if type resolution fails
            if (ts.isStringLiteral(property.initializer.expression)) {
              return [property.initializer.expression.text];
            }
          }

          // Handle direct string literals
          if (ts.isStringLiteral(property.initializer)) {
            return [property.initializer.text];
          }

          // Handle identifiers that reference other variables/enums
          if (ts.isIdentifier(property.initializer)) {
            const referencedDecl = findDeclarationInFile(
              sourceFile,
              property.initializer.text
            );
            if (referencedDecl) {
              return extractValuesFromDeclaration(referencedDecl, sourceFile);
            }
          }
        }
      }
    }

    return [];
  }

  async function tryLanguageServerProviders(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<string[]> {
    try {
      // Try definition provider
      const definitions = await vscode.commands.executeCommand<
        vscode.Location[]
      >("vscode.executeDefinitionProvider", document.uri, position);
      if (definitions?.[0]) {
        const values = await extractFromLocation(definitions[0]);
        if (values.length > 0) {
          return values;
        }
      }

      // Try type definition provider
      const typeDefs = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeTypeDefinitionProvider",
        document.uri,
        position
      );
      if (typeDefs?.[0]) {
        const values = await extractFromLocation(typeDefs[0]);
        if (values.length > 0) {
          return values;
        }
      }

      // Try hover provider
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        document.uri,
        position
      );
      if (hovers?.length) {
        return parseHoverForValues(hovers[0]);
      }
    } catch (error) {
      console.error("[TypeParsing] Language server error:", error);
    }

    return [];
  }

  function resolveFromLocalScope(
    varName: string,
    sourceFile: ts.SourceFile
  ): string[] {
    const declaration = findDeclarationInFile(sourceFile, varName);
    if (!declaration) {
      return [];
    }

    return extractValuesFromDeclaration(declaration, sourceFile);
  }

  async function resolveFromImports(
    varName: string,
    sourceFile: ts.SourceFile,
    document: vscode.TextDocument
  ): Promise<string[]> {
    // Find import for the variable
    const importDecl = findImportDeclaration(sourceFile, varName);
    if (!importDecl) {
      return [];
    }

    try {
      const importPath = resolveImportPath(importDecl, document);
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
        return extractValuesFromDeclaration(exportedDecl, importedSourceFile);
      }
    } catch (error) {
      console.error("[TypeParsing] Import resolution failed:", error);
    }

    return [];
  }

  function findDeclarationInFile(
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

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return found;
  }

  function extractValuesFromDeclaration(
    declaration: ts.Node,
    sourceFile: ts.SourceFile
  ): string[] {
    // Handle enums
    if (ts.isEnumDeclaration(declaration)) {
      return declaration.members.map((member) =>
        member.initializer && ts.isStringLiteral(member.initializer)
          ? member.initializer.text
          : member.name.getText(sourceFile)
      );
    }

    // Handle variable declarations
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      // Object literals
      if (ts.isObjectLiteralExpression(declaration.initializer)) {
        return declaration.initializer.properties
          .filter(ts.isPropertyAssignment)
          .map((prop) => prop.name.getText(sourceFile));
      }

      // As expressions (const assertions)
      if (
        ts.isAsExpression(declaration.initializer) &&
        ts.isObjectLiteralExpression(declaration.initializer.expression)
      ) {
        return declaration.initializer.expression.properties
          .filter(ts.isPropertyAssignment)
          .map((prop) => prop.name.getText(sourceFile));
      }

      // String literals
      if (ts.isStringLiteral(declaration.initializer)) {
        return [declaration.initializer.text];
      }

      // As expressions with string literals
      if (
        ts.isAsExpression(declaration.initializer) &&
        ts.isStringLiteral(declaration.initializer.expression)
      ) {
        return [declaration.initializer.expression.text];
      }
    }

    // Handle type aliases
    if (ts.isTypeAliasDeclaration(declaration)) {
      return extractStringLiteralsFromType(declaration.type, sourceFile);
    }

    return [];
  }

  function extractStringLiteralsFromType(
    typeNode: ts.TypeNode,
    sourceFile: ts.SourceFile
  ): string[] {
    if (ts.isUnionTypeNode(typeNode)) {
      return typeNode.types
        .filter((t) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))
        .map((t) =>
          (t as ts.LiteralTypeNode).literal
            .getText(sourceFile)
            .replace(/"/g, "")
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
          return extractValuesFromDeclaration(objectDecl, sourceFile);
        }
      }
    }

    return [];
  }

  function findImportDeclaration(
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

  function resolveImportPath(
    importDecl: ts.ImportDeclaration,
    document: vscode.TextDocument
  ): vscode.Uri | undefined {
    if (!ts.isStringLiteral(importDecl.moduleSpecifier)) {
      return undefined;
    }

    const importPath = importDecl.moduleSpecifier.text;
    const documentDir = vscode.Uri.joinPath(document.uri, "..");

    // Handle relative imports
    if (importPath.startsWith("./") || importPath.startsWith("../")) {
      const resolvedPath = vscode.Uri.joinPath(documentDir, importPath + ".ts");
      return resolvedPath;
    }

    return undefined;
  }

  function findExportedDeclaration(
    sourceFile: ts.SourceFile,
    name: string
  ): ts.Node | undefined {
    for (const statement of sourceFile.statements) {
      // Named exports
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

      // Export declarations
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

    // Also check non-exported declarations
    return findDeclarationInFile(sourceFile, name);
  }

  function hasExportModifier(node: ts.Node): boolean {
    return (
      (ts.canHaveModifiers(node) &&
        ts
          .getModifiers(node)
          ?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
          )) ??
      false
    );
  }

  function parseHoverForValues(hover: vscode.Hover): string[] {
    const hoverText = hover.contents
      .map((c) => (typeof c === "string" ? c : c.value))
      .join("\n");

    const patterns = [
      /```typescript\n([\s\S]*?)\n```/,
      /```ts\n([\s\S]*?)\n```/,
      /\(parameter\) \w+: "([^"]+)"/g,
      /"([^"]+)"/g,
    ];

    for (const pattern of patterns) {
      const matches = hoverText.match(pattern);
      if (matches) {
        const literals = Array.from(hoverText.matchAll(/"([^"]+)"/g)).map(
          (match) => match[1]
        );
        if (literals.length > 1) {
          return literals;
        }
      }
    }

    return [];
  }

  async function extractFromLocation(
    location: vscode.Location
  ): Promise<string[]> {
    if (!location.uri || !location.range) {
      return [];
    }

    try {
      const doc = await vscode.workspace.openTextDocument(location.uri);
      const sourceFile = ts.createSourceFile(
        doc.fileName,
        doc.getText(),
        ts.ScriptTarget.Latest,
        true
      );

      const node = findNodeAtPosition(
        sourceFile,
        doc.offsetAt(location.range.start)
      );
      if (!node) {
        return [];
      }

      return extractValuesFromNode(node, sourceFile);
    } catch (error) {
      console.error("[TypeParsing] Extract from location failed:", error);
      return [];
    }
  }

  function findNodeAtPosition(
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

  function extractValuesFromNode(
    node: ts.Node,
    sourceFile: ts.SourceFile
  ): string[] {
    let current: ts.Node | undefined = node;

    while (current) {
      const values = extractValuesFromDeclaration(current, sourceFile);
      if (values.length > 0) {
        return values;
      }
      current = current.parent;
    }

    return [];
  }

  function findTemplateLiterals(document: vscode.TextDocument) {
    const positions: Array<{
      variablePosition: vscode.Position;
      lineEndPosition: vscode.Position;
      templateParts: Array<{
        type: "static" | "variable";
        value: string;
        position?: vscode.Position;
      }>;
    }> = [];

    const sourceFile = ts.createSourceFile(
      document.fileName,
      document.getText(),
      ts.ScriptTarget.Latest,
      true
    );

    function visit(node: ts.Node) {
      if (ts.isTemplateExpression(node)) {
        const templateParts: Array<{
          type: "static" | "variable";
          value: string;
          position?: vscode.Position;
        }> = [];

        templateParts.push({ type: "static", value: node.head.text });

        node.templateSpans.forEach((span) => {
          const start = sourceFile.getLineAndCharacterOfPosition(
            span.expression.getStart()
          );
          const position = new vscode.Position(start.line, start.character);

          if (ts.isIdentifier(span.expression)) {
            templateParts.push({
              type: "variable",
              value: span.expression.text,
              position,
            });
          } else if (ts.isPropertyAccessExpression(span.expression)) {
            templateParts.push({
              type: "variable",
              value: span.expression.getText(sourceFile),
              position,
            });
          } else {
            // Fallback for other expression types
            templateParts.push({
              type: "variable",
              value: span.expression.getText(sourceFile),
              position,
            });
          }

          templateParts.push({ type: "static", value: span.literal.text });
        });

        const firstVar = templateParts.find(
          (p) => p.type === "variable" && p.position
        );
        if (firstVar?.position) {
          const lineEnd = sourceFile.getLineAndCharacterOfPosition(
            node.getEnd()
          );
          positions.push({
            variablePosition: firstVar.position,
            lineEndPosition: new vscode.Position(
              lineEnd.line,
              lineEnd.character
            ),
            templateParts,
          });
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return positions;
  }

  function generateCombinations(
    templateParts: Array<{ type: "static" | "variable"; value: string }>,
    variableValues: Map<string, string[]>
  ): string[] {
    const results: string[] = [];

    function generate(index: number, current: string) {
      if (index >= templateParts.length) {
        results.push(current);
        return;
      }

      const part = templateParts[index];
      if (part.type === "static") {
        generate(index + 1, current + part.value);
      } else {
        const values = variableValues.get(part.value);
        if (values && values.length > 0) {
          for (const value of values.slice(0, 10)) {
            generate(index + 1, current + value);
          }
        } else {
          // If no values found, use the variable name as placeholder
          generate(index + 1, current + `{${part.value}}`);
        }
      }
    }

    generate(0, "");
    return results.slice(0, 20);
  }
}

export function deactivate() {
  decorationType?.dispose();
}
