// src/resolvers/value-extractor.ts - Extract values from TypeScript declarations
import * as ts from "typescript";
import * as vscode from "vscode";
import { findDeclarationInFile, findImportDeclaration, findExportedDeclaration, extractStringLiteralsFromType } from "../utils/typescript-helpers";
import { resolveImportPath } from "./import-resolver";

/**
 * Extract values from a TypeScript declaration (enum, type alias, variable)
 */
export async function extractValuesFromDeclaration(
  declaration: ts.Node,
  sourceFile: ts.SourceFile,
  document?: vscode.TextDocument
): Promise<string[]> {
  if (ts.isEnumDeclaration(declaration)) {
    return declaration.members.map((member) =>
      member.initializer && ts.isStringLiteral(member.initializer)
        ? member.initializer.text
        : member.name.getText(sourceFile)
    );
  }

  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    if (ts.isObjectLiteralExpression(declaration.initializer)) {
      return declaration.initializer.properties
        .filter(ts.isPropertyAssignment)
        .map((prop) => prop.name.getText(sourceFile).replace(/"/g, ""));
    }

    if (
      ts.isAsExpression(declaration.initializer) &&
      ts.isObjectLiteralExpression(declaration.initializer.expression)
    ) {
      return declaration.initializer.expression.properties
        .filter(ts.isPropertyAssignment)
        .map((prop) => prop.name.getText(sourceFile).replace(/"/g, ""));
    }

    // For type assertions, try to resolve the type first
    if (ts.isAsExpression(declaration.initializer)) {
      const typeName = declaration.initializer.type.getText(sourceFile);
      let typeDecl = findDeclarationInFile(sourceFile, typeName);

      // If type not found in current file, try to find it in imports
      if (!typeDecl && document) {
        try {
          const importDecl = findImportDeclaration(sourceFile, typeName);
          if (importDecl) {
            const importPath = await resolveImportPath(importDecl, document);
            if (importPath) {
              const importedDoc = await vscode.workspace.openTextDocument(
                importPath
              );
              const importedSourceFile = ts.createSourceFile(
                importedDoc.fileName,
                importedDoc.getText(),
                ts.ScriptTarget.Latest,
                true
              );
              typeDecl = findExportedDeclaration(
                importedSourceFile,
                typeName
              );
            }
          }
        } catch (error) {
          console.error(
            "[TypeParsing] Type import resolution failed:",
            error
          );
        }
      }

      // If we found the type declaration, extract values from it
      if (typeDecl) {
        const typeValues = await extractValuesFromDeclaration(
          typeDecl,
          typeDecl.getSourceFile?.() || sourceFile,
          document
        );
        if (typeValues.length > 0) {
          return typeValues;
        }
      }

      // Fallback to the literal value if type resolution fails
      if (ts.isStringLiteral(declaration.initializer.expression)) {
        return [declaration.initializer.expression.text];
      }
    }

    if (ts.isStringLiteral(declaration.initializer)) {
      return [declaration.initializer.text];
    }
  }

  if (ts.isTypeAliasDeclaration(declaration)) {
    return extractStringLiteralsFromType(declaration.type, sourceFile, extractValuesFromDeclaration);
  }

  return [];
}

/**
 * Resolve property value from a property assignment
 */
export async function resolvePropertyValue(
  property: ts.PropertyAssignment,
  sourceFile: ts.SourceFile,
  document: vscode.TextDocument
): Promise<string[]> {
  // For type assertions (as ExchangeTypeEnum), always prioritize the type
  if (ts.isAsExpression(property.initializer)) {
    const typeName = property.initializer.type.getText(sourceFile);
    let typeDecl = findDeclarationInFile(sourceFile, typeName);
    let typeDeclSourceFile = sourceFile;
    let typeDeclDocument = document;

    if (!typeDecl) {
      try {
        const importDecl = findImportDeclaration(sourceFile, typeName);
        if (importDecl) {
          const importPath = await resolveImportPath(importDecl, document);
          if (importPath) {
            const importedDoc = await vscode.workspace.openTextDocument(
              importPath
            );
            const importedSourceFile = ts.createSourceFile(
              importedDoc.fileName,
              importedDoc.getText(),
              ts.ScriptTarget.Latest,
              true
            );
            typeDecl = findExportedDeclaration(importedSourceFile, typeName);
            if (typeDecl) {
              typeDeclSourceFile = importedSourceFile;
              typeDeclDocument = importedDoc;
            }
          }
        }
      } catch (error) {
        console.error("[TypeParsing] Import resolution failed:", error);
      }
    }

    if (typeDecl) {
      const typeValues = await extractValuesFromDeclaration(
        typeDecl,
        typeDeclSourceFile,
        typeDeclDocument
      );
      if (typeValues.length > 0) {
        return typeValues;
      }
    }

    // Only fallback to actual value if type resolution fails
    if (ts.isStringLiteral(property.initializer.expression)) {
      return [property.initializer.expression.text];
    }
  }

  if (ts.isIdentifier(property.initializer)) {
    const referencedDecl = findDeclarationInFile(
      sourceFile,
      property.initializer.text
    );
    if (referencedDecl) {
      return await extractValuesFromDeclaration(
        referencedDecl,
        sourceFile,
        document
      );
    }
  }

  if (ts.isStringLiteral(property.initializer)) {
    return [property.initializer.text];
  }

  return [];
}
