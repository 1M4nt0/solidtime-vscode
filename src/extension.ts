import * as vscode from 'vscode'
import {getEntries, getMember} from './api'
import {initLoggerInjection, Logger} from './services/injection'
import {registerCommands} from './commands'
import {LocalFileStorageService} from './services/timeTracker'
import {initFetchWrapperInjection, initTimeTrackerServiceInjection, TimeTracker} from './services/injection'

const CONFIGURATION_SLUG = 'solidtime'
const EMPTY_PROJECT_ID = 'no_project'

let startTime: number
let totalTime: number = 0
let currentDay: number = new Date().getDate()

function checkDayTransition() {
  const now = new Date()
  const today = now.getDate()

  if (today !== currentDay) {
    Logger().log(`Day changed from ${currentDay} to ${today}`)
    currentDay = today
    return true
  }
  return false
}

const bootstrap = async () => {
  const config = vscode.workspace.getConfiguration(CONFIGURATION_SLUG, null)
  const apiKey = config.get<string>('apiKey')
  const apiUrl = config.get<string>('apiUrl')
  const orgId = config.get<string>('organizationId')
  const projectMappings = config.get<Record<string, string | null>>('projectMappings', {})

  if (!apiKey || !apiUrl || !orgId) {
    const missingFields = []
    if (!apiKey) missingFields.push('apiKey')
    if (!apiUrl) missingFields.push('apiUrl')
    if (!orgId) missingFields.push('organizationId')
    throw new Error(`Missing required configuration: ${missingFields.join(', ')}`)
  }

  initLoggerInjection()

  initFetchWrapperInjection({
    apiUrl,
    apiKey,
  })

  const memberId = await getMember(orgId)

  initTimeTrackerServiceInjection({
    orgId,
    memberId,
    storage: new LocalFileStorageService(),
    workspace: vscode.workspace.name ?? EMPTY_PROJECT_ID,
  })

  return {
    apiKey,
    apiUrl,
    orgId,
    memberId,
    projectMappings,
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const {apiKey, apiUrl, orgId, memberId, projectMappings} = await bootstrap()

  startTime = Date.now()
  Logger().log('extension activating')
  Logger().log(`session started at ${new Date(startTime).toISOString()}`)

  let activityTimeout: NodeJS.Timeout | null = null
  const debouncedActivity = () => {
    if (activityTimeout) {
      clearTimeout(activityTimeout)
    }
    activityTimeout = setTimeout(() => {
      TimeTracker().onActivity()

      if (checkDayTransition()) {
        refreshEntriesForNewDay()
      }
    }, 1000) as unknown as NodeJS.Timeout
  }

  async function refreshEntriesForNewDay() {
    Logger().log('Day changed - refreshing time entries')
    try {
      const entries = await getEntries(orgId)
      const totalDailyTime = entries.reduce((total, entry) => total + (entry.duration || 0), 0)
      Logger().log(`New day - total time: ${Math.floor(totalDailyTime / 1000)}s across all projects`)
      totalTime = totalDailyTime
    } catch (error) {
      Logger().log(`Day transition refresh failed: ${error}`)
    }
  }

  vscode.workspace.onDidChangeTextDocument(debouncedActivity, null, context.subscriptions)

  vscode.window.onDidChangeTextEditorSelection(debouncedActivity, null, context.subscriptions)

  vscode.window.onDidChangeActiveTextEditor(debouncedActivity, null, context.subscriptions)

  vscode.window.onDidChangeWindowState(
    (state) => {
      if (state.focused) {
        TimeTracker().resume()
        if (checkDayTransition()) {
          refreshEntriesForNewDay()
        }
      } else {
        TimeTracker().pause()
      }
    },
    null,
    context.subscriptions
  )

  try {
    Logger().log("fetching today's entries")
    const entries = await getEntries(orgId)

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    const currentProjectId = workspaceFolder ? projectMappings[workspaceFolder.uri.toString()] : null

    Logger().log(`current project id at startup: ${currentProjectId || 'No project'}`)

    const totalDailyTime = entries.reduce((total, entry) => total + (entry.duration || 0), 0)

    Logger().log(`total daily time: ${Math.floor(totalDailyTime / 1000)}s across all projects`)

    totalTime = totalDailyTime
    Logger().log(`entries loaded: ${Math.floor(totalDailyTime / 1000)}s total from ${entries.length} entries`)
  } catch (error) {
    Logger().log(`entries load failed: ${error}`)
  }

  const dayCheckInterval = setInterval(() => {
    if (checkDayTransition()) {
      refreshEntriesForNewDay()
    }
  }, 60_000)

  context.subscriptions.push({
    dispose: () => {
      clearInterval(dayCheckInterval)
    },
  })

  TimeTracker().start()

  registerCommands(context, TimeTracker(), apiKey, apiUrl, orgId, memberId, totalTime, startTime)

  Logger().log('extension activated')
}

export function deactivate() {
  Logger().log('extension deactivating')
  if (TimeTracker()) {
    TimeTracker().stop()
  }
}
