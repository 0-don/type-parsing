import * as path from "path";
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

  // Handle relative imports
  if (importPath.startsWith("./") || importPath.startsWith("../")) {
    return resolveRelativeImport(importPath, documentDir);
  }

  // Use TypeScript's module resolution for everything else
  return resolveWithTypeScript(importPath, document);
}

async function resolveWithTypeScript(
  importPath: string,
  document: vscode.TextDocument
): Promise<vscode.Uri | undefined> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
    return undefined;
  }

  try {
    // Find and parse tsconfig.json or jsconfig.json
    const configPath =
      ts.findConfigFile(
        path.dirname(document.uri.fsPath),
        ts.sys.fileExists,
        "tsconfig.json"
      ) ||
      ts.findConfigFile(
        path.dirname(document.uri.fsPath),
        ts.sys.fileExists,
        "jsconfig.json"
      );

    if (!configPath) {
      return undefined;
    }

    // Read and parse the config file
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
      return undefined;
    }

    // Parse the config with TypeScript's built-in parser
    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath)
    );

    // Use TypeScript's module resolution
    const resolved = ts.resolveModuleName(
      importPath,
      document.uri.fsPath,
      parsedConfig.options,
      ts.sys
    );

    if (resolved.resolvedModule) {
      const resolvedPath = resolved.resolvedModule.resolvedFileName;
      return vscode.Uri.file(resolvedPath);
    }

    return undefined;
  } catch (error) {
    return undefined;
  }
}

async function resolveRelativeImport(
  importPath: string,
  documentDir: vscode.Uri
): Promise<vscode.Uri | undefined> {
  const hasExtension = /\.(m?[tj]sx?|[cm]js)$/.test(importPath);

  if (hasExtension) {
    const extensions = [
      importPath.replace(/\.m?js$/, ".ts"),
      importPath.replace(/\.m?js$/, ".tsx"),
      importPath.replace(/\.m?js$/, ".mts"),
      importPath.replace(/\.cjs$/, ".cts"),
      importPath,
    ];

    for (const ext of extensions) {
      const resolvedPath = vscode.Uri.joinPath(documentDir, ext);
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
