import {log} from './log'
import type {Project, TimeEntry} from './types'
import {DateUtils} from './functions/time'
import {getProjectKey} from './functions/project'
import FetchWrapper from './services/fetch'

let cachedUserId: string | null = null
const mapProjectKeyToCurrentTimeEntryId: Record<string, string> = {}
type ApiResponse<T> = {
  data: T
}

const API = () => FetchWrapper.getInstance()

export async function sendUpdate(
  time: number,
  orgId: string,
  memberId: string,
  startTime: number,
  data: {project_id: string | null}
): Promise<void> {
  const projectKey = getProjectKey(data.project_id)
  log(`sending update for ${Math.floor(time / 1000)}s of time for project ${projectKey}`)

  const start = new Date(startTime)
  const durationSeconds = Math.floor(time / 1000)
  const end = new Date(startTime + durationSeconds * 1000)

  const formattedData = {
    member_id: memberId,
    start: DateUtils.format(start, DateUtils.UTC_DATE_TIME_FORMAT),
    end: DateUtils.format(end, DateUtils.UTC_DATE_TIME_FORMAT),
    duration: durationSeconds,
    billable: false,
    project_id: data.project_id,
    description: 'Coding time from VSCode extension',
    tags: [],
  }

  try {
    if (!mapProjectKeyToCurrentTimeEntryId[projectKey]) {
      const response = await API().request<ApiResponse<{id: string}>>(
        `/api/v1/organizations/${orgId}/time-entries`,
        {
          method: 'POST',
          body: formattedData,
        }
      )
      mapProjectKeyToCurrentTimeEntryId[projectKey] = response.data.id
      log(
        `entry created with id ${
          mapProjectKeyToCurrentTimeEntryId[projectKey]
        } for project ${projectKey}, total time: ${Math.floor(time / 1000)}s`
      )
    } else {
      const entryId = mapProjectKeyToCurrentTimeEntryId[projectKey]
      await API().request<ApiResponse<any>>(
        `/api/v1/organizations/${orgId}/time-entries/${entryId}`,
        {
          method: 'PUT',
          body: formattedData,
        }
      )
      log(`entry updated with id ${entryId} for project ${projectKey}, total time: ${Math.floor(time / 1000)}s`)
    }
  } catch (error) {
    log(`time entry update failed: ${error}`)
    throw error
  }
}

export async function getEntries(orgId: string): Promise<TimeEntry[]> {
  log('fetching time entries')

  const today = DateUtils.now()
  const startOfToday = DateUtils.startOfDay(today)
  const endOfToday = DateUtils.endOfDay(today)

  try {
    const response = await API().request<ApiResponse<TimeEntry[]>>(
      `/api/v1/organizations/${orgId}/time-entries`,
      {
        method: 'GET',
        searchParams: {
          start: DateUtils.format(startOfToday, DateUtils.UTC_DATE_TIME_FORMAT),
          end: DateUtils.format(endOfToday, DateUtils.UTC_DATE_TIME_FORMAT),
        },
      }
    )

    log(
      `Raw time entries data: ${JSON.stringify(response.data.map((e: any) => ({id: e.id, project_id: e.project_id})))}`
    )

    response.data.forEach((entry) => {
      const projectKey = entry.project_id || 'No project'
      if (!mapProjectKeyToCurrentTimeEntryId[projectKey]) {
        mapProjectKeyToCurrentTimeEntryId[projectKey] = entry.id
        log(`Cached entry ID ${entry.id} for project ${projectKey}`)
      }
    })

    log(`entries fetched: ${response.data.length} entries found`)
    return response.data
  } catch (error) {
    log(`fetch failed: ${error}`)
    return []
  }
}

export async function getMember(orgId: string): Promise<string> {
  try {
    const response = await API().request<ApiResponse<any>>(
      `/api/v1/organizations/${orgId}/members`,
      {
        method: 'GET',
      }
    )
    const userId = await getUserId()
    const member = response.data.find((m: any) => m.user_id === userId)

    if (!member) throw new Error('Member not found')
    return member.id
  } catch (error) {
    log(`get member failed: ${error}`)
    throw error
  }
}

async function getUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId

  try {
    const response = await API().request<ApiResponse<{id: string}>>(`/api/v1/users/me`, {
      method: 'GET',
    })
    cachedUserId = response.data.id
    return response.data.id
  } catch (error) {
    log(`get user id failed: ${error}`)
    throw error
  }
}

export interface Organization {
  id: string
  name: string
}

export async function getOrganizations(): Promise<Organization[]> {
  try {
    const response = await API().request<ApiResponse<any>>(`/api/v1/users/me/memberships`, {
      method: 'GET',
    })
    return response.data.map((membership: any) => ({
      id: membership.organization.id,
      name: membership.organization.name,
    }))
  } catch (error) {
    log(`get organizations failed: ${error}`)
    throw error
  }
}

export async function getProjects(orgId: string): Promise<Project[]> {
  try {
    const response = await API().request<ApiResponse<Project[]>>(
      `/api/v1/organizations/${orgId}/projects`,
      {
        method: 'GET',
      }
    )
    return response.data
  } catch (error) {
    log(`get projects failed: ${error}`)
    throw error
  }
}

export async function createProject(orgId: string, name: string): Promise<Project> {
  const userId = await getUserId()

  try {
    const response = await API().request<ApiResponse<Project>>(
      `/api/v1/organizations/${orgId}/projects`,
      {
        method: 'POST',
        body: {
          name,
          color: '#000000',
          is_billable: true,
          member_ids: [userId],
        client_id: null,
      },
    })

    return response.data
  } catch (error) {
    log(`create project failed: ${error}`)
    throw error
  }
}
