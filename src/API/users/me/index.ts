import API from "../../"
import type { FetchAPI, APIResponse } from "../../../models/api"
import type { User } from "../../../types"

type GetCurrentUserResponse = APIResponse<User>

const getCurrentUser: FetchAPI<GetCurrentUserResponse> = () => {
  return API().request(`/users/me`, {
    method: 'GET',
  })
}

export {getCurrentUser}
