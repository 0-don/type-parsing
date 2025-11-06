import * as vscode from "vscode";

export interface TemplatePart {
  type: "static" | "variable";
  value: string;
  position?: vscode.Position;
}

export interface TemplateLiteralPosition {
  variablePosition: vscode.Position;
  lineEndPosition: vscode.Position;
  templateParts: TemplatePart[];
}
