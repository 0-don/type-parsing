import * as ts from "typescript";
import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("Type Parsing");
  outputChannel.show();
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

    // Skip output channels and non-code files
    if (
      document.uri.scheme !== "file" ||
      !document.fileName.match(/\.(tsx?|jsx?)$/)
    ) {
      return;
    }

    outputChannel.appendLine(`\n--- Processing: ${document.fileName} ---`);

    const decorations: vscode.DecorationOptions[] = [];
    const positions = findTemplateLiteralPositions(document);

    outputChannel.appendLine(`Found ${positions.length} template literals`);

    for (const pos of positions) {
      const quickInfo = await vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        document.uri,
        pos.variablePosition
      );

      if (quickInfo && quickInfo.length > 0) {
        const hoverText = quickInfo[0].contents
          .map((c) => (typeof c === "string" ? c : c.value))
          .join("\n");

        // Extract enum values from hover text
        const enumValues = extractEnumFromHoverText(hoverText);

        if (enumValues.length > 0) {
          outputChannel.appendLine(
            `  ✓ Found values: ${enumValues.join(", ")}`
          );

          const decoration: vscode.DecorationOptions = {
            range: new vscode.Range(pos.lineEndPosition, pos.lineEndPosition),
            renderOptions: {
              after: {
                contentText: ` // ${enumValues.join(", ")}`,
              },
            },
          };

          decorations.push(decoration);
        }
      }
    }

    outputChannel.appendLine(`Applied ${decorations.length} decorations`);
    editor.setDecorations(decorationType, decorations);
  }

  function extractEnumFromHoverText(hoverText: string): string[] {
    // Match patterns like: "OKX" | "BINANCE" | "BITGET"
    const unionMatch = hoverText.match(/"([^"]+)"(?:\s*\|\s*"([^"]+)")*/g);

    if (unionMatch) {
      const values = unionMatch
        .map((s) => s.replace(/"/g, "").trim())
        .filter((v) => v !== "|");

      return values;
    }

    return [];
  }

  function findTemplateLiteralPositions(document: vscode.TextDocument) {
    const positions: Array<{
      variablePosition: vscode.Position;
      lineEndPosition: vscode.Position;
    }> = [];

    const text = document.getText();
    const sourceFile = ts.createSourceFile(
      document.fileName,
      text,
      ts.ScriptTarget.Latest,
      true
    );

    function visit(node: ts.Node) {
      if (ts.isTemplateExpression(node)) {
        node.templateSpans.forEach((span) => {
          const expression = span.expression;

          if (ts.isIdentifier(expression)) {
            const start = sourceFile.getLineAndCharacterOfPosition(
              expression.getStart()
            );
            const lineEnd = sourceFile.getLineAndCharacterOfPosition(
              node.getEnd()
            );

            positions.push({
              variablePosition: new vscode.Position(
                start.line,
                start.character
              ),
              lineEndPosition: new vscode.Position(
                lineEnd.line,
                lineEnd.character
              ),
            });
          }
        });
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return positions;
  }

  let activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    updateDecorations(activeEditor);
  }

  // Debounce text changes
  let timeout: NodeJS.Timeout | undefined;

  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      activeEditor = editor;
      if (editor) {
        updateDecorations(editor);
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
