// src/parsers/template-literal-parser.ts - Parse template literals from source code
import * as ts from "typescript";
import * as vscode from "vscode";
import { TemplateLiteralPosition, TemplatePart } from "../types";

/**
 * Find all template literals in a document
 */
export function findTemplateLiterals(
  document: vscode.TextDocument
): TemplateLiteralPosition[] {
  const positions: TemplateLiteralPosition[] = [];

  const sourceFile = ts.createSourceFile(
    document.fileName,
    document.getText(),
    ts.ScriptTarget.Latest,
    true
  );

  function visit(node: ts.Node) {
    if (ts.isTemplateExpression(node)) {
      const templateParts: TemplatePart[] = [];

      templateParts.push({ type: "static", value: node.head.text });

      node.templateSpans.forEach((span) => {
        const start = sourceFile.getLineAndCharacterOfPosition(
          span.expression.getStart()
        );
        const position = new vscode.Position(start.line, start.character);

        templateParts.push({
          type: "variable",
          value: span.expression.getText(sourceFile),
          position,
        });

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

/**
 * Generate all possible string combinations from template parts and variable values
 */
export function generateCombinations(
  templateParts: TemplatePart[],
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
      const values = variableValues.get(part.value);
      if (values && values.length > 0) {
        for (const value of values.slice(0, 10)) {
          generate(index + 1, current + value);
        }
      } else {
        generate(index + 1, current + `{${part.value}}`);
      }
    }
  }

  generate(0, "");
  return results.slice(0, 20);
}
