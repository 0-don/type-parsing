import * as ts from "typescript";
import * as vscode from "vscode";
import { TemplateLiteralPosition, TemplatePart } from "../types";

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
        // Clean up the variable expression by removing TypeScript operators
        const rawExpression = span.expression.getText(sourceFile);
        const cleanExpression = cleanVariableExpression(rawExpression);

        // For property access (e.g., "lang.code"), use END-1 position to get the property type
        // For simple identifiers (e.g., "type"), use START+1 position to be inside the identifier
        const isPropertyAccess = rawExpression.includes(".");

        const targetPos = isPropertyAccess
          ? span.expression.getEnd() - 1
          : span.expression.getStart() + 1;

        const posData = sourceFile.getLineAndCharacterOfPosition(targetPos);
        const position = new vscode.Position(posData.line, posData.character);

        templateParts.push({
          type: "variable",
          value: cleanExpression,
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

function cleanVariableExpression(expression: string): string {
  // Remove TypeScript operators that don't affect the variable resolution
  return expression
    .replace(/!/g, '')           // Remove non-null assertion operator
    .replace(/\?/g, '');         // Remove optional chaining operator
}

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
