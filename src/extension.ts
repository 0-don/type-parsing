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

    const decorations: vscode.DecorationOptions[] = [];
    const positions = findTemplateLiteralPositions(document);
    const templateGroups = new Map<string, typeof positions>();

    positions.forEach((pos) => {
      const key = `${pos.lineEndPosition.line}:${pos.lineEndPosition.character}`;
      if (!templateGroups.has(key)) {
        templateGroups.set(key, []);
      }
      templateGroups.get(key)!.push(pos);
    });

    for (const group of templateGroups.values()) {
      const variableValues = new Map<string, string[]>();

      for (const pos of group) {
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
          "vscode.executeHoverProvider",
          document.uri,
          pos.variablePosition
        );

        if (hovers?.length) {
          const hoverText = hovers[0].contents
            .map((c) => (typeof c === "string" ? c : c.value))
            .join("\n");

          const enumValues = extractEnumFromHover(hoverText);

          if (enumValues.length > 0) {
            const varName = pos.templateParts.find(
              (p) =>
                p.type === "variable" &&
                p.position?.line === pos.variablePosition.line &&
                p.position?.character === pos.variablePosition.character
            )?.value;

            if (varName) {
              variableValues.set(varName, enumValues);
            }
          }
        }
      }

      if (variableValues.size > 0) {
        const allKeys = generateCombinations(
          group[0].templateParts,
          variableValues
        );

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

    editor.setDecorations(decorationType, decorations);
  }

  function extractEnumFromHover(hoverText: string): string[] {
    const codeMatch = hoverText.match(/```typescript\n([\s\S]*?)\n```/);
    if (!codeMatch) {
      return [];
    }

    const matches = codeMatch[1].match(/"([^"]+)"/g);
    return matches ? matches.map((m) => m.replace(/"/g, "")) : [];
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
        const templateParts: (typeof positions)[0]["templateParts"] = [];

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

        templateParts.forEach((part) => {
          if (part.type === "variable" && part.position) {
            const lineEnd = sourceFile.getLineAndCharacterOfPosition(
              node.getEnd()
            );
            positions.push({
              variablePosition: part.position,
              lineEndPosition: new vscode.Position(
                lineEnd.line,
                lineEnd.character
              ),
              templateParts,
            });
          }
        });
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
        values.forEach((value) => generate(index + 1, current + value));
      }
    }

    generate(0, "");
    return results;
  }

  let activeEditor = vscode.window.activeTextEditor;
  let timeout: NodeJS.Timeout | undefined;

  if (activeEditor) {
    updateDecorations(activeEditor);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        activeEditor = editor;
        updateDecorations(editor);
      }
    }),

    vscode.workspace.onDidChangeTextDocument((event) => {
      if (activeEditor?.document === event.document) {
        clearTimeout(timeout);
        timeout = setTimeout(() => updateDecorations(activeEditor!), 500);
      }
    })
  );
}

export function deactivate() {}
