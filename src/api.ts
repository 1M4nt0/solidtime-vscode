import {Logger} from './services/injection'
import type {Project, TimeEntry} from './types'
import {DateUtils} from './functions/time'
import {getProjectKey} from './functions/project'
import {createTimeEntry, type RequestCreateTimeEntryBody} from './api/organizations/[orgId]/time-entries/post.index'
import {updateTimeEntry} from './api/organizations/[orgId]/time-entries/[entryId]'
import {getOrganizationTimeEntries} from './api/organizations/[orgId]/time-entries'
import {getOrganizationMembers} from './api/organizations/[orgId]/members'
import {getCurrentUser} from './api/users/me'
import {getCurrentUserMembership} from './api/users/me/membership'
import {getOrganizationProjects} from './api/organizations/[orgId]/projects'
import {createOrganizationProject} from './api/organizations/[orgId]/projects/post.index'

let cachedUserId: string | null = null
const mapProjectKeyToCurrentTimeEntryId: Record<string, string> = {}

async function sendUpdate(
  time: number,
  orgId: string,
  memberId: string,
  startTime: number,
  data: {project_id: string | null}
): Promise<void> {
  const projectKey = getProjectKey(data.project_id)
  Logger().log(`sending update for ${Math.floor(time / 1000)}s of time for project ${projectKey}`)

  const start = new Date(startTime)
  const durationSeconds = Math.floor(time / 1000)
  const end = new Date(startTime + durationSeconds * 1000)

  const formattedData: RequestCreateTimeEntryBody = {
    member_id: memberId,
    start,
    end,
    billable: false,
    project_id: data.project_id,
    description: 'Coding time from VSCode extension',
    tags: [],
    task_id: null,
  }

  try {
    if (!mapProjectKeyToCurrentTimeEntryId[projectKey]) {
      const response = await createTimeEntry({orgId}, formattedData)
      mapProjectKeyToCurrentTimeEntryId[projectKey] = response.data.id

      Logger().log(
        `entry created with id ${
          mapProjectKeyToCurrentTimeEntryId[projectKey]
        } for project ${projectKey}, total time: ${Math.floor(time / 1000)}s`
      )
    } else {
      const entryId = mapProjectKeyToCurrentTimeEntryId[projectKey]
      await updateTimeEntry({orgId, entryId}, formattedData)
      Logger().log(
        `entry updated with id ${entryId} for project ${projectKey}, total time: ${Math.floor(time / 1000)}s`
      )
    }
  } catch (error) {
    Logger().log(`time entry update failed: ${error}`)
    throw error
  }
}

async function getEntries(orgId: string): Promise<TimeEntry[]> {
  Logger().log('fetching time entries')

  const today = DateUtils.now()
  const startOfToday = DateUtils.startOfDay(today)
  const endOfToday = DateUtils.endOfDay(today)

  try {
    const response = await getOrganizationTimeEntries({orgId, start: startOfToday, end: endOfToday})
    Logger().log(
      `Raw time entries data: ${JSON.stringify(response.data.map((e) => ({id: e.id, project_id: e.project_id})))}`
    )

    response.data.forEach((entry) => {
      const projectKey = entry.project_id || 'No project'
      if (!mapProjectKeyToCurrentTimeEntryId[projectKey]) {
        mapProjectKeyToCurrentTimeEntryId[projectKey] = entry.id
        Logger().log(`Cached entry ID ${entry.id} for project ${projectKey}`)
      }
    })

    Logger().log(`entries fetched: ${response.data.length} entries found`)
    return response.data
  } catch (error) {
    Logger().log(`fetch failed: ${error}`)
    return []
  }
}

async function getMember(orgId: string): Promise<string> {
  try {
    const response = await getOrganizationMembers({orgId})
    const userId = await getUserId()
    const member = response.data.find((m) => m.user_id === userId)

    if (!member) throw new Error('Member not found')
    return member.id
  } catch (error) {
    Logger().log(`get member failed: ${error}`)
    throw error
  }
}

async function getUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId

  try {
    const response = await getCurrentUser()
    cachedUserId = response.data.id
    return response.data.id
  } catch (error) {
    Logger().log(`get user id failed: ${error}`)
    throw error
  }
}

interface Organization {
  id: string
  name: string
}

async function getOrganizations(): Promise<Organization[]> {
  try {
    const response = await getCurrentUserMembership()
    return response.data.map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
    }))
  } catch (error) {
    Logger().log(`get organizations failed: ${error}`)
    throw error
  }
}

async function getProjects(orgId: string): Promise<Project[]> {
  try {
    const response = await getOrganizationProjects({orgId})
    return response.data
  } catch (error) {
    Logger().log(`get projects failed: ${error}`)
    throw error
  }
}

async function createProject(orgId: string, name: string): Promise<Project> {
  const userId = await getUserId()

  try {
    const response = await createOrganizationProject(
      {orgId},
      {
        name,
        color: '#000000',
        is_billable: true,
        member_ids: [userId],
        client_id: null,
      }
    )

    return response.data
  } catch (error) {
    Logger().log(`create project failed: ${error}`)
    throw error
  }
}

export type {Organization, RequestCreateTimeEntryBody}
export {sendUpdate, getEntries, getMember, getOrganizations, getProjects, createProject}
