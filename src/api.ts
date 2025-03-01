import { log } from "./log";

export interface TimeEntry {
  id: string;
  start: string;
  duration: number;
  project: string;
}

let currentEntryId: string | null = null;

export async function sendUpdate(
  time: number,
  apiKey: string,
  apiUrl: string,
  orgId: string,
  memberId: string,
  startTime: number,
  data: { project_id: string | null }
): Promise<void> {
  log("sending update", { time });
  const formatDate = (date: Date) =>
    date.toISOString().replace(/\.\d{3}Z$/, "Z");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  const millisecondsInDay = time;
  const end = new Date(today.getTime() + millisecondsInDay);

  const formattedData = {
    member_id: memberId,
    start: formatDate(start),
    end: formatDate(end),
    duration: Math.floor(time / 1000),
    billable: false,
    project_id: data.project_id,
    description: "Coding time from VSCode extension",
    tags: [],
  };

  if (!currentEntryId) {
    const endpoint = `${apiUrl}/api/v1/organizations/${orgId}/time-entries`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(formattedData),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
    const responseData = JSON.parse(text);
    currentEntryId = responseData.data.id;
    log("entry created", { id: currentEntryId, totalTime: time });
  } else {
    const endpoint = `${apiUrl}/api/v1/organizations/${orgId}/time-entries/${currentEntryId}`;
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(formattedData),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
    log("entry updated", { id: currentEntryId, totalTime: time });
  }
}

export async function getEntries(
  apiKey: string,
  apiUrl: string,
  orgId: string
): Promise<TimeEntry[]> {
  log("fetching entries");
  const today = new Date().toISOString().split("T")[0];
  const start = today + "T00:00:00Z";
  const end = today + "T23:59:59Z";
  const endpoint = new URL(
    `${apiUrl}/api/v1/organizations/${orgId}/time-entries`
  );
  endpoint.searchParams.set("start", start);
  endpoint.searchParams.set("end", end);
  log("fetching data", { url: endpoint.toString() });
  try {
    const response = await fetch(endpoint.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const entries: TimeEntry[] = data.data.map((entry: any) => ({
      id: entry.id,
      start: entry.start,
      duration: entry.duration * 1000,
      project: entry.project_id || "No project",
    }));
    log("entries fetched", { count: entries.length });
    return entries;
  } catch (error) {
    log("fetch failed", error);
    return [];
  }
}

export async function getMember(
  apiKey: string,
  apiUrl: string,
  orgId: string
): Promise<string> {
  const endpoint = `${apiUrl}/api/v1/organizations/${orgId}/members`;
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();

  const userId = await getUserId(apiKey, apiUrl);
  const member = data.data.find((m: any) => m.user_id === userId);

  if (!member) throw new Error("Member not found");
  return member.id;
}

async function getUserId(apiKey: string, apiUrl: string): Promise<string> {
  const endpoint = `${apiUrl}/api/v1/users/me`;
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return data.data.id;
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
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return data.data.map((membership: any) => ({
    id: membership.organization.id,
    name: membership.organization.name,
  }));
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
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return data.data.map((project: any) => ({
    id: project.id,
    name: project.name,
  }));
}

export async function createProject(
  apiKey: string,
  apiUrl: string,
  orgId: string,
  name: string
): Promise<Project> {
  const endpoint = `${apiUrl}/api/v1/organizations/${orgId}/projects`;
  const userId = await getUserId(apiKey, apiUrl);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      color: "#000000",
      is_billable: true,
      member_ids: [userId],
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return {
    id: data.data.id,
    name: data.data.name,
  };
}
