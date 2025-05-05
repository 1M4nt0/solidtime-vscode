import { EMPTY_PROJECT_ID } from "../constants/project"

const getProjectKey = (projectId: string | null): string => {
  if (projectId) {
    return projectId
  }
  return EMPTY_PROJECT_ID
}

export { getProjectKey }
