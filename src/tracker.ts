import * as vscode from "vscode";
import { sendUpdate, getEntries, getProjects, createProject } from "./api";
import { formatTimeSpent } from "./time";
import { log } from "./log";

export class TimeTracker {
  private statusBar: vscode.StatusBarItem;
  private timer: any;
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
  private lastProjectId: string | null = null;
  private projectSessionTimes: Record<string, number> = {};
  private projectTime: number = 0;

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
    log(
      `status bar initialized, start time: ${new Date(
        this.startTime
      ).toISOString()}`
    );
  }

  private getCurrentProjectId(): string | null {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const config = vscode.workspace.getConfiguration("solidtime", null);
    const mappings = config.get<Record<string, string | null>>(
      "projectMappings",
      {}
    );
    return workspaceFolder ? mappings[workspaceFolder.uri.toString()] : null;
  }

  private getProjectKey(projectId: string | null): string {
    return projectId || "No project";
  }

  private getProjectSessionTime(projectId: string | null): number {
    const key = this.getProjectKey(projectId);
    if (!this.projectSessionTimes[key]) {
      this.projectSessionTimes[key] = Date.now();
      log(
        `New project session started for ${key} at ${new Date(
          this.projectSessionTimes[key]
        ).toISOString()}`
      );
    }
    return this.projectSessionTimes[key];
  }

  public setInitialTime(time: number): void {
    this.totalTime = time;
    this.statusBar.text = `$(clock) ${formatTimeSpent(this.totalTime)}`;
    log(`Initial total time set to ${Math.floor(time / 1000)}s`);
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

      const projectId = this.getCurrentProjectId();
      const projectKey = this.getProjectKey(projectId);

      if (this.lastProjectId !== projectId) {
        log(
          `Project switched from ${this.getProjectKey(
            this.lastProjectId
          )} to ${projectKey}`
        );
        this.startTime = Date.now();
        this.lastProjectId = projectId;
      }

      log(`current project id: ${projectKey}`);

      const projectEntries = entries.filter((entry) => {
        const entryProject = entry.project || "No project";
        const matches = entryProject === projectKey;
        return matches;
      });

      const projectTime = projectEntries.reduce(
        (total, entry) => total + entry.duration,
        0
      );

      const totalTime = entries.reduce(
        (total, entry) => total + entry.duration,
        0
      );

      log(
        `refreshing to ${Math.floor(
          totalTime / 1000
        )}s total, with ${Math.floor(projectTime / 1000)}s from current project`
      );

      this.projectTime = projectTime;
      this.startTime = Date.now();
      this.totalTime = totalTime;
      this.statusBar.text = `$(clock) ${formatTimeSpent(this.totalTime)}`;
      log(
        `time entries refreshed: total ${Math.floor(
          totalTime / 1000
        )}s across all projects, ${Math.floor(
          projectTime / 1000
        )}s for current project`
      );

      this.getProjectSessionTime(projectId);
    } catch (error) {
      log(`refresh time entries failed: ${error}`);
    }
  }

  private async autoSetupProject(): Promise<void> {
    if (!this.apiKey || !this.apiUrl || !this.orgId || !this.memberId) {
      log("Missing credentials, skipping auto project setup");
      return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      log("No workspace folder found, skipping auto project setup");
      return;
    }

    const config = vscode.workspace.getConfiguration("solidtime", null);
    const mappings = config.get<Record<string, string | null>>(
      "projectMappings",
      {}
    );

    if (mappings[workspaceFolder.uri.toString()]) {
      log(
        `Workspace already mapped to project: ${mappings[workspaceFolder.uri.toString()]
        }`
      );
      return;
    }

    try {
      const workspaceName = workspaceFolder.name;
      log(`Attempting to auto-setup project for workspace: ${workspaceName}`);

      const projects = await getProjects(this.apiKey, this.apiUrl, this.orgId);
      const similarProject = projects.find(
        (p) =>
          p.name.toLowerCase() === workspaceName.toLowerCase() ||
          p.name.toLowerCase().includes(workspaceName.toLowerCase()) ||
          workspaceName.toLowerCase().includes(p.name.toLowerCase())
      );

      let projectId: string;

      if (similarProject) {
        projectId = similarProject.id;
        log(`Found similar project: ${similarProject.name} (${projectId})`);
      } else {
        const newProject = await createProject(
          this.apiKey,
          this.apiUrl,
          this.orgId,
          workspaceName
        );
        projectId = newProject.id;
        log(`Created new project: ${newProject.name} (${projectId})`);
      }

      const newMappings = { ...mappings };
      newMappings[workspaceFolder.uri.toString()] = projectId;
      await config.update("projectMappings", newMappings, true);

      log(`Auto-mapped workspace to project ID: ${projectId}`);
    } catch (error) {
      log(`Auto project setup failed: ${error}`);
    }
  }

  public startTracking(
    context: vscode.ExtensionContext,
    isFocused: () => boolean,
    getLastCodingActivity: () => number
  ): void {
    this.autoSetupProject();

    let wasIdle = false;
    let idleStartTime = 0;
    let lastTimerUpdate = Date.now();

    this.timer = setInterval(async () => {
      const currentTime = Date.now();
      const timeSinceLastCoding = currentTime - getLastCodingActivity();
      const timeSinceLastUpdate = currentTime - lastTimerUpdate;

      lastTimerUpdate = currentTime;

      const isIdle = timeSinceLastCoding > this.IDLE_TIMEOUT || !isFocused();

      if (isIdle && !wasIdle) {
        idleStartTime = currentTime;
        log(
          `user became idle: idle for ${Math.floor(
            timeSinceLastCoding / 1000
          )}s, vscode in focus: ${isFocused()}`
        );

        await this.sendTimeUpdate();
        wasIdle = true;
        return;
      } else if (!isIdle && wasIdle) {
        const totalIdleTime = currentTime - idleStartTime;
        log(
          `user became active after ${Math.floor(
            totalIdleTime / 1000
          )}s of idle time`
        );
        wasIdle = false;
        this.startTime = currentTime;
        this.sendTimeUpdate();
        return;
      }

      if (isIdle) {
        return;
      }

      this.totalTime += timeSinceLastUpdate;
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
          this.timer = undefined;
          log(
            `timer cleared, total time: ${Math.floor(this.totalTime / 1000)}s`
          );
        }
      },
    });
  }

  private async sendTimeUpdate(fileName?: string): Promise<void> {
    try {
      const currentTime = Date.now();
      const projectId = this.getCurrentProjectId();
      const projectKey = this.getProjectKey(projectId);

      if (this.lastProjectId !== projectId) {
        this.startTime = Date.now();
        if (this.lastProjectId !== null) {
          log(
            `Project changed from ${this.getProjectKey(
              this.lastProjectId
            )} to ${projectKey}`
          );
        }
        this.lastProjectId = projectId;
        await this.refreshTimeEntries();
        return;
      }

      log(`sending update for project: ${projectKey}`);

      const projectSessionTime = this.getProjectSessionTime(projectId);

      const timeElapsed = currentTime - this.startTime;
      const projectTotalTime = this.projectTime + timeElapsed;

      await sendUpdate(
        projectTotalTime,
        this.apiKey,
        this.apiUrl,
        this.orgId,
        this.memberId,
        projectSessionTime,
        { project_id: projectId || null }
      );

      if (fileName) {
        this.currentFile = fileName;
      }
      this.lastUpdate = currentTime;

      const timeElapsedSeconds = Math.floor(timeElapsed / 1000);
      const projectTotalSeconds = Math.floor(projectTotalTime / 1000);
      const totalSeconds = Math.floor(this.totalTime / 1000);
      log(
        `time updated: total (all projects) ${totalSeconds}s, current project ${projectTotalSeconds}s, elapsed ${timeElapsedSeconds}s for project ${projectKey}`
      );
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
      this.timer = undefined;
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
