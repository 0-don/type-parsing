import * as vscode from "vscode";
import { findTemplateLiterals } from "./parsers/template-literal-parser";
import { buildDecorations } from "./utils/decoration-builder";

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
      console.log("[TypeParsing] Decorations built:", positions, decorations);
      editor.setDecorations(decorationType, decorations);
    } catch (error) {
      console.error("[TypeParsing] Update failed:", error);
    }
  }
}

export function deactivate() {
  decorationType?.dispose();
}
