import {API} from '../../../../services/injection'
import {DateUtils} from '../../../../functions/time'
import type {APIResponse, FetchAPI} from '../../../../models/api'
import type {TimeEntry} from '../../../../types'

type RequestGetOrganizationTimeEntriesParams = {
  orgId: string
  start: Date
  end: Date
}

type GetOrganizationTimeEntriesResponse = APIResponse<TimeEntry[]>

const getOrganizationTimeEntries: FetchAPI<GetOrganizationTimeEntriesResponse, [RequestGetOrganizationTimeEntriesParams]> = (params) => {
  return API().request(`/organizations/${params.orgId}/time-entries`, {
    method: 'GET',
    searchParams: {
      start: DateUtils.format(params.start, DateUtils.UTC_DATE_TIME_FORMAT),
      end: DateUtils.format(params.end, DateUtils.UTC_DATE_TIME_FORMAT),
    },
  })
}

export {getOrganizationTimeEntries}
