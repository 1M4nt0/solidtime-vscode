import * as vscode from "vscode";
import { sendUpdate, getEntries, getMember } from "./api";
import { formatTimeSpent, hasTimePassed } from "./time";
import { log } from "./log";

let statusBar: vscode.StatusBarItem;
let timer: NodeJS.Timer;
let startTime: number;
let lastActiveTime: number;
let totalTime: number = 0;
let apiKey: string | undefined;
let apiUrl: string | undefined;
let orgId: string | undefined;
let memberId: string | undefined;
const IDLE_TIMEOUT = 2 * 60 * 1000;
let currentFile: string;
let lastHeartbeat: number = 0;

export async function activate(context: vscode.ExtensionContext) {
  log("extension activating");
  const config = vscode.workspace.getConfiguration("solidtime", null);
  apiKey = config.get("apiKey") || "";
  apiUrl = config.get("apiUrl") || "";
  orgId = config.get("organizationId") || "";
  log("initial config", { hasKey: !!apiKey, apiUrl, orgId });
  if (apiUrl) {
    apiUrl = apiUrl.replace(/\/api\/v1/g, "").replace(/\/+$/, "");
    await config.update("apiUrl", apiUrl, true);
    log("api url normalized", { apiUrl });
  }
  if (!apiKey) {
    log("no api key found");
    const key = await vscode.window.showInputBox({
      placeHolder: "Enter your Solidtime API key",
      prompt: "Enter your Solidtime API key",
    });
    if (key) {
      apiKey = key;
      await config.update("apiKey", apiKey, true);
      log("api key saved");
    } else {
      log("no api key provided");
      return;
    }
  }
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  statusBar.text = `$(clock) 0h 0m`;
  statusBar.show();
  startTime = Date.now();
  lastActiveTime = startTime;
  log("status bar initialized", { startTime });
  vscode.window.onDidChangeTextEditorSelection(onActivity, null, context.subscriptions);
  vscode.window.onDidChangeActiveTextEditor(onActivity, null, context.subscriptions);
  vscode.workspace.onDidSaveTextDocument(onActivity, null, context.subscriptions);
  timer = setInterval(async () => {
    const currentTime = Date.now();
    if (currentTime - lastActiveTime > IDLE_TIMEOUT) {
      log("user idle");
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const fileName = editor.document.fileName;
      const time = Date.now();
      if (hasTimePassed(lastHeartbeat, time) || currentFile !== fileName) {
        try {
          await sendUpdate(totalTime, apiKey as string, apiUrl as string, orgId as string, memberId as string, startTime);
          currentFile = fileName;
          lastHeartbeat = time;
        } catch (error) {
          log("update failed", error);
        }
      }
    }
  }, 60000);
  context.subscriptions.push(
    vscode.commands.registerCommand("solidtime.setApiKey", async () => {
      const config = vscode.workspace.getConfiguration("solidtime", null);
      const key = await vscode.window.showInputBox({
        prompt: "Enter your Solidtime API key",
        value: apiKey,
      });
      if (key) {
        apiKey = key;
        await config.update("apiKey", apiKey, true);
        vscode.window.showInformationMessage("API key updated");
        log("api key updated");
      }
    }),
    vscode.commands.registerCommand("solidtime.setApiUrl", async () => {
      const config = vscode.workspace.getConfiguration("solidtime", null);
      const url = await vscode.window.showInputBox({
        prompt: "Enter your Solidtime instance API URL",
        value: apiUrl,
      });
      if (url) {
        apiUrl = url.replace(/\/api\/v1/g, "").replace(/\/+$/, "");
        await config.update("apiUrl", apiUrl, true);
        vscode.window.showInformationMessage("API URL updated");
        log("api url updated", { apiUrl });
      }
    }),
    vscode.commands.registerCommand("solidtime.setOrganizationId", async () => {
      const config = vscode.workspace.getConfiguration("solidtime", null);
      const orgInput = await vscode.window.showInputBox({
        prompt: "Enter your Organization ID",
        value: orgId,
      });
      if (orgInput) {
        orgId = orgInput;
        await config.update("organizationId", orgId, true);
        log("organization id updated", { orgId });
      }
    }),
    vscode.commands.registerCommand("solidtime.refreshMemberId", async () => {
      try {
        memberId = await getMember(apiKey as string, apiUrl as string);
      } catch (error) {
        log("member refresh failed", error);
      }
    }),
    vscode.commands.registerCommand("solidtime.forceTimeUpdate", async () => {
      try {
        await sendUpdate(totalTime, apiKey as string, apiUrl as string, orgId as string, memberId as string, startTime);
        vscode.window.showInformationMessage("Time update sent");
      } catch (error) {
        vscode.window.showErrorMessage("Time update failed");
        log("force update failed", error);
      }
    })
  );
  vscode.window.onDidChangeWindowState((state) => {
    if (state.focused) {
      lastActiveTime = Date.now();
    }
  });
  try {
    log("fetching today's entries");
    const entries = await getEntries(apiKey as string, apiUrl as string, orgId as string);
    totalTime = entries.reduce((total, entry) => total + entry.duration, 0);
    statusBar.text = `$(clock) ${formatTimeSpent(totalTime)}`;
    log("entries loaded", { totalTime, count: entries.length });
  } catch (error) {
    log("entries load failed", error);
  }
  try {
    memberId = await getMember(apiKey as string, apiUrl as string);
  } catch (error) {
    log("member fetch failed", error);
  }
  log("extension activated");
}

export function deactivate() {
  log("extension deactivating");
  if (timer) {
    clearInterval(timer);
    log("timer cleared");
  }
}

function onActivity() {
  lastActiveTime = Date.now();
}