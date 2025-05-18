import API from '../../..'
import type {APIResponse, FetchAPI} from '../../../../models/api'
import type {Project} from '../../../../types'

type RequestGetOrganizationProjectsParams = {
  orgId: string
}

type GetOrganizationProjectsResponse = APIResponse<Project[]>

const getOrganizationProjects: FetchAPI<GetOrganizationProjectsResponse, [RequestGetOrganizationProjectsParams]> = (params) => {
  return API().request(`/organizations/${params.orgId}/projects`, {
    method: 'GET',
  })
}

export {getOrganizationProjects}
