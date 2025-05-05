import * as vscode from 'vscode'
import {sendUpdate, getEntries, getProjects, createProject} from './api'
import {log} from './log'

export class TimeTracker {
  private statusBar: vscode.StatusBarItem
  private timer: any
  private startTime: number
  private totalTime: number = 0
  private lastHeartbeat: number = 0
  private readonly IDLE_TIMEOUT = 15 * 60 * 1000
  private readonly HEARTBEAT_INTERVAL = 2 * 60 * 1000
  private readonly FILE_CHANGE_THRESHOLD = 30 * 1000
  private isVSCodeFocused: boolean = true
  private lastProjectId: string | null = null
  private projectSessionTimes: Record<string, number> = {}
  private projectTime: number = 0
  private pendingDuration: number = 0
  private processedEntryIds: Set<string> = new Set()

  constructor(private orgId: string, private memberId: string) {
    this.statusBar = vscode.window.createStatusBarItem('solidtime.time', vscode.StatusBarAlignment.Left, 3)
    this.statusBar.name = 'Solidtime'
    this.statusBar.text = `$(clock) 0 hrs 0 mins`
    this.statusBar.tooltip = "Solidtime: Today's coding time. Click to visit dashboard."
    this.statusBar.command = 'solidtime.dashboard'
    this.statusBar.show()
    this.startTime = Date.now()
    this.lastHeartbeat = this.startTime
    log(`status bar initialized, start time: ${new Date(this.startTime).toISOString()}`)
  }

  private getCurrentProjectId(): string | null {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    const config = vscode.workspace.getConfiguration('solidtime', null)
    const mappings = config.get<Record<string, string | null>>('projectMappings', {})
    return workspaceFolder ? mappings[workspaceFolder.uri.toString()] : null
  }

  private getProjectKey(projectId: string | null): string {
    return projectId || 'No project'
  }

  private getProjectSessionTime(projectId: string | null): number {
    const key = this.getProjectKey(projectId)
    if (!this.projectSessionTimes[key]) {
      this.projectSessionTimes[key] = Date.now()
      log(`New project session started for ${key} at ${new Date(this.projectSessionTimes[key]).toISOString()}`)
    }
    return this.projectSessionTimes[key]
  }

  public setInitialTime(time: number): void {
    this.totalTime = time
    this.statusBar.text = `$(clock) ${this.formatTimeSpent(this.totalTime)}`
    log(`Initial total time set to ${Math.floor(time / 1000)}s`)
  }

  public onActivity(): void {
    const currentTime = Date.now()
    const timeSinceLastHeartbeat = currentTime - this.lastHeartbeat

    if (timeSinceLastHeartbeat >= this.FILE_CHANGE_THRESHOLD) {
      this.sendHeartbeat()
    }
  }

  private async sendHeartbeat(): Promise<void> {
    const currentTime = Date.now()
    const timeSinceLastHeartbeat = currentTime - this.lastHeartbeat

    if (timeSinceLastHeartbeat < this.FILE_CHANGE_THRESHOLD) {
      return
    }

    const editor = vscode.window.activeTextEditor
    if (!editor) {
      return
    }

    if (timeSinceLastHeartbeat <= this.IDLE_TIMEOUT) {
      this.pendingDuration += timeSinceLastHeartbeat
    }

    this.lastHeartbeat = currentTime
    await this.sendTimeUpdate()
  }

  public updateFocusState(isFocused: boolean): void {
    const wasFocused = this.isVSCodeFocused
    this.isVSCodeFocused = isFocused

    if (isFocused && !wasFocused) {
      this.refreshTimeEntries()
    }

    if (!isFocused && wasFocused) {
      this.sendHeartbeat()
    }
  }

  public async refreshTimeEntries(): Promise<void> {
    try {
      log('refreshing time entries on focus')
      const entries = await getEntries(this.orgId)

      const projectId = this.getCurrentProjectId()
      const projectKey = this.getProjectKey(projectId)

      if (this.lastProjectId !== projectId) {
        log(`Project switched from ${this.getProjectKey(this.lastProjectId)} to ${projectKey}`)
        this.startTime = Date.now()
        this.lastProjectId = projectId
      }

      log(`current project id: ${projectKey}`)

      const uniqueEntries = entries.filter((entry) => !this.processedEntryIds.has(entry.id))
      uniqueEntries.forEach((entry) => this.processedEntryIds.add(entry.id))

      const projectEntries = uniqueEntries.filter((entry) => {
        const entryProject = entry.project_id || 'No project'
        const matches = entryProject === projectKey
        return matches
      })

      const projectTime = projectEntries.reduce((total, entry) => total + (entry.duration || 0), 0)

      const totalTime = uniqueEntries.reduce((total, entry) => total + (entry.duration || 0), 0)

      log(
        `refreshing to ${Math.floor(totalTime / 1000)}s total, with ${Math.floor(
          projectTime / 1000
        )}s from current project`
      )

      this.projectTime = projectTime
      this.startTime = Date.now()
      this.totalTime = totalTime
      this.statusBar.text = `$(clock) ${this.formatTimeSpent(this.totalTime)}`
      log(
        `time entries refreshed: total ${Math.floor(totalTime / 1000)}s across all projects, ${Math.floor(
          projectTime / 1000
        )}s for current project`
      )

      this.getProjectSessionTime(projectId)
    } catch (error) {
      log(`refresh time entries failed: ${error}`)
    }
  }

  private async autoSetupProject(): Promise<void> {
    if (!this.orgId || !this.memberId) {
      log('Missing credentials, skipping auto project setup')
      return
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      log('No workspace folder found, skipping auto project setup')
      return
    }

    const config = vscode.workspace.getConfiguration('solidtime', null)
    const projectMappings = config.get<Record<string, string | null>>('projectMappings', {})

    if (projectMappings[workspaceFolder.uri.toString()]) {
      log(`Workspace already mapped to project: ${projectMappings[workspaceFolder.uri.toString()]}`)
      return
    }

    try {
      const workspaceName = workspaceFolder.name
      log(`Attempting to auto-setup project for workspace: ${workspaceName}`)

      const projects = await getProjects(this.orgId)
      const workspaceProject = projects.find((p) => p.name.toLowerCase() === workspaceName.toLowerCase())

      let projectId: string

      if (workspaceProject) {
        projectId = workspaceProject.id
        log(`Found workspace project: ${workspaceProject.name} (${projectId})`)
      } else {
        const newProject = await createProject(this.orgId, workspaceName)
        projectId = newProject.id
        log(`Created new project: ${newProject.name} (${projectId})`)
      }

      const newMappings = {...projectMappings}
      newMappings[workspaceFolder.uri.toString()] = projectId
      await config.update('projectMappings', newMappings, true)

      log(`Auto-mapped workspace to project ID: ${projectId}`)
    } catch (error) {
      log(`Auto project setup failed: ${error}`)
    }
  }

  public startTracking(
    context: vscode.ExtensionContext,
    isFocused: () => boolean,
    getLastCodingActivity: () => number
  ): void {
    this.autoSetupProject()

    this.timer = setInterval(async () => {
      const currentTime = Date.now()
      const timeSinceLastActivity = currentTime - getLastCodingActivity()

      if (timeSinceLastActivity <= this.IDLE_TIMEOUT && isFocused()) {
        const timeSinceLastHeartbeat = currentTime - this.lastHeartbeat
        if (timeSinceLastHeartbeat >= this.HEARTBEAT_INTERVAL) {
          await this.sendHeartbeat()
        }
      }
    }, this.HEARTBEAT_INTERVAL)

    context.subscriptions.push({
      dispose: () => {
        if (this.timer) {
          clearInterval(this.timer)
          this.timer = undefined
          log(`timer cleared, total time: ${Math.floor(this.totalTime / 1000)}s`)
        }
      },
    })
  }

  private async sendTimeUpdate(): Promise<void> {
    try {
      const projectId = this.getCurrentProjectId()
      const projectKey = this.getProjectKey(projectId)

      if (this.lastProjectId !== projectId) {
        if (this.lastProjectId !== null) {
          log(`Project changed from ${this.getProjectKey(this.lastProjectId)} to ${projectKey}`)
        }
        this.lastProjectId = projectId
        await this.refreshTimeEntries()
        return
      }

      log(`sending update for project: ${projectKey}`)

      const projectSessionTime = this.getProjectSessionTime(projectId)
      const projectTotalTime = this.projectTime + this.pendingDuration

      await sendUpdate(projectTotalTime, this.orgId, this.memberId, projectSessionTime, {project_id: projectId || null})

      this.totalTime += this.pendingDuration
      this.pendingDuration = 0
      this.statusBar.text = `$(clock) ${this.formatTimeSpent(this.totalTime)}`

      log(`time updated: total ${Math.floor(this.totalTime / 1000)}s for project ${projectKey}`)
    } catch (error) {
      log(`update failed: ${error}`)
    }
  }

  public async forceUpdate(): Promise<void> {
    await this.sendTimeUpdate()
  }

  public dispose(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
      log(`timer cleared, total time: ${Math.floor(this.totalTime / 1000)}s`)
    }
    this.statusBar.dispose()
  }

  public updateCredentials(orgId: string, memberId: string): void {
    this.orgId = orgId
    this.memberId = memberId
  }

  private formatTimeSpent(totalTime: number): string {
    const hours = Math.floor(totalTime / (1000 * 60 * 60))
    const minutes = Math.floor((totalTime % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours} hrs ${minutes} mins`
  }
}
