import * as ts from "typescript";
import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("Type Parsing");
  outputChannel.appendLine("=== Extension Activated ===");

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

    outputChannel.appendLine(`\n--- Processing: ${document.fileName} ---`);

    const decorations: vscode.DecorationOptions[] = [];
    const positions = findTemplateLiteralPositions(document);

    outputChannel.appendLine(
      `Found ${positions.length} template literal variables`
    );

    const templateGroups = new Map<string, typeof positions>();

    positions.forEach((pos) => {
      const key = `${pos.lineEndPosition.line}:${pos.lineEndPosition.character}`;
      if (!templateGroups.has(key)) {
        templateGroups.set(key, []);
      }
      templateGroups.get(key)!.push(pos);
    });

    for (const [key, group] of templateGroups) {
      const variableValues = new Map<string, string[]>();

      for (const pos of group) {
        const quickInfo = await vscode.commands.executeCommand<vscode.Hover[]>(
          "vscode.executeHoverProvider",
          document.uri,
          pos.variablePosition
        );

        if (quickInfo && quickInfo.length > 0) {
          const hoverText = quickInfo[0].contents
            .map((c) => (typeof c === "string" ? c : c.value))
            .join("\n");

          const enumValues = extractEnumFromHoverText(hoverText);

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
        const firstPos = group[0];
        const allKeys = generateCombinations(
          firstPos.templateParts,
          variableValues
        );

        outputChannel.appendLine(`  ✓ Generated: ${allKeys.join(", ")}`);

        decorations.push({
          range: new vscode.Range(
            firstPos.lineEndPosition,
            firstPos.lineEndPosition
          ),
          renderOptions: {
            after: {
              contentText: ` // ${allKeys.join(", ")}`,
            },
          },
        });
      }
    }

    outputChannel.appendLine(`Applied ${decorations.length} decorations`);
    editor.setDecorations(decorationType, decorations);
  }

  function extractEnumFromHoverText(hoverText: string): string[] {
    const codeMatch = hoverText.match(/```typescript\n([\s\S]*?)\n```/);

    if (!codeMatch) {
      return [];
    }

    const matches = codeMatch[1].match(/"([^"]+)"/g);

    if (matches) {
      return matches.map((m) => m.replace(/"/g, ""));
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
        for (const value of values) {
          generate(index + 1, current + value);
        }
      }
    }

    generate(0, "");
    return results;
  }

  let activeEditor = vscode.window.activeTextEditor;

  // Trigger initial decoration with a delay to ensure language server is ready
  if (activeEditor) {
    setTimeout(() => {
      if (activeEditor) {
        updateDecorations(activeEditor);
      }
    }, 1000);
  }

  let timeout: NodeJS.Timeout | undefined;

  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      activeEditor = editor;
      if (editor) {
        // Add delay for language server to be ready
        setTimeout(() => {
          if (activeEditor === editor) {
            updateDecorations(editor);
          }
        }, 500);
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

export function deactivate() {
  if (outputChannel) {
    outputChannel.dispose();
  }
}
