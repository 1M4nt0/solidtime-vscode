type Project = {
  id: string
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

export type { Project }