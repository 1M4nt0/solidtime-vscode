type ProjectId = string

type Project = {
  id: ProjectId
  name: string
  color: string
  client_id: string | null
  is_archived: boolean
  billable_rate: number | null
  is_billable: boolean
  estimated_time: number | null
  spent_time: number
  is_public: boolean
}

type TimeEntry = {
  id: string
  start: string
  end: string | null
  duration: number | null
  description: string | null
  task_id: string | null
  project_id: string | null
  organization_id: string
  user_id: string
  tags: string[]
  billable: boolean
}

export type { Project, ProjectId, TimeEntry }
