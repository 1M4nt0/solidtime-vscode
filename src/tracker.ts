import * as vscode from "vscode";
import { sendUpdate, getEntries } from "./api";
import { formatTimeSpent } from "./time";
import { log } from "./log";

export class TimeTracker {
  private statusBar: vscode.StatusBarItem;
  private timer: NodeJS.Timer | undefined;
  private sessionStartTime: number;
  private startTime: number;
  private totalTime: number = 0;
  private initialTime: number = 0;
  private currentFile: string = "";
  private lastUpdate: number = 0;
  private readonly IDLE_TIMEOUT = 15 * 60 * 1000;
  private readonly UPDATE_INTERVAL = 2 * 60 * 1000;
  private readonly MAX_UPDATE_FREQUENCY = 30 * 1000;
  private isVSCodeFocused: boolean = true;

  constructor(
    private apiKey: string,
    private apiUrl: string,
    private orgId: string,
    private memberId: string,
    sessionStart: number
  ) {
    this.statusBar = vscode.window.createStatusBarItem(
      "solidtime.time",
      vscode.StatusBarAlignment.Left,
      3
    );
    this.statusBar.name = "Solidtime";
    this.statusBar.text = `$(clock) 0 hrs 0 mins`;
    this.statusBar.tooltip =
      "Solidtime: Today's coding time. Click to visit dashboard.";
    this.statusBar.command = "solidtime.dashboard";
    this.statusBar.show();
    this.sessionStartTime = sessionStart;
    this.startTime = Date.now();
    this.lastUpdate = this.startTime;
    log(`status bar initialized, start time: ${new Date(this.startTime).toISOString()}`);
  }

  public setInitialTime(time: number): void {
    this.initialTime = time;
    this.totalTime = time;
    this.statusBar.text = `$(clock) ${formatTimeSpent(this.totalTime)}`;
  }

  public onActivity(): void {
    const currentTime = Date.now();
    if (currentTime - this.lastUpdate >= this.MAX_UPDATE_FREQUENCY) {
      this.sendTimeUpdate();
    }
  }

  public updateFocusState(isFocused: boolean): void {
    const wasFocused = this.isVSCodeFocused;
    this.isVSCodeFocused = isFocused;

    if (isFocused && !wasFocused) {
      this.refreshTimeEntries();
    }

    if (!isFocused && wasFocused) {
      this.sendTimeUpdate();
    }
  }

  public async refreshTimeEntries(): Promise<void> {
    try {
      log("refreshing time entries on focus");
      const entries = await getEntries(this.apiKey, this.apiUrl, this.orgId);
      const totalTime = entries.reduce(
        (total, entry) => total + entry.duration,
        0
      );

      if (totalTime > this.totalTime) {
        this.initialTime = totalTime;
        this.totalTime = totalTime;
        this.startTime = Date.now();
        this.statusBar.text = `$(clock) ${formatTimeSpent(this.totalTime)}`;
        log(`time entries refreshed: ${Math.floor(totalTime / 1000)}s from ${entries.length} entries`);
      }
    } catch (error) {
      log(`refresh time entries failed: ${error}`);
    }
  }

  public startTracking(
    context: vscode.ExtensionContext,
    isFocused: () => boolean,
    getLastCodingActivity: () => number
  ): void {
    let wasIdle = false;
    let idleStartTime = 0;

    this.timer = setInterval(async () => {
      const currentTime = Date.now();
      const timeSinceLastCoding = currentTime - getLastCodingActivity();

      const isIdle = timeSinceLastCoding > this.IDLE_TIMEOUT || !isFocused();

      if (isIdle && !wasIdle) {
        idleStartTime = currentTime;
        log(`user became idle: idle for ${Math.floor(timeSinceLastCoding / 1000)}s, vscode in focus: ${isFocused()}`);

        this.initialTime = this.totalTime;
        await this.sendTimeUpdate();
        this.startTime = currentTime;
        wasIdle = true;
        return;
      } else if (!isIdle && wasIdle) {
        const totalIdleTime = currentTime - idleStartTime;
        log(`user became active after ${Math.floor(totalIdleTime / 1000)}s of idle time`);
        wasIdle = false;

        this.startTime = currentTime;

        this.sendTimeUpdate();
        return;
      }

      if (isIdle) {
        return;
      }

      const timeElapsed = currentTime - this.startTime;
      this.totalTime = this.initialTime + timeElapsed;
      this.statusBar.text = `$(clock) ${formatTimeSpent(this.totalTime)}`;

      const editor = vscode.window.activeTextEditor;
      if (!isIdle && editor) {
        const fileName = editor.document.fileName;
        const shouldUpdate =
          currentTime - this.lastUpdate >= this.UPDATE_INTERVAL ||
          this.currentFile !== fileName;

        if (shouldUpdate) {
          await this.sendTimeUpdate(fileName);
        }
      }
    }, this.MAX_UPDATE_FREQUENCY);

    context.subscriptions.push({
      dispose: () => {
        if (this.timer) {
          clearInterval(this.timer);
          log(`timer cleared, total time: ${Math.floor(this.totalTime / 1000)}s`);
        }
      },
    });
  }

  private async sendTimeUpdate(fileName?: string): Promise<void> {
    try {
      const currentTime = Date.now();
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      const config = vscode.workspace.getConfiguration("solidtime", null);
      const mappings = config.get<Record<string, string | null>>(
        "projectMappings",
        {}
      );
      const projectId = workspaceFolder
        ? mappings[workspaceFolder.uri.toString()]
        : null;

      await sendUpdate(
        this.totalTime,
        this.apiKey,
        this.apiUrl,
        this.orgId,
        this.memberId,
        this.sessionStartTime,
        { project_id: projectId || null }
      );

      if (fileName) {
        this.currentFile = fileName;
      }
      this.lastUpdate = currentTime;

      const timeElapsed = currentTime - this.startTime;
      const timeElapsedSeconds = Math.floor(timeElapsed / 1000);
      const totalTimeSeconds = Math.floor(this.totalTime / 1000);
      log(`time updated: total ${totalTimeSeconds}s, elapsed ${timeElapsedSeconds}s`);
    } catch (error) {
      log(`update failed: ${error}`);
    }
  }

  public async forceUpdate(): Promise<void> {
    await this.sendTimeUpdate();
  }

  public dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      log(`timer cleared, total time: ${Math.floor(this.totalTime / 1000)}s`);
    }
    this.statusBar.dispose();
  }

  public updateCredentials(
    apiKey: string,
    apiUrl: string,
    orgId: string,
    memberId: string
  ): void {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
    this.orgId = orgId;
    this.memberId = memberId;
  }
}
