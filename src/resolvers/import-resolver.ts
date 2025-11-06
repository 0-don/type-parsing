// src/resolvers/import-resolver.ts - Import path resolution
import * as ts from "typescript";
import * as vscode from "vscode";

/**
 * Resolve an import path to a file URI
 */
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
