import * as vscode from "vscode";
import { sendUpdate, getEntries, getMember, getOrganizations, getProjects, createProject } from "./api";
import { formatTimeSpent, hasTimePassed } from "./time";
import { log, outputChannel } from "./log";

let statusBar: vscode.StatusBarItem;
let timer: NodeJS.Timer | undefined;
let startTime: number;
let lastActiveTime: number;
let totalTime: number = 0;
let initialTime: number = 0;
let apiKey: string | undefined;
let apiUrl: string | undefined;
let orgId: string | undefined;
let memberId: string | undefined;
const IDLE_TIMEOUT = 2 * 60 * 1000;
let currentFile: string;
let dedupe: {[key: string]: {time: number, file: string}} = {};

interface QuickPickItem extends vscode.QuickPickItem {
  label: string;
  description?: string;
}

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
      prompt: "Enter your Solidtime API key"
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
  statusBar = vscode.window.createStatusBarItem("solidtime.time", vscode.StatusBarAlignment.Left, 3);
  statusBar.name = "Solidtime"
  statusBar.text = `$(clock) 0 hrs 0 mins`;
  statusBar.tooltip = "Solidtime: Today's coding time. Click to visit dashboard.";
  statusBar.command = 'solidtime.dashboard';
  statusBar.show();
  startTime = Date.now();
  lastActiveTime = startTime;
  log("status bar initialized", { startTime });
  vscode.window.onDidChangeTextEditorSelection(onActivity, null, context.subscriptions);
  vscode.window.onDidChangeActiveTextEditor(onActivity, null, context.subscriptions);
  vscode.workspace.onDidSaveTextDocument(onActivity, null, context.subscriptions);
  try {
    log("fetching today's entries");
    const entries = await getEntries(apiKey as string, apiUrl as string, orgId as string);
    initialTime = entries.reduce((total, entry) => total + entry.duration, 0);
    totalTime = initialTime;
    statusBar.text = `$(clock) ${formatTimeSpent(totalTime)}`;
    log("entries loaded", { totalTime, count: entries.length });
  } catch (error) {
    log("entries load failed", error);
  }
  try {
    memberId = await getMember(apiKey as string, apiUrl as string, orgId as string);
  } catch (error) {
    log("member fetch failed", error);
  }
  timer = setInterval(async () => {
    const currentTime = Date.now();
    if (currentTime - lastActiveTime > IDLE_TIMEOUT) {
      log("user idle");
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const fileName = editor.document.fileName;
      const timeElapsed = currentTime - startTime;
      
      const key = `${fileName}`;
      if (!dedupe[key] || hasTimePassed(dedupe[key].time, currentTime) || currentFile !== fileName) {
        try {
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          const mappings = config.get<Record<string, string | null>>("projectMappings", {});
          const projectId = workspaceFolder ? mappings[workspaceFolder.uri.toString()] : null;

          const data = {
            project_id: projectId || null
          };

          await sendUpdate(timeElapsed, apiKey as string, apiUrl as string, orgId as string, memberId as string, startTime, data);
          currentFile = fileName;
          dedupe[key] = {
            time: currentTime,
            file: fileName
          };
          totalTime = initialTime + timeElapsed;
          statusBar.text = `$(clock) ${formatTimeSpent(totalTime)}`;
          log("time updated", { totalTime, elapsed: timeElapsed });
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
        value: apiKey
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
        value: apiUrl
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
      const manualInput = { label: "Enter Organization ID manually" };
      
      try {
        const orgs = await getOrganizations(apiKey as string, apiUrl as string);
        const selected = await vscode.window.showQuickPick<QuickPickItem>(
          [manualInput, ...orgs.map(org => ({ label: org.name, description: org.id }))],
          { placeHolder: "Select your Organization or enter ID manually" }
        );

        if (selected === manualInput) {
          const id = await vscode.window.showInputBox({
            placeHolder: "Enter Organization ID",
            prompt: "Enter your Organization ID"
          });
          if (id) {
            orgId = id;
            await config.update("organizationId", orgId, true);
          }
        } else if (selected) {
          orgId = selected.description;
          await config.update("organizationId", orgId, true);
        }
      } catch (error) {
        vscode.window.showErrorMessage("Failed to fetch organizations");
        log("get organizations failed", error);
      }
    }),
    vscode.commands.registerCommand("solidtime.refreshMemberId", async () => {
      try {
        memberId = await getMember(apiKey as string, apiUrl as string, orgId as string);
      } catch (error) {
        log("member refresh failed", error);
      }
    }),
    vscode.commands.registerCommand("solidtime.forceTimeUpdate", async () => {
      try {
        await sendUpdate(totalTime, apiKey as string, apiUrl as string, orgId as string, memberId as string, startTime, { project_id: null });
        vscode.window.showInformationMessage("Time update sent");
      } catch (error) {
        vscode.window.showErrorMessage("Time update failed");
        log("force update failed", error);
      }
    }),
    vscode.commands.registerCommand("solidtime.setProject", async () => {
      const config = vscode.workspace.getConfiguration("solidtime");
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;

      try {
        const projects = await getProjects(apiKey as string, apiUrl as string, orgId as string);
        const createNewOption = { label: "➕ Create New Project" };
        const manualInput = { label: "Enter Project ID manually" };
        
        const selected = await vscode.window.showQuickPick<QuickPickItem>(
          [manualInput, createNewOption, ...projects.map(p => ({ label: p.name, description: p.id }))],
          { placeHolder: "Select project, create new, or enter ID" }
        );

        if (!selected) return;

        let projectId;
        if (selected === manualInput) {
          const id = await vscode.window.showInputBox({
            placeHolder: "Enter Project ID",
            prompt: "Enter your Project ID"
          });
          if (!id) return;
          projectId = id;
        } else if (selected === createNewOption) {
          const name = await vscode.window.showInputBox({
            placeHolder: "Enter project name",
            value: workspaceFolder.name
          });
          if (!name) return;
          const newProject = await createProject(apiKey as string, apiUrl as string, orgId as string, name);
          projectId = newProject.id;
        } else {
          projectId = selected.description;
        }

        if (!projectId) return;
        const mappings = config.get<Record<string, string | null>>("projectMappings", {});
        mappings[workspaceFolder.uri.toString()] = projectId;
        await config.update("projectMappings", mappings, true);
      } catch (error) {
        vscode.window.showErrorMessage("Failed to set project");
        log("project set failed", error);
      }
    }),
    vscode.commands.registerCommand("solidtime.dashboard", () => {
      const dashboardUrl = `${apiUrl}/dashboard`;
      vscode.env.openExternal(vscode.Uri.parse(dashboardUrl));
    }),
    vscode.commands.registerCommand("solidtime.showOutput", () => {
      outputChannel.show();
    })
  );
  vscode.window.onDidChangeWindowState((state) => {
    if (state.focused) {
      lastActiveTime = Date.now();
    }
  });
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