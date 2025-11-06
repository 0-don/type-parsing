import * as ts from "typescript";
import * as vscode from "vscode";

export async function resolveImportPath(
  importDecl: ts.ImportDeclaration,
  document: vscode.TextDocument
): Promise<vscode.Uri | undefined> {
  if (!ts.isStringLiteral(importDecl.moduleSpecifier)) {
    return undefined;
  }

  const importPath = importDecl.moduleSpecifier.text;
  const documentDir = vscode.Uri.joinPath(document.uri, "..");

  if (importPath.startsWith("./") || importPath.startsWith("../")) {
    const hasExtension = /\.(m?[tj]sx?|[cm]js)$/.test(importPath);

    if (hasExtension) {
      const extensions = [
        importPath.replace(/\.m?js$/, ".ts"),
        importPath.replace(/\.m?js$/, ".tsx"),
        importPath.replace(/\.m?js$/, ".mts"),
        importPath.replace(/\.cjs$/, ".cts"),
        importPath,
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

      return vscode.Uri.joinPath(documentDir, importPath);
    } else {
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

      return vscode.Uri.joinPath(documentDir, importPath + ".ts");
    }
  }

  return undefined;
}
