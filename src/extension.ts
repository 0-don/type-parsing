import * as ts from "typescript";
import * as vscode from "vscode";

export async function activate(context: vscode.ExtensionContext) {
  const decorationType = vscode.window.createTextEditorDecorationType({
    after: {
      margin: "0 0 0 1em",
      color: new vscode.ThemeColor("editorCodeLens.foreground"),
      fontStyle: "italic",
    },
  });

  async function updateDecorations(editor: vscode.TextEditor) {
    const document = editor.document;
    if (
      document.uri.scheme !== "file" ||
      !document.fileName.match(/\.(tsx?|jsx?)$/)
    ) {
      return;
    }

    const positions = findTemplateLiteralPositions(document);
    const templateGroups = positions.reduce((map, pos) => {
      const key = `${pos.lineEndPosition.line}:${pos.lineEndPosition.character}`;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(pos);
      return map;
    }, new Map<string, typeof positions>());

    const decorations: vscode.DecorationOptions[] = [];

    for (const group of templateGroups.values()) {
      const variableValues = new Map<string, string[]>();

      const uniqueVarPositions = new Map<string, vscode.Position>();
      for (const pos of group) {
        for (const part of pos.templateParts) {
          if (part.type === "variable" && part.position) {
            const key = `${part.value}-${part.position.line}-${part.position.character}`;
            if (!uniqueVarPositions.has(key)) {
              uniqueVarPositions.set(key, part.position);
            }
          }
        }
      }

      for (const [varKey, varPosition] of uniqueVarPositions) {
        const varName = varKey.split("-")[0];
        let enumValues: string[] = [];

        try {
          const definitions = await vscode.commands.executeCommand<
            vscode.Location[]
          >("vscode.executeDefinitionProvider", document.uri, varPosition);

          if (definitions?.[0]?.uri) {
            const defDoc = await vscode.workspace.openTextDocument(
              definitions[0].uri
            );
            const defSourceFile = ts.createSourceFile(
              defDoc.fileName,
              defDoc.getText(),
              ts.ScriptTarget.Latest,
              true
            );
            const node = findNodeAtPosition(
              defSourceFile,
              defDoc.offsetAt(definitions[0].range.start)
            );
            if (node) {
              enumValues = extractValuesFromNode(node, defSourceFile);
            }
          }

          if (enumValues.length === 0) {
            const typeDefinitions = await vscode.commands.executeCommand<
              vscode.Location[]
            >(
              "vscode.executeTypeDefinitionProvider",
              document.uri,
              varPosition
            );

            if (typeDefinitions?.[0]?.uri) {
              const typeDefDoc = await vscode.workspace.openTextDocument(
                typeDefinitions[0].uri
              );
              const typeDefSourceFile = ts.createSourceFile(
                typeDefDoc.fileName,
                typeDefDoc.getText(),
                ts.ScriptTarget.Latest,
                true
              );
              const node = findNodeAtPosition(
                typeDefSourceFile,
                typeDefDoc.offsetAt(typeDefinitions[0].range.start)
              );
              if (node) {
                enumValues = extractValuesFromNode(node, typeDefSourceFile);
              }
            }
          }

          if (enumValues.length === 0) {
            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
              "vscode.executeHoverProvider",
              document.uri,
              varPosition
            );

            if (hovers?.length) {
              const hoverText = hovers[0].contents
                .map((c) => (typeof c === "string" ? c : c.value))
                .join("\n");
              enumValues = extractEnumFromHoverText(hoverText);
            }
          }
        } catch (error) {
          console.error(`[TypeParsing] Error processing ${varName}:`, error);
          continue;
        }

        if (enumValues.length > 0) {
          variableValues.set(varName, enumValues);
        }
      }

      if (variableValues.size > 0) {
        const allKeys = generateCombinations(
          group[0].templateParts,
          variableValues
        );
        if (allKeys.length > 0) {
          decorations.push({
            range: new vscode.Range(
              group[0].lineEndPosition,
              group[0].lineEndPosition
            ),
            renderOptions: {
              after: { contentText: ` // ${allKeys.join(", ")}` },
            },
          });
        }
      }
    }

    editor.setDecorations(decorationType, decorations);
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
      if (ts.isEnumDeclaration(current)) {
        return current.members.map((m) => m.name.getText(sourceFile));
      }

      if (ts.isVariableDeclaration(current)) {
        const initializer = current.initializer;
        if (initializer && ts.isObjectLiteralExpression(initializer)) {
          const keys = initializer.properties
            .filter(ts.isPropertyAssignment)
            .map((p) => p.name.getText(sourceFile));
          if (keys.length > 0) {
            return keys;
          }
        }
      }

      if (ts.isObjectLiteralExpression(current)) {
        const keys = current.properties
          .filter(ts.isPropertyAssignment)
          .map((p) => p.name.getText(sourceFile));
        if (keys.length > 0) {
          return keys;
        }
      }

      if (ts.isTypeAliasDeclaration(current)) {
        const values = extractStringLiteralsFromType(current.type, sourceFile);
        if (values.length > 0) {
          return values;
        }
      }

      current = current.parent;
    }

    if (
      ts.isPropertyAssignment(node) &&
      ts.isObjectLiteralExpression(node.parent)
    ) {
      return node.parent.properties
        .filter(ts.isPropertyAssignment)
        .map((p) => p.name.getText(sourceFile));
    }

    return [];
  }

  function extractStringLiteralsFromType(
    typeNode: ts.TypeNode,
    sourceFile: ts.SourceFile
  ): string[] {
    if (ts.isUnionTypeNode(typeNode)) {
      const literals: string[] = [];
      for (const type of typeNode.types) {
        if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) {
          literals.push(type.literal.text);
        }
      }
      return literals;
    }

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
        return;
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return found;
  }

  function extractEnumFromHoverText(hoverText: string): string[] {
    const codeMatch = hoverText.match(/```typescript\n([\s\S]*?)\n```/);
    if (!codeMatch) {
      return [];
    }

    const stringLiteralMatches = codeMatch[1].match(/"([^"]+)"/g);
    if (stringLiteralMatches && stringLiteralMatches.length > 1) {
      return stringLiteralMatches.map((m) => m.replace(/"/g, ""));
    }

    return [];
  }

  function findTemplateLiteralPositions(document: vscode.TextDocument) {
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
          if (ts.isIdentifier(span.expression)) {
            const start = sourceFile.getLineAndCharacterOfPosition(
              span.expression.getStart()
            );
            templateParts.push({
              type: "variable",
              value: span.expression.text,
              position: new vscode.Position(start.line, start.character),
            });
          }
          templateParts.push({ type: "static", value: span.literal.text });
        });

        const firstVarPart = templateParts.find(
          (p) => p.type === "variable" && p.position
        );
        if (firstVarPart?.position) {
          const lineEnd = sourceFile.getLineAndCharacterOfPosition(
            node.getEnd()
          );
          positions.push({
            variablePosition: firstVarPart.position,
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
        const values = variableValues.get(part.value) || [part.value];
        for (const value of values) {
          generate(index + 1, current + value);
        }
      }
    }

    generate(0, "");
    return results;
  }

  let activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    setTimeout(() => activeEditor && updateDecorations(activeEditor), 1000);
  }

  let timeout: NodeJS.Timeout | undefined;

  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      activeEditor = editor;
      if (editor) {
        setTimeout(
          () => activeEditor === editor && updateDecorations(editor),
          500
        );
      }
    },
    null,
    context.subscriptions
  );

  vscode.workspace.onDidChangeTextDocument(
    (event) => {
      if (activeEditor && event.document === activeEditor.document) {
        clearTimeout(timeout);
        timeout = setTimeout(() => updateDecorations(activeEditor!), 500);
      }
    },
    null,
    context.subscriptions
  );
}

export function deactivate() {}
