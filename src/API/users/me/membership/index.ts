import API from "../../.."
import type { FetchAPI } from "../../../../models/api"
import type { APIResponse } from "../../../../models/api"
import type { Membership } from "../../../../types"


type GetCurrentUserMembershipResponse = APIResponse<Membership[]>

const getCurrentUserMembership: FetchAPI<GetCurrentUserMembershipResponse> = () => {
  return API().request(`/users/me/memberships`, {
    method: 'GET',
  })
}

export {getCurrentUserMembership}
