import {API} from '../../../../../services/injection'
import { DateUtils } from '../../../../../functions/time'
import type {APIResponse, FetchAPI} from '../../../../../models/api'
import type {Nullable, TimeEntry} from '../../../../../types'

type RequestUpdateTimeEntryParams = {
  orgId: string
  entryId: string
}

type RequestUpdateTimeEntryBody = {
  member_id?: string
  start?: Date
  end?: Date
  billable?: boolean
  project_id?: Nullable<string>
  description?: Nullable<string>
  tags?: Array<Nullable<string>>
  task_id?: Nullable<string>
}

type UpdateTimeEntryResponse = APIResponse<TimeEntry[]>

const updateTimeEntry: FetchAPI<UpdateTimeEntryResponse, [RequestUpdateTimeEntryParams, RequestUpdateTimeEntryBody]> = (
  params,
  body
) => {
  return API().request<UpdateTimeEntryResponse>(`/organizations/${params.orgId}/time-entries/${params.entryId}`, {
    method: 'PUT',
    body: {
      ...body,
      start: body.start ? DateUtils.format(body.start, DateUtils.UTC_DATE_TIME_FORMAT) : undefined,
      end: body.end ? DateUtils.format(body.end, DateUtils.UTC_DATE_TIME_FORMAT) : undefined,
    },
  })
}

export {updateTimeEntry}
