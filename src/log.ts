import * as vscode from "vscode";

export let outputChannel: vscode.OutputChannel;

export function log(message: string, data?: any) {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Solidtime");
  }
  outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  if (data) {
    if (data instanceof Error) {
      outputChannel.appendLine(data.toString());
      outputChannel.appendLine(data.stack || "No stack trace");
    } else {
      outputChannel.appendLine(JSON.stringify(data, null, 2));
    }
  }
}
