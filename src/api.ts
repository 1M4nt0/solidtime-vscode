import { log } from "./log";

export interface TimeEntry {
  id: string;
  start: string;
  duration: number;
  project: string;
}

let currentEntryIds: Record<string, string> = {};
let cachedUserId: string | null = null;

async function apiFetch<T>(
  endpoint: string,
  apiKey: string,
  method = "GET",
  body?: any
): Promise<T> {
  const headers: HeadersInit = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };

  if (body && method !== "GET") {
    headers["Content-Type"] = "application/json";
  }

  const options: RequestInit = {
    method,
    headers,
  };

  if (method !== "GET" && body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(endpoint, options);

  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);

  return text ? (JSON.parse(text) as T) : ({} as T);
}

const formatDate = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

export async function sendUpdate(
  time: number,
  apiKey: string,
  apiUrl: string,
  orgId: string,
  memberId: string,
  startTime: number,
  data: { project_id: string | null }
): Promise<void> {
  const projectKey = data.project_id || "no_project";
  log(
    `sending update for ${Math.floor(
      time / 1000
    )}s of time for project ${projectKey}`
  );

  const start = new Date(startTime);
  const durationSeconds = Math.floor(time / 1000);
  const end = new Date(startTime + durationSeconds * 1000);

  const formattedData = {
    member_id: memberId,
    start: formatDate(start),
    end: formatDate(end),
    duration: durationSeconds,
    billable: false,
    project_id: data.project_id,
    description: "Coding time from VSCode extension",
    tags: [],
  };

  try {
    if (!currentEntryIds[projectKey]) {
      const endpoint = `${apiUrl}/api/v1/organizations/${orgId}/time-entries`;
      const response = await apiFetch<{ data: { id: string } }>(
        endpoint,
        apiKey,
        "POST",
        formattedData
      );
      currentEntryIds[projectKey] = response.data.id;
      log(
        `entry created with id ${
          currentEntryIds[projectKey]
        } for project ${projectKey}, total time: ${Math.floor(time / 1000)}s`
      );
    } else {
      const entryId = currentEntryIds[projectKey];
      const endpoint = `${apiUrl}/api/v1/organizations/${orgId}/time-entries/${entryId}`;
      await apiFetch<any>(endpoint, apiKey, "PUT", formattedData);
      log(
        `entry updated with id ${entryId} for project ${projectKey}, total time: ${Math.floor(
          time / 1000
        )}s`
      );
    }
  } catch (error) {
    log(`time entry update failed: ${error}`);
    throw error;
  }
}

export async function getEntries(
  apiKey: string,
  apiUrl: string,
  orgId: string
): Promise<TimeEntry[]> {
  log("fetching time entries");
  const today = new Date().toISOString().split("T")[0];
  const start = today + "T00:00:00Z";
  const end = today + "T23:59:59Z";

  const endpoint = new URL(
    `${apiUrl}/api/v1/organizations/${orgId}/time-entries`
  );
  endpoint.searchParams.set("start", start);
  endpoint.searchParams.set("end", end);

  try {
    const data = await apiFetch<any>(endpoint.toString(), apiKey);

    log(
      `Raw time entries data: ${JSON.stringify(
        data.data.map((e: any) => ({ id: e.id, project_id: e.project_id }))
      )}`
    );

    const entries: TimeEntry[] = data.data.map((entry: any) => {
      const projectId = entry.project_id || "No project";
      return {
        id: entry.id,
        start: entry.start,
        duration: entry.duration * 1000,
        project: projectId,
      };
    });

    entries.forEach((entry) => {
      const projectKey = entry.project || "No project";
      if (!currentEntryIds[projectKey]) {
        currentEntryIds[projectKey] = entry.id;
        log(`Cached entry ID ${entry.id} for project ${projectKey}`);
      }
    });

    log(`entries fetched: ${entries.length} entries found`);
    return entries;
  } catch (error) {
    log(`fetch failed: ${error}`);
    return [];
  }
}

export async function getMember(
  apiKey: string,
  apiUrl: string,
  orgId: string
): Promise<string> {
  try {
    const endpoint = `${apiUrl}/api/v1/organizations/${orgId}/members`;
    const data = await apiFetch<any>(endpoint, apiKey);
    const userId = await getUserId(apiKey, apiUrl);
    const member = data.data.find((m: any) => m.user_id === userId);

    if (!member) throw new Error("Member not found");
    return member.id;
  } catch (error) {
    log(`get member failed: ${error}`);
    throw error;
  }
}

async function getUserId(apiKey: string, apiUrl: string): Promise<string> {
  if (cachedUserId) return cachedUserId;

  const endpoint = `${apiUrl}/api/v1/users/me`;
  try {
    const data = await apiFetch<{ data: { id: string } }>(endpoint, apiKey);
    cachedUserId = data.data.id;
    return data.data.id;
  } catch (error) {
    log(`get user id failed: ${error}`);
    throw error;
  }
}

export interface Organization {
  id: string;
  name: string;
}

export async function getOrganizations(
  apiKey: string,
  apiUrl: string
): Promise<Organization[]> {
  const endpoint = `${apiUrl}/api/v1/users/me/memberships`;
  try {
    const data = await apiFetch<any>(endpoint, apiKey);
    return data.data.map((membership: any) => ({
      id: membership.organization.id,
      name: membership.organization.name,
    }));
  } catch (error) {
    log(`get organizations failed: ${error}`);
    throw error;
  }
}

export interface Project {
  id: string;
  name: string;
}

export async function getProjects(
  apiKey: string,
  apiUrl: string,
  orgId: string
): Promise<Project[]> {
  const endpoint = `${apiUrl}/api/v1/organizations/${orgId}/projects`;
  try {
    const data = await apiFetch<any>(endpoint, apiKey);
    return data.data.map((project: any) => ({
      id: project.id,
      name: project.name,
    }));
  } catch (error) {
    log(`get projects failed: ${error}`);
    throw error;
  }
}

export async function createProject(
  apiKey: string,
  apiUrl: string,
  orgId: string,
  name: string
): Promise<Project> {
  const endpoint = `${apiUrl}/api/v1/organizations/${orgId}/projects`;
  const userId = await getUserId(apiKey, apiUrl);

  try {
    const data = await apiFetch<any>(endpoint, apiKey, "POST", {
      name,
      color: "#000000",
      is_billable: true,
      member_ids: [userId],
    });

    return {
      id: data.data.id,
      name: data.data.name,
    };
  } catch (error) {
    log(`create project failed: ${error}`);
    throw error;
  }
}
