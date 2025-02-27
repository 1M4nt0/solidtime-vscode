import * as vscode from "vscode";

let statusBarItem: vscode.StatusBarItem;
let timer: NodeJS.Timer;
let startTime: number;
let lastActiveTime: number;
let totalTime: number = 0;
let apiKey: string | undefined;
let apiUrl: string | undefined;
let organizationId: string | undefined;
let memberId: string | undefined;
const IDLE_TIMEOUT = 2 * 60 * 1000; // 2 minutes idle timeout
let outputChannel: vscode.OutputChannel;
let lastFile: string;
let lastHeartbeat: number = 0;
let dedupe: {[key: string]: {selection: vscode.Position, lastHeartbeatAt: number}} = {};

export async function activate(context: vscode.ExtensionContext) {
  log("Extension activating");

  const config = vscode.workspace.getConfiguration('solidtime', null);
  apiKey = config.get('apiKey') || "";
  apiUrl = config.get('apiUrl') || "";
  organizationId = config.get('organizationId') || "";

  log("Initial config loaded", { apiKey: !!apiKey, apiUrl, organizationId });

  if (apiUrl) {
    apiUrl = apiUrl.replace(/\/api\/v1/g, "").replace(/\/+$/, "");
    await config.update('apiUrl', apiUrl, true);
    log("API URL normalized", { apiUrl });
  }

  if (!apiKey) {
    log("No API key found, prompting user");
    const key = await vscode.window.showInputBox({
      placeHolder: "Enter your Solidtime API key",
      prompt: "Please enter your Solidtime API key",
    });
    if (key) {
      apiKey = key;
      await config.update('apiKey', apiKey, true);
      log("API key saved");
    } else {
      log("No API key provided, exiting");
      return;
    }
  }

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left
  );
  statusBarItem.text = `$(clock) 0 hrs 0 mins`;
  statusBarItem.show();
  startTime = Date.now();
  lastActiveTime = startTime;
  log("Status bar initialized", { startTime });

  // Setup activity tracking
  vscode.window.onDidChangeTextEditorSelection(onActivity, null, context.subscriptions);
  vscode.window.onDidChangeActiveTextEditor(onActivity, null, context.subscriptions);
  vscode.workspace.onDidSaveTextDocument(onActivity, null, context.subscriptions);
  
  timer = setInterval(async () => {
    const currentTime = Date.now();
    if (currentTime - lastActiveTime > IDLE_TIMEOUT) {
      log("User idle, skipping update");
      return;
    }
    
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const file = editor.document.fileName;
      const time = Date.now();
      
      if (enoughTimePassed(time) || lastFile !== file) {
        try {
          await sendTimeUpdate(totalTime);
          lastFile = file;
          lastHeartbeat = time;
        } catch (err) {
          log("Error sending time update", err);
        }
      }
    }
  }, 60000);

  context.subscriptions.push(
    vscode.commands.registerCommand("solidtime.setApiKey", async () => {
      const config = vscode.workspace.getConfiguration('solidtime', null);
      const key = await vscode.window.showInputBox({
        prompt: "Enter your Solidtime API key",
        value: apiKey,
      });
      if (key) {
        apiKey = key;
        await config.update('apiKey', key, true);
        vscode.window.showInformationMessage("API key updated successfully");
        log("API key updated");
      }
    }),
    vscode.commands.registerCommand("solidtime.setApiUrl", async () => {
      const config = vscode.workspace.getConfiguration('solidtime', null);
      const url = await vscode.window.showInputBox({
        prompt: "Enter your Solidtime instance API URL",
        value: apiUrl,
      });
      if (url) {
        apiUrl = url.replace(/\/api\/v1/g, "").replace(/\/+$/, "");
        await config.update('apiUrl', apiUrl, true);
        vscode.window.showInformationMessage("API URL updated successfully");
        log("API URL updated", { apiUrl });
      }
    }),
    vscode.commands.registerCommand("solidtime.setOrganizationId", async () => {
      const config = vscode.workspace.getConfiguration('solidtime', null);
      const orgId = await vscode.window.showInputBox({
        prompt: "Enter your Organization ID",
        value: organizationId,
      });
      if (orgId) {
        organizationId = orgId;
        await config.update('organizationId', orgId, true);
        log("Organization ID updated", { organizationId });
      }
    }),
    vscode.commands.registerCommand("solidtime.refreshMemberId", fetchMemberId),
    vscode.commands.registerCommand("solidtime.forceTimeUpdate", async () => {
      try {
        await sendTimeUpdate(totalTime);
        vscode.window.showInformationMessage("Time update sent successfully");
      } catch (err) {
        vscode.window.showErrorMessage("Failed to send time update");
        log("Force time update failed", err);
      }
    })
  );

  vscode.window.onDidChangeWindowState((state) => {
    if (state.focused) {
      lastActiveTime = Date.now();
    }
  });

  try {
    log("Fetching today's time entries");
    const entries = await fetchTodayTimeEntries();
    totalTime = entries.reduce((acc, entry) => acc + entry.duration, 0);
    statusBarItem.text = `$(clock) ${getTimeSpent()}`;
    log("Today's entries loaded", { totalTime, entriesCount: entries.length });
  } catch (err) {
    log("Failed to load existing entries", err);
  }

  await fetchMemberId();
  log("Extension activation complete");
}

function getTimeSpent(): string {
  const hours = Math.floor(totalTime / (1000 * 60 * 60));
  const minutes = Math.floor((totalTime % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

async function sendTimeUpdate(time: number): Promise<void> {
  log("Sending time update", { time });

  if (!apiKey || !apiUrl || !organizationId || !memberId) {
    log("Missing required config", {
      apiKey: !!apiKey,
      apiUrl: !!apiUrl,
      organizationId: !!organizationId,
      memberId: !!memberId,
    });
    return;
  }

  const formatDate = (date: Date) => {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  };

  const endpoint = `${apiUrl}/api/v1/organizations/${organizationId}/time-entries`;
  const start = new Date(startTime);
  const end = new Date(startTime + time);
  
  const payload = {
    member_id: memberId,
    start: formatDate(start),
    end: formatDate(end),
    billable: false,
    project_id: vscode.workspace.name || null,
    description: "Coding time from VSCode extension",
    tags: [],
  };

  log("Preparing API request", { endpoint, payload });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    log("API response received", { status: response.status, body: responseText });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText}`);
    }

    log("Time entry created successfully");
  } catch (err) {
    log("API request failed", err);
    throw err;
  }
}

async function fetchTodayTimeEntries(): Promise<TimeEntry[]> {
  log("Fetching today's time entries");

  if (!apiKey || !apiUrl || !organizationId) {
    log("Missing required config for fetching entries", {
      apiKey: !!apiKey,
      apiUrl: !!apiUrl,
      organizationId: !!organizationId,
    });
    return [];
  }

  const todayStart = new Date().toISOString().split("T")[0] + "T00:00:00Z";
  const todayEnd = new Date().toISOString().split("T")[0] + "T23:59:59Z";

  const endpoint = new URL(
    `${apiUrl}/api/v1/organizations/${organizationId}/time-entries`
  );
  endpoint.searchParams.set("start", todayStart);
  endpoint.searchParams.set("end", todayEnd);

  log("Fetching entries", { url: endpoint.toString() });

  try {
    const response = await fetch(endpoint.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const entries = data.data.map((entry: any) => ({
      id: entry.id,
      start: entry.start,
      duration: entry.duration * 1000,
      project: entry.project_id || "No project",
    }));

    log("Entries fetched successfully", { count: entries.length });
    return entries;
  } catch (err) {
    log("Failed to fetch entries", err);
    return [];
  }
}

interface TimeEntry {
  id: string;
  start: string;
  duration: number;
  project: string;
}

function log(message: string, data?: any) {
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
  outputChannel.show();
}

async function fetchMemberId(): Promise<void> {
  if (!apiKey || !apiUrl) {
    log("Missing API key or URL", { apiKey: !!apiKey, apiUrl });
    return;
  }

  const endpoint = `${apiUrl}/api/v1/users/me`;

  log("Fetching member ID", {
    url: endpoint,
    apiKeyPresent: !!apiKey,
  });

  try {
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    const text = await response.text();
    log("API Response", {
      status: response.status,
      body: text.substring(0, 500),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const data = JSON.parse(text);
    memberId = data.data.id;
    log("Member ID set", { memberId });
  } catch (err) {
    log("API Error", {
      message: err instanceof Error ? err.message : "Unknown error",
      endpoint,
      apiKeyPresent: !!apiKey,
    });
    throw err;
  }
}

export function deactivate() {
  log("Extension deactivating");
  if (timer) {
    clearInterval(timer);
    log("Timer cleared");
  }
}

function onActivity() {
  lastActiveTime = Date.now();
}

function enoughTimePassed(time: number): boolean {
  return lastHeartbeat + 120000 < time; // 2 minute heartbeat threshold
}

function isDuplicateHeartbeat(file: string, time: number, selection: vscode.Position): boolean {
  const DUPLICATE_THRESHOLD = 30 * 60000; // 30 minutes
  
  if (dedupe[file] && 
      time - dedupe[file].lastHeartbeatAt < DUPLICATE_THRESHOLD &&
      dedupe[file].selection.isEqual(selection)) {
    return true;
  }
  
  dedupe[file] = {
    selection: selection,
    lastHeartbeatAt: time
  };
  return false;
}
