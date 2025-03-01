import * as vscode from "vscode";
import { getEntries, getMember } from "./api";
import { log } from "./log";
import { TimeTracker } from "./tracker";
import { registerCommands } from "./commands";

let timeTracker: TimeTracker;
let startTime: number;
let totalTime: number = 0;
let isVSCodeFocused: boolean = true;
let lastCodingActivity: number = Date.now();

export async function activate(context: vscode.ExtensionContext) {
  log("extension activating");

  const config = vscode.workspace.getConfiguration("solidtime", null);
  let apiKey = config.get<string>("apiKey") || "";
  let apiUrl = config.get<string>("apiUrl") || "";
  let orgId = config.get<string>("organizationId") || "";
  let memberId = "";

  log(
    `initial config: apiKey exists: ${!!apiKey}, apiUrl: ${apiUrl}, orgId: ${orgId}`
  );

  if (apiUrl) {
    apiUrl = apiUrl.replace(/\/api\/v1/g, "").replace(/\/+$/, "");
    await config.update("apiUrl", apiUrl, true);
    log(`api url normalized to ${apiUrl}`);
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

  try {
    memberId = await getMember(apiKey, apiUrl, orgId);
  } catch (error) {
    log(`member fetch failed: ${error}`);
  }

  startTime = Date.now();
  log(`session started at ${new Date(startTime).toISOString()}`);

  timeTracker = new TimeTracker(apiKey, apiUrl, orgId, memberId, startTime);
  lastCodingActivity = startTime;

  let activityTimeout: NodeJS.Timeout | null = null;
  const debouncedActivity = () => {
    if (activityTimeout) {
      clearTimeout(activityTimeout);
    }
    activityTimeout = setTimeout(() => {
      lastCodingActivity = Date.now();
      timeTracker.onActivity();
    }, 1000) as unknown as NodeJS.Timeout;
  };

  vscode.workspace.onDidChangeTextDocument(
    debouncedActivity,
    null,
    context.subscriptions
  );
  vscode.window.onDidChangeTextEditorSelection(
    debouncedActivity,
    null,
    context.subscriptions
  );
  vscode.window.onDidChangeActiveTextEditor(
    debouncedActivity,
    null,
    context.subscriptions
  );

  vscode.window.onDidChangeWindowState(
    (state) => {
      isVSCodeFocused = state.focused;
      timeTracker.updateFocusState(state.focused);
    },
    null,
    context.subscriptions
  );

  try {
    log("fetching today's entries");
    const entries = await getEntries(apiKey, apiUrl, orgId);

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const mappings = config.get<Record<string, string | null>>(
      "projectMappings",
      {}
    );
    const currentProjectId = workspaceFolder
      ? mappings[workspaceFolder.uri.toString()]
      : null;

    log(`current project id at startup: ${currentProjectId || "No project"}`);

    const totalDailyTime = entries.reduce(
      (total, entry) => total + entry.duration,
      0
    );

    log(`total daily time: ${Math.floor(totalDailyTime / 1000)}s across all projects`);

    totalTime = totalDailyTime;
    timeTracker.setInitialTime(totalDailyTime);
    log(`entries loaded: ${Math.floor(totalDailyTime / 1000)}s total from ${entries.length} entries`);

    await timeTracker.forceUpdate();
  } catch (error) {
    log(`entries load failed: ${error}`);
  }

  timeTracker.startTracking(
    context,
    () => isVSCodeFocused,
    () => lastCodingActivity
  );

  registerCommands(
    context,
    timeTracker,
    apiKey,
    apiUrl,
    orgId,
    memberId,
    totalTime,
    startTime
  );

  log("extension activated");
}

export function deactivate() {
  log("extension deactivating");
  if (timeTracker) {
    timeTracker.dispose();
  }
}
