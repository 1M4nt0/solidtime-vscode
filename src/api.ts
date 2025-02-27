import * as vscode from "vscode";
import { log } from "./log";

export interface TimeEntry {
  id: string;
  start: string;
  duration: number;
  project: string;
}

export async function sendUpdate(
  time: number,
  apiKey: string,
  apiUrl: string,
  orgId: string,
  memberId: string,
  startTime: number
): Promise<void> {
  log("sending update", { time });
  const formatDate = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");
  const endpoint = `${apiUrl}/api/v1/organizations/${orgId}/time-entries`;
  const start = new Date(startTime);
  const end = new Date(startTime + time);
  const data = {
    member_id: memberId,
    start: formatDate(start),
    end: formatDate(end),
    billable: false,
    project_id: vscode.workspace.name || null,
    description: "Coding time from VSCode extension",
    tags: []
  };
  log("request", { endpoint, data });
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });
    const text = await response.text();
    log("response", { status: response.status, body: text });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
    log("entry created");
  } catch (error) {
    log("request failed", error);
    throw error;
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
  const endpoint = new URL(`${apiUrl}/api/v1/organizations/${orgId}/time-entries`);
  endpoint.searchParams.set("start", start);
  endpoint.searchParams.set("end", end);
  log("fetching data", { url: endpoint.toString() });
  try {
    const response = await fetch(endpoint.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const entries: TimeEntry[] = data.data.map((entry: any) => ({
      id: entry.id,
      start: entry.start,
      duration: entry.duration * 1000,
      project: entry.project_id || "No project"
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
  apiUrl: string
): Promise<string> {
  const endpoint = `${apiUrl}/api/v1/users/me`;
  log("fetching member", { url: endpoint, hasKey: !!apiKey });
  try {
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json"
      }
    });
    const text = await response.text();
    log("member response", { status: response.status, body: text.substring(0, 500) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
    const data = JSON.parse(text);
    const memberId = data.data.id;
    log("member fetched", { memberId });
    return memberId;
  } catch (error) {
    log("member fetch failed", {
      message: error instanceof Error ? error.message : "Unknown error",
      endpoint,
      hasKey: !!apiKey
    });
    throw error;
  }
}

export interface Organization {
  id: string;
  name: string;
}

export async function getOrganizations(apiKey: string, apiUrl: string): Promise<Organization[]> {
  const endpoint = `${apiUrl}/api/v1/users/me/memberships`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return data.data.map((membership: any) => ({
    id: membership.organization.id,
    name: membership.organization.name,
  }));
} 