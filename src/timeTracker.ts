import * as vscode from "vscode";
import { sendUpdate } from "./api";
import { formatTimeSpent, hasTimePassed } from "./time";
import { log } from "./log";

export class TimeTracker {
  private statusBar: vscode.StatusBarItem;
  private timer: NodeJS.Timeout | undefined;
  private sessionStartTime: number;
  private startTime: number;
  private lastActiveTime: number;
  private totalTime: number = 0;
  private initialTime: number = 0;
  private currentFile: string = "";
  private dedupe: { [key: string]: { time: number; file: string } } = {};
  private readonly IDLE_TIMEOUT = 2 * 60 * 1000;
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
    this.lastActiveTime = this.startTime;
    const startTimeSeconds = Math.floor(this.startTime / 1000);
    log("status bar initialized", { startTime: `${startTimeSeconds}s` });
  }

  public setInitialTime(time: number): void {
    this.initialTime = time;
    this.totalTime = time;
    this.statusBar.text = `$(clock) ${formatTimeSpent(this.totalTime)}`;
  }

  public onActivity(): void {
    this.lastActiveTime = Date.now();
  }

  public updateFocusState(isFocused: boolean): void {
    this.isVSCodeFocused = isFocused;
  }

  public startTracking(
    context: vscode.ExtensionContext,
    isFocused: () => boolean,
    getLastCodingActivity: () => number
  ): void {
    let wasIdle = false;
    let idleStartTime = 0;
    let skipNextUpdate = false;

    this.timer = setInterval(async () => {
      const currentTime = Date.now();
      const timeSinceLastCoding = currentTime - getLastCodingActivity();
      const isIdle = timeSinceLastCoding > this.IDLE_TIMEOUT || !isFocused();

      if (isIdle && !wasIdle) {
        idleStartTime = currentTime;
        log("user became idle", {
          idleTime: `${Math.floor(timeSinceLastCoding / 1000)}s`,
          vscodeInFocus: isFocused(),
        });

        this.initialTime = this.totalTime;
        this.startTime = currentTime;
        wasIdle = true;
        return;
      } else if (!isIdle && wasIdle) {
        const totalIdleTime = currentTime - idleStartTime;
        log("user became active", {
          totalIdleTime: `${Math.floor(totalIdleTime / 1000)}s`,
        });
        wasIdle = false;

        this.startTime = currentTime;
        
        skipNextUpdate = true;
        return;
      }

      if (isIdle) {
        return;
      }

      const timeElapsed = currentTime - this.startTime;
      this.totalTime = this.initialTime + timeElapsed;
      this.statusBar.text = `$(clock) ${formatTimeSpent(this.totalTime)}`;

      if (skipNextUpdate) {
        skipNextUpdate = false;
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!isIdle && editor) {
        const fileName = editor.document.fileName;

        const key = `${fileName}`;
        if (
          !this.dedupe[key] ||
          hasTimePassed(this.dedupe[key].time, currentTime) ||
          this.currentFile !== fileName
        ) {
          try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const config = vscode.workspace.getConfiguration("solidtime", null);
            const mappings = config.get<Record<string, string | null>>(
              "projectMappings",
              {}
            );
            const projectId = workspaceFolder
              ? mappings[workspaceFolder.uri.toString()]
              : null;

            const data = {
              project_id: projectId || null,
            };

            await sendUpdate(
              this.totalTime,
              this.apiKey,
              this.apiUrl,
              this.orgId,
              this.memberId,
              this.sessionStartTime,
              data
            );
            this.currentFile = fileName;
            this.dedupe[key] = {
              time: currentTime,
              file: fileName,
            };
            const timeElapsedSeconds = Math.floor(timeElapsed / 1000);
            const totalTimeSeconds = Math.floor(this.totalTime / 1000);
            log("time updated", {
              totalTime: `${totalTimeSeconds}s`,
              elapsed: `${timeElapsedSeconds}s`,
            });
          } catch (error) {
            log("update failed", error);
          }
        }
      }
    }, 30000);

    context.subscriptions.push({
      dispose: () => {
        if (this.timer) {
          clearInterval(this.timer);
          const totalTimeSeconds = Math.floor(this.totalTime / 1000);
          log("timer cleared", { totalTime: `${totalTimeSeconds}s` });
        }
      },
    });
  }

  public dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      const totalTimeSeconds = Math.floor(this.totalTime / 1000);
      log("timer cleared", { totalTime: `${totalTimeSeconds}s` });
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
