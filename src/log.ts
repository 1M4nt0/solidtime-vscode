import * as vscode from "vscode";

export let outputChannel: vscode.OutputChannel;

export function log(message: string) {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Solidtime");
  }
  outputChannel.appendLine(`[${new Date().toLocaleString()}] ${message}`);
}
