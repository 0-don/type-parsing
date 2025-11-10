import * as ts from "typescript";
import * as vscode from "vscode";
import {
  extractStringLiteralsFromType,
  findDeclarationInFile,
  findExportedDeclaration,
  findImportDeclaration,
} from "../utils/typescript-helpers";
import { resolveImportPath } from "./import-resolver";

export async function extractValuesFromDeclaration(
  declaration: ts.Node,
  sourceFile: ts.SourceFile,
  document?: vscode.TextDocument
): Promise<string[]> {
  console.log(
    `[TypeParsing] Extracting values from declaration type: ${
      ts.SyntaxKind[declaration.kind]
    }`
  );

  if (ts.isEnumDeclaration(declaration)) {
    const values = declaration.members.map((member) =>
      member.initializer && ts.isStringLiteral(member.initializer)
        ? member.initializer.text
        : member.name.getText(sourceFile)
    );
    console.log(`[TypeParsing] Enum values:`, values);
    return values;
  }

  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    console.log(`[TypeParsing] Variable declaration with initializer`);

    if (ts.isObjectLiteralExpression(declaration.initializer)) {
      const values = declaration.initializer.properties
        .filter(ts.isPropertyAssignment)
        .map((prop) => prop.name.getText(sourceFile).replace(/"/g, ""));
      console.log(`[TypeParsing] Object literal values:`, values);
      return values;
    }

    if (
      ts.isAsExpression(declaration.initializer) &&
      ts.isObjectLiteralExpression(declaration.initializer.expression)
    ) {
      const values = declaration.initializer.expression.properties
        .filter(ts.isPropertyAssignment)
        .map((prop) => prop.name.getText(sourceFile).replace(/"/g, ""));
      console.log(`[TypeParsing] As expression object literal values:`, values);
      return values;
    }

    if (ts.isAsExpression(declaration.initializer)) {
      console.log(`[TypeParsing] As expression, looking for type`);
      const typeName = declaration.initializer.type.getText(sourceFile);
      let typeDecl = findDeclarationInFile(sourceFile, typeName);

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
              typeDecl = findExportedDeclaration(importedSourceFile, typeName);
            }
          }
        } catch (error) {
          console.error("[TypeParsing] Type import resolution failed:", error);
        }
      }

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

      if (ts.isStringLiteral(declaration.initializer.expression)) {
        return [declaration.initializer.expression.text];
      }
    }

    if (ts.isStringLiteral(declaration.initializer)) {
      return [declaration.initializer.text];
    }
  }

  if (ts.isTypeAliasDeclaration(declaration)) {
    console.log(`[TypeParsing] Type alias declaration`);
    const typeText = declaration.type.getText(sourceFile);
    console.log(`[TypeParsing] Type text: ${typeText}`);

    // Handle the pattern: (typeof X)[keyof typeof X]
    const typeofMatch = typeText.match(
      /\(typeof\s+(\w+)\)\[keyof\s+typeof\s+\w+\]/
    );
    if (typeofMatch) {
      const objectName = typeofMatch[1];
      console.log(
        `[TypeParsing] Found typeof pattern, looking for const object: ${objectName}`
      );

      // Find the const object with the same name (not the type alias)
      const objectDecl = findConstObjectDeclaration(sourceFile, objectName);
      if (objectDecl) {
        console.log(`[TypeParsing] Found const object declaration`);
        const objectValues = await extractValuesFromDeclaration(
          objectDecl,
          sourceFile,
          document
        );
        if (objectValues.length > 0) {
          console.log(
            `[TypeParsing] Object values from typeof pattern:`,
            objectValues
          );
          return objectValues;
        }
      }
    }

    const typeValues = await extractStringLiteralsFromType(
      declaration.type,
      sourceFile,
      extractValuesFromDeclaration
    );
    console.log(`[TypeParsing] Type alias values:`, typeValues);
    return typeValues;
  }

  if (ts.isPropertySignature(declaration) && declaration.type) {
    console.log(`[TypeParsing] Property signature with type`);
    const typeName = declaration.type.getText(sourceFile);
    console.log(`[TypeParsing] Property type name: ${typeName}`);

    // Try to find the type declaration
    let typeDecl = findDeclarationInFile(sourceFile, typeName);
    let typeDeclSourceFile = sourceFile;
    let typeDeclDocument = document;

    if (!typeDecl && document) {
      console.log(`[TypeParsing] Type not found locally, checking imports`);
      try {
        const importDecl = findImportDeclaration(sourceFile, typeName);
        if (importDecl) {
          console.log(`[TypeParsing] Found import for type`);
          const importPath = await resolveImportPath(importDecl, document);
          if (importPath) {
            console.log(`[TypeParsing] Resolved import path: ${importPath.fsPath}`);
            const importedDoc = await vscode.workspace.openTextDocument(importPath);
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
              console.log(`[TypeParsing] Found type declaration in imported file`);
            }
          }
        }
      } catch (error) {
        console.error("[TypeParsing] Property type import resolution failed:", error);
      }
    }

    if (typeDecl) {
      const values = await extractValuesFromDeclaration(
        typeDecl,
        typeDeclSourceFile,
        typeDeclDocument
      );
      if (values.length > 0) {
        console.log(`[TypeParsing] Property type values:`, values);
        return values;
      }
    }

    // If it's a union type node, extract directly
    if (declaration.type && ts.isUnionTypeNode(declaration.type)) {
      const values = await extractStringLiteralsFromType(
        declaration.type,
        sourceFile,
        extractValuesFromDeclaration
      );
      console.log(`[TypeParsing] Property union type values:`, values);
      return values;
    }
  }
  console.log(`[TypeParsing] No values extracted from declaration`);
  return [];
}

export function findConstObjectDeclaration(
  sourceFile: ts.SourceFile,
  name: string
): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;

  function visit(node: ts.Node) {
    if (found) {
      return;
    }

    // Look specifically for const variable declarations
    if (ts.isVariableStatement(node)) {
      const declaration = node.declarationList.declarations.find(
        (decl) => {
          if (!ts.isIdentifier(decl.name) || decl.name.text !== name || !decl.initializer) {
            return false;
          }

          // Handle both direct object literals and "as const" expressions
          if (ts.isObjectLiteralExpression(decl.initializer)) {
            return true;
          }
          
          // Handle "as const" pattern: { ... } as const
          if (ts.isAsExpression(decl.initializer) && 
              ts.isObjectLiteralExpression(decl.initializer.expression)) {
            return true;
          }

          return false;
        }
      );
      
      if (declaration) {
        found = declaration;
        return;
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  console.log(`[TypeParsing] findConstObjectDeclaration for ${name}: ${found ? 'found' : 'not found'}`);
  return found;
}

export async function resolvePropertyValue(
  property: ts.PropertyAssignment,
  sourceFile: ts.SourceFile,
  document: vscode.TextDocument
): Promise<string[]> {
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
