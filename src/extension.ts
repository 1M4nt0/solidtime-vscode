import * as vscode from "vscode";
import { getEntries, getMember } from "./api";
import { log } from "./log";
import { TimeTracker } from "./tracker";
import { registerCommands } from "./commands";

let timeTracker: TimeTracker;
let apiKey: string = "";
let apiUrl: string = "";
let orgId: string = "";
let memberId: string = "";
let startTime: number;
let totalTime: number = 0;
let isVSCodeFocused: boolean = true;
let lastCodingActivity: number = Date.now();

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

  try {
    memberId = await getMember(apiKey, apiUrl, orgId);
  } catch (error) {
    log("member fetch failed", error);
  }

  startTime = Date.now();
  log("session started", {
    sessionStartTime: new Date(startTime).toISOString(),
  });

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
    () => debouncedActivity(),
    null,
    context.subscriptions
  );
  vscode.window.onDidChangeTextEditorSelection(
    () => debouncedActivity(),
    null,
    context.subscriptions
  );

  vscode.window.onDidChangeWindowState(
    (state) => {
      isVSCodeFocused = state.focused;
      if (state.focused) {
        timeTracker.updateFocusState(true);
        log("vscode gained focus");
      } else {
        timeTracker.updateFocusState(false);
        log("vscode lost focus");
      }
    },
    null,
    context.subscriptions
  );

  try {
    log("fetching today's entries");
    const entries = await getEntries(apiKey, apiUrl, orgId);
    const initialTime = entries.reduce(
      (total, entry) => total + entry.duration,
      0
    );
    totalTime = initialTime;
    timeTracker.setInitialTime(initialTime);
    const initialTimeSeconds = Math.floor(initialTime / 1000);
    log("entries loaded", {
      totalTime: `${initialTimeSeconds}s`,
      count: entries.length,
    });
  } catch (error) {
    log("entries load failed", error);
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
