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
    const decorations: vscode.DecorationOptions[] = [];

    for (const templateInfo of positions) {
      const results: string[] = [];

      for (const part of templateInfo.templateParts) {
        if (part.type === "variable" && part.position) {
          const resolvedValues = await resolveTypeUsingLanguageServer(
            document,
            part.position
          );

          if (resolvedValues.length > 0) {
            results.push(resolvedValues.join(" | "));
          }
        }
      }

      if (results.length > 0) {
        decorations.push({
          range: new vscode.Range(
            templateInfo.lineEndPosition,
            templateInfo.lineEndPosition
          ),
          renderOptions: {
            after: { contentText: ` // ${results.join(", ")}` },
          },
        });
      }
    }

    return decorations;
  }

  async function resolveTypeUsingLanguageServer(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<string[]> {
    try {
      // Step 1: Check if hover already contains union values
      const hoverValues = await getUnionValuesFromHover(document, position);
      if (hoverValues.length > 0) {
        return hoverValues;
      }

      // Step 2: Use type definition provider to find where the type is defined
      const typeDefinitions = await vscode.commands.executeCommand<
        vscode.Location[]
      >("vscode.executeTypeDefinitionProvider", document.uri, position);

      if (typeDefinitions && typeDefinitions.length > 0) {
        for (const typeDef of typeDefinitions) {
          if (isValidLocation(typeDef)) {
            const values = await extractValuesFromTypeDefinition(typeDef);
            if (values.length > 0) {
              return values;
            }
          }
        }
      }

      // Step 3: If type definition doesn't work, try regular definition
      const definitions = await vscode.commands.executeCommand<
        vscode.Location[]
      >("vscode.executeDefinitionProvider", document.uri, position);

      if (definitions && definitions.length > 0) {
        for (const def of definitions) {
          if (isValidLocation(def)) {
            const values = await extractValuesFromTypeDefinition(def);
            if (values.length > 0) {
              return values;
            }
          }
        }
      }

      return [];
    } catch (error) {
      console.error("[TypeParsing] Language server resolution failed:", error);
      return [];
    }
  }

  function isValidLocation(location: vscode.Location): boolean {
    return !!(location && location.uri && location.range);
  }

  async function getUnionValuesFromHover(
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
        return [];
      }

      const hoverText = hovers[0].contents
        .map((c) => (typeof c === "string" ? c : c.value))
        .join("\n");

      const codeMatch = hoverText.match(/```typescript\n([\s\S]*?)\n```/);
      if (!codeMatch) {
        return [];
      }

      const typeCode = codeMatch[1];

      // Look for union types like "MEXC" | "BYBIT" | "PHEMEX"
      const unionMatch = typeCode.match(/"([^"]+)"/g);
      if (unionMatch && unionMatch.length > 1) {
        return unionMatch.map((m) => m.replace(/"/g, ""));
      }

      // Look for single quoted unions
      const singleQuoteMatch = typeCode.match(/'([^']+)'/g);
      if (singleQuoteMatch && singleQuoteMatch.length > 1) {
        return singleQuoteMatch.map((m) => m.replace(/'/g, ""));
      }

      return [];
    } catch (error) {
      console.error("[TypeParsing] Hover extraction failed:", error);
      return [];
    }
  }

  async function extractValuesFromTypeDefinition(
    location: vscode.Location
  ): Promise<string[]> {
    try {
      if (!location || !location.uri || !location.range) {
        console.warn(
          "[TypeParsing] Invalid location provided to extractValuesFromTypeDefinition"
        );
        return [];
      }

      const doc = await vscode.workspace.openTextDocument(location.uri);
      const sourceFile = ts.createSourceFile(
        doc.fileName,
        doc.getText(),
        ts.ScriptTarget.Latest,
        true
      );

      // Find the node at the exact location the language server pointed us to
      const offset = doc.offsetAt(location.range.start);
      const node = findNodeAtPosition(sourceFile, offset);

      if (!node) {
        console.warn(
          `[TypeParsing] No node found at position ${offset} in ${doc.fileName}`
        );
        return [];
      }

      // Extract values from the specific node and its context
      return extractValuesFromNode(node, sourceFile);
    } catch (error) {
      console.error(
        "[TypeParsing] Extract from type definition failed:",
        error
      );
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
    // Start from the node and traverse up the parent chain to find the type definition
    let current: ts.Node | undefined = node;
    let visited = new Set<ts.Node>(); // Prevent infinite loops

    while (current && !visited.has(current)) {
      visited.add(current);

      // Handle enum declarations
      if (ts.isEnumDeclaration(current)) {
        return current.members.map((member) => {
          if (member.initializer && ts.isStringLiteral(member.initializer)) {
            return member.initializer.text;
          }
          return member.name.getText(sourceFile);
        });
      }

      // Handle type alias declarations with union types
      if (ts.isTypeAliasDeclaration(current)) {
        const values = extractStringLiteralsFromTypeNode(
          current.type,
          sourceFile
        );
        if (values.length > 0) {
          return values;
        }
      }

      // Handle const objects (as const)
      if (ts.isVariableDeclaration(current) && current.initializer) {
        if (ts.isObjectLiteralExpression(current.initializer)) {
          const values: string[] = [];
          current.initializer.properties.forEach((prop) => {
            if (ts.isPropertyAssignment(prop)) {
              const key = prop.name.getText(sourceFile).replace(/['"]/g, "");
              if (ts.isStringLiteral(prop.initializer)) {
                values.push(prop.initializer.text);
              } else {
                values.push(key);
              }
            }
          });
          if (values.length > 0) {
            return values;
          }
        }
      }

      // Handle object literal expressions directly
      if (ts.isObjectLiteralExpression(current)) {
        const values: string[] = [];
        current.properties.forEach((prop) => {
          if (ts.isPropertyAssignment(prop)) {
            const key = prop.name.getText(sourceFile).replace(/['"]/g, "");
            if (ts.isStringLiteral(prop.initializer)) {
              values.push(prop.initializer.text);
            } else {
              values.push(key);
            }
          }
        });
        if (values.length > 0) {
          return values;
        }
      }

      current = current.parent;
    }

    return [];
  }

  function extractStringLiteralsFromTypeNode(
    typeNode: ts.TypeNode,
    sourceFile: ts.SourceFile
  ): string[] {
    if (ts.isUnionTypeNode(typeNode)) {
      return typeNode.types
        .filter((t) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))
        .map((t) =>
          (t as ts.LiteralTypeNode).literal.getText().replace(/"/g, "")
        );
    }

    // Handle keyof typeof patterns like: keyof typeof ExchangeDtoExchangeType
    if (
      ts.isIndexedAccessTypeNode(typeNode) &&
      ts.isTypeQueryNode(typeNode.objectType)
    ) {
      const exprName = typeNode.objectType.exprName;
      if (ts.isIdentifier(exprName)) {
        const objectDecl = findObjectDeclaration(sourceFile, exprName.text);
        if (objectDecl) {
          return extractValuesFromNode(objectDecl, sourceFile);
        }
      }
    }

    return [];
  }

  function findObjectDeclaration(
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
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return found;
  }

  function findTemplateLiterals(document: vscode.TextDocument) {
    const positions: Array<{
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
          let variableName = "";
          let variablePosition: vscode.Position | undefined;

          if (ts.isIdentifier(span.expression)) {
            variableName = span.expression.text;
            const start = sourceFile.getLineAndCharacterOfPosition(
              span.expression.getStart()
            );
            variablePosition = new vscode.Position(start.line, start.character);
          } else if (ts.isPropertyAccessExpression(span.expression)) {
            variableName = span.expression.getText(sourceFile);
            const start = sourceFile.getLineAndCharacterOfPosition(
              span.expression.name.getStart()
            );
            variablePosition = new vscode.Position(start.line, start.character);
          }

          if (variableName) {
            templateParts.push({
              type: "variable",
              value: variableName,
              position: variablePosition,
            });
          }

          templateParts.push({ type: "static", value: span.literal.text });
        });

        const hasVariables = templateParts.some((p) => p.type === "variable");
        if (hasVariables) {
          const lineEnd = sourceFile.getLineAndCharacterOfPosition(
            node.getEnd()
          );
          positions.push({
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
}

export function deactivate() {
  decorationType?.dispose();
}
