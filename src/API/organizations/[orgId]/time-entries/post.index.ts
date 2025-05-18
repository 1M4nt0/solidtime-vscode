import API from '../../..'
import type {APIResponse, FetchAPI} from '../../../../models/api'
import type { Nullable, TimeEntry } from '../../../../types'

type RequestCreateTimeEntryBody = {
  member_id: string
  start: string
  end?: string
  billable: boolean
  project_id?: Nullable<string>
  description?: Nullable<string>
  tags?: Array<Nullable<string>>
  task_id?: Nullable<string>
}

type RequestCreateTimeEntryParams = {
  orgId: string
}

type CreateTimeEntryResponse = APIResponse<TimeEntry>

const createTimeEntry: FetchAPI<CreateTimeEntryResponse, [RequestCreateTimeEntryParams, RequestCreateTimeEntryBody]> = (
  params,
  body
) => {
  return API().request(`/organizations/${params.orgId}/time-entries`, {
    method: 'POST',
    body,
  })
}

export {createTimeEntry}
export type {RequestCreateTimeEntryBody}
