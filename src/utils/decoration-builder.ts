import * as ts from "typescript";
import * as vscode from "vscode";
import { generateCombinations } from "../parsers/template-literal-parser";
import { resolveVariable } from "../resolvers/variable-resolver";
import { TemplateLiteralPosition } from "../types";

export async function buildDecorations(
  positions: TemplateLiteralPosition[],
  document: vscode.TextDocument
): Promise<vscode.DecorationOptions[]> {
  const grouped = groupByLineEnd(positions);
  const decorations: vscode.DecorationOptions[] = [];

  for (const group of grouped.values()) {
    const varValues = await resolveVariableValues(group, document);
    if (varValues.size === 0) {
      continue;
    }

    const combinations = generateCombinations(
      group[0].templateParts,
      varValues
    );

    if (combinations.length > 0) {
      const displayText =
        combinations.length > 5
          ? `${combinations.slice(0, 5).join(", ")}... (${
              combinations.length
            } total)`
          : combinations.join(", ");

      decorations.push({
        range: new vscode.Range(
          group[0].lineEndPosition,
          group[0].lineEndPosition
        ),
        renderOptions: {
          after: { contentText: ` // ${displayText}` },
        },
      });
    }
  }

  return decorations;
}

function groupByLineEnd(
  positions: TemplateLiteralPosition[]
): Map<string, TemplateLiteralPosition[]> {
  const map = new Map<string, TemplateLiteralPosition[]>();
  for (const pos of positions) {
    const key = `${pos.lineEndPosition.line}:${pos.lineEndPosition.character}`;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(pos);
  }
  return map;
}

async function resolveVariableValues(
  group: TemplateLiteralPosition[],
  document: vscode.TextDocument
): Promise<Map<string, string[]>> {
  const varValues = new Map<string, string[]>();
  const sourceFile = ts.createSourceFile(
    document.fileName,
    document.getText(),
    ts.ScriptTarget.Latest,
    true
  );

  for (const pos of group) {
    for (const part of pos.templateParts) {
      if (part.type === "variable") {
        const values = await resolveVariable(
          part.value,
          part.position,
          document,
          sourceFile
        );
        if (values.length > 0) {
          varValues.set(part.value, values);
        }
      }
    }
  }

  return varValues;
}
