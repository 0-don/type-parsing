// src/extension.ts - Fixed to prioritize type over value
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

      return await extractValuesFromNode(node, sourceFile, doc);
    } catch (error) {
      console.error("[TypeParsing] Extract from type location failed:", error);
      return [];
    }
  }

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

  async function resolvePropertyValue(
    property: ts.PropertyAssignment,
    sourceFile: ts.SourceFile,
    document: vscode.TextDocument
  ): Promise<string[]> {
    // For type assertions (as ExchangeTypeEnum), always prioritize the type
    if (ts.isAsExpression(property.initializer)) {
      const typeName = property.initializer.type.getText(sourceFile);
      let typeDecl = findDeclarationInFile(sourceFile, typeName);
      let typeDeclSourceFile = sourceFile;
      let typeDeclDocument = document;

      if (!typeDecl) {
        try {
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
              typeDecl = findExportedDeclaration(importedSourceFile, typeName);
              if (typeDecl) {
                typeDeclSourceFile = importedSourceFile;
                typeDeclDocument = importedDoc;
              }
            }
          }
        } catch (error) {
          console.error("[TypeParsing] Import resolution failed:", error);
        }
      }

      if (typeDecl) {
        const typeValues = await extractValuesFromDeclaration(
          typeDecl,
          typeDeclSourceFile,
          typeDeclDocument
        );
        if (typeValues.length > 0) {
          return typeValues;
        }
      }

      // Only fallback to actual value if type resolution fails
      if (ts.isStringLiteral(property.initializer.expression)) {
        return [property.initializer.expression.text];
      }
    }

    if (ts.isIdentifier(property.initializer)) {
      const referencedDecl = findDeclarationInFile(
        sourceFile,
        property.initializer.text
      );
      if (referencedDecl) {
        return await extractValuesFromDeclaration(
          referencedDecl,
          sourceFile,
          document
        );
      }
    }

    if (ts.isStringLiteral(property.initializer)) {
      return [property.initializer.text];
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
    return await extractValuesFromDeclaration(
      declaration,
      sourceFile,
      document
    );
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

  function findDeclarationInFile(
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

  async function extractValuesFromDeclaration(
    declaration: ts.Node,
    sourceFile: ts.SourceFile,
    document?: vscode.TextDocument
  ): Promise<string[]> {
    if (ts.isEnumDeclaration(declaration)) {
      return declaration.members.map((member) =>
        member.initializer && ts.isStringLiteral(member.initializer)
          ? member.initializer.text
          : member.name.getText(sourceFile)
      );
    }

    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      if (ts.isObjectLiteralExpression(declaration.initializer)) {
        return declaration.initializer.properties
          .filter(ts.isPropertyAssignment)
          .map((prop) => prop.name.getText(sourceFile).replace(/"/g, ""));
      }

      if (
        ts.isAsExpression(declaration.initializer) &&
        ts.isObjectLiteralExpression(declaration.initializer.expression)
      ) {
        return declaration.initializer.expression.properties
          .filter(ts.isPropertyAssignment)
          .map((prop) => prop.name.getText(sourceFile).replace(/"/g, ""));
      }

      // For type assertions, try to resolve the type first
      if (ts.isAsExpression(declaration.initializer)) {
        const typeName = declaration.initializer.type.getText(sourceFile);
        let typeDecl = findDeclarationInFile(sourceFile, typeName);

        // If type not found in current file, try to find it in imports
        if (!typeDecl && document) {
          try {
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
              }
            }
          } catch (error) {
            console.error(
              "[TypeParsing] Type import resolution failed:",
              error
            );
          }
        }

        // If we found the type declaration, extract values from it
        if (typeDecl) {
          const typeValues = await extractValuesFromDeclaration(
            typeDecl,
            typeDecl.getSourceFile?.() || sourceFile,
            document
          );
          if (typeValues.length > 0) {
            return typeValues;
          }
        }

        // Fallback to the literal value if type resolution fails
        if (ts.isStringLiteral(declaration.initializer.expression)) {
          return [declaration.initializer.expression.text];
        }
      }

      if (ts.isStringLiteral(declaration.initializer)) {
        return [declaration.initializer.text];
      }
    }

    if (ts.isTypeAliasDeclaration(declaration)) {
      return extractStringLiteralsFromType(declaration.type, sourceFile);
    }

    return [];
  }

  async function extractStringLiteralsFromType(
    typeNode: ts.TypeNode,
    sourceFile: ts.SourceFile
  ): Promise<string[]> {
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
          return await extractValuesFromDeclaration(objectDecl, sourceFile);
        }
      }
    }

    return [];
  }

  async function extractValuesFromNode(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    document: vscode.TextDocument
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

  async function resolveImportPath(
    importDecl: ts.ImportDeclaration,
    document: vscode.TextDocument
  ): Promise<vscode.Uri | undefined> {
    if (!ts.isStringLiteral(importDecl.moduleSpecifier)) {
      return undefined;
    }

    const importPath = importDecl.moduleSpecifier.text;
    const documentDir = vscode.Uri.joinPath(document.uri, "..");

    if (importPath.startsWith("./") || importPath.startsWith("../")) {
      // Check if the import already has a file extension
      const hasExtension = /\.(m?[tj]sx?|[cm]js)$/.test(importPath);

      if (hasExtension) {
        // Replace .js/.mjs/.cjs extensions with TypeScript equivalents
        const extensions = [
          importPath.replace(/\.m?js$/, ".ts"),
          importPath.replace(/\.m?js$/, ".tsx"),
          importPath.replace(/\.m?js$/, ".mts"),
          importPath.replace(/\.cjs$/, ".cts"),
          importPath, // Also try the original extension
        ];

        for (const path of extensions) {
          const resolvedPath = vscode.Uri.joinPath(documentDir, path);
          try {
            await vscode.workspace.fs.stat(resolvedPath);
            return resolvedPath;
          } catch {
            continue;
          }
        }

        // Fallback: try the original path
        return vscode.Uri.joinPath(documentDir, importPath);
      } else {
        // No extension, try common TypeScript/JavaScript extensions
        const extensions = [".ts", ".tsx", ".js", ".jsx"];

        for (const ext of extensions) {
          const resolvedPath = vscode.Uri.joinPath(documentDir, importPath + ext);
          try {
            await vscode.workspace.fs.stat(resolvedPath);
            return resolvedPath;
          } catch {
            continue;
          }
        }

        // If no file found, return .ts as fallback
        return vscode.Uri.joinPath(documentDir, importPath + ".ts");
      }
    }

    return undefined;
  }

  function findExportedDeclaration(
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

          templateParts.push({
            type: "variable",
            value: span.expression.getText(sourceFile),
            position,
          });

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
