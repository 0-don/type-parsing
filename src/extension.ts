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
        decorations.push({
          range: new vscode.Range(
            group[0].lineEndPosition,
            group[0].lineEndPosition
          ),
          renderOptions: {
            after: { contentText: ` // ${combinations.join(", ")}` },
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
    const uniqueVars = new Map<string, vscode.Position>();

    for (const pos of group) {
      for (const part of pos.templateParts) {
        if (part.type === "variable" && part.position) {
          const key = `${part.value}-${part.position.line}-${part.position.character}`;
          if (!uniqueVars.has(key)) {
            uniqueVars.set(key, part.position);
          }
        }
      }
    }

    for (const [varKey, varPosition] of uniqueVars) {
      const varName = varKey.split("-")[0];
      const values = await extractEnumValues(document, varPosition);
      if (values.length > 0) {
        varValues.set(varName, values);
      }
    }

    return varValues;
  }

  async function extractEnumValues(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<string[]> {
    try {
      let values = await tryDefinitionProvider(document, position);
      if (values.length > 0) {
        return values;
      }

      values = await tryTypeDefinitionProvider(document, position);
      if (values.length > 0) {
        return values;
      }

      return await tryHoverProvider(document, position);
    } catch (error) {
      console.error("[TypeParsing] Extraction failed:", error);
      return [];
    }
  }

  async function tryDefinitionProvider(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<string[]> {
    const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      document.uri,
      position
    );
    if (!definitions?.[0]) {
      return [];
    }
    return await extractFromLocation(definitions[0]);
  }

  async function tryTypeDefinitionProvider(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<string[]> {
    const typeDefs = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeTypeDefinitionProvider",
      document.uri,
      position
    );
    if (!typeDefs?.[0]) {
      return [];
    }
    return await extractFromLocation(typeDefs[0]);
  }

  async function tryHoverProvider(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<string[]> {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      document.uri,
      position
    );
    if (!hovers?.length) {
      return [];
    }

    const hoverText = hovers[0].contents
      .map((c) => (typeof c === "string" ? c : c.value))
      .join("\n");
    const codeMatch = hoverText.match(/```typescript\n([\s\S]*?)\n```/);
    if (!codeMatch) {
      return [];
    }

    const literals = codeMatch[1].match(/"([^"]+)"/g);
    return literals && literals.length > 1
      ? literals.map((m) => m.replace(/"/g, ""))
      : [];
  }

  async function extractFromLocation(
    location: vscode.Location
  ): Promise<string[]> {
    if (!location.uri || !location.range) {
      return [];
    }

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
    return node ? extractValuesFromNode(node, sourceFile) : [];
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

      if (
        ts.isVariableDeclaration(current) &&
        current.initializer &&
        ts.isObjectLiteralExpression(current.initializer)
      ) {
        const keys = current.initializer.properties
          .filter(ts.isPropertyAssignment)
          .map((p) => p.name.getText(sourceFile));
        if (keys.length > 0) {
          return keys;
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
        const values = extractStringLiterals(current.type, sourceFile);
        if (values.length > 0) {
          return values;
        }
      }

      current = current.parent;
    }

    return [];
  }

  function extractStringLiterals(
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
        const values = variableValues.get(part.value) || [part.value];
        for (const value of values) {
          generate(index + 1, current + value);
        }
      }
    }
    generate(0, "");
    return results;
  }
}

export function deactivate() {
  decorationType?.dispose();
}
