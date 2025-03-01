import * as vscode from "vscode";
import {
  getEntries,
  getMember,
  getOrganizations,
  getProjects,
  createProject,
  sendUpdate,
} from "./api";
import { log, outputChannel } from "./log";
import { TimeTracker } from "./tracker";

interface QuickPickItem extends vscode.QuickPickItem {
  label: string;
  description?: string;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  timeTracker: TimeTracker,
  apiKey: string,
  apiUrl: string,
  orgId: string,
  memberId: string,
  totalTime: number,
  startTime: number
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("solidtime.setApiKey", async () => {
      const config = vscode.workspace.getConfiguration("solidtime", null);
      const key = await vscode.window.showInputBox({
        prompt: "Enter your Solidtime API key",
        value: apiKey,
      });
      if (key) {
        apiKey = key;
        await config.update("apiKey", apiKey, true);
        vscode.window.showInformationMessage("API key updated");
        log("api key updated");
        timeTracker.updateCredentials(apiKey, apiUrl, orgId, memberId);
      }
    }),

    vscode.commands.registerCommand("solidtime.setApiUrl", async () => {
      const config = vscode.workspace.getConfiguration("solidtime", null);
      const url = await vscode.window.showInputBox({
        prompt: "Enter your Solidtime instance API URL",
        value: apiUrl,
      });
      if (url) {
        apiUrl = url.replace(/\/api\/v1/g, "").replace(/\/+$/, "");
        await config.update("apiUrl", apiUrl, true);
        vscode.window.showInformationMessage("API URL updated");
        log("api url updated", { apiUrl });
        timeTracker.updateCredentials(apiKey, apiUrl, orgId, memberId);
      }
    }),

    vscode.commands.registerCommand("solidtime.setOrganizationId", async () => {
      const config = vscode.workspace.getConfiguration("solidtime", null);

      try {
        const orgs = await getOrganizations(apiKey, apiUrl);
        const items = orgs.map((org) => ({
          label: org.name,
          description: org.id,
        }));

        const quickPick = vscode.window.createQuickPick<QuickPickItem>();
        quickPick.items = items;
        quickPick.placeholder = "Select organization or enter ID";
        quickPick.matchOnDescription = true;

        if (orgId) {
          const currentItem = items.find((item) => item.description === orgId);
          if (currentItem) {
            quickPick.activeItems = [currentItem];
          }
        }

        quickPick.onDidChangeValue((value) => {
          if (
            value.match(
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            )
          ) {
            quickPick.items = [
              { label: "Manual Entry", description: value },
              ...items,
            ];
          } else {
            quickPick.items = items;
          }
        });

        const selected = await new Promise<QuickPickItem | undefined>(
          (resolve) => {
            quickPick.onDidAccept(() => {
              const selection = quickPick.selectedItems[0];
              resolve(selection);
              quickPick.hide();
            });
            quickPick.onDidHide(() => resolve(undefined));
            quickPick.show();
          }
        );

        if (selected) {
          orgId = selected.description!;
          await config.update("organizationId", orgId, true);
          timeTracker.updateCredentials(apiKey, apiUrl, orgId, memberId);
        }
      } catch (error) {
        vscode.window.showErrorMessage("Failed to fetch organizations");
        log("get organizations failed", error);
      }
    }),

    vscode.commands.registerCommand("solidtime.refreshMemberId", async () => {
      try {
        memberId = await getMember(apiKey, apiUrl, orgId);
        timeTracker.updateCredentials(apiKey, apiUrl, orgId, memberId);
      } catch (error) {
        log("member refresh failed", error);
      }
    }),

    vscode.commands.registerCommand("solidtime.forceTimeUpdate", async () => {
      try {
        await sendUpdate(
          totalTime,
          apiKey,
          apiUrl,
          orgId,
          memberId,
          startTime,
          { project_id: null }
        );
        vscode.window.showInformationMessage("Time update sent");
      } catch (error) {
        vscode.window.showErrorMessage("Time update failed");
        log("force update failed", error);
      }
    }),

    vscode.commands.registerCommand("solidtime.setProject", async () => {
      const config = vscode.workspace.getConfiguration("solidtime");
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        log("No workspace folder found");
        vscode.window.showErrorMessage(
          "Please open a workspace folder to set a project"
        );
        return;
      }

      try {
        const projects = await getProjects(apiKey, apiUrl, orgId);
        const createNewOption: QuickPickItem = {
          label: "$(plus) Create New Project",
          description: "",
        };

        const mappings = config.get<Record<string, string>>(
          "projectMappings",
          {}
        );
        const currentProjectId = mappings[workspaceFolder.uri.toString()];

        const baseItems = [
          createNewOption,
          ...projects.map((p) => ({
            label: p.name,
            description: p.id,
          })),
        ];

        const quickPick = vscode.window.createQuickPick<QuickPickItem>();
        quickPick.items = baseItems;
        quickPick.placeholder = "Select project, create new, or enter ID";
        quickPick.matchOnDescription = true;

        if (currentProjectId) {
          const currentItem = baseItems.find(
            (item) => item.description === currentProjectId
          );
          if (currentItem) {
            quickPick.activeItems = [currentItem];
          }
        }

        quickPick.onDidChangeValue((value) => {
          if (
            value.match(
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            )
          ) {
            quickPick.items = [
              { label: "Manual Entry", description: value },
              ...baseItems,
            ];
          } else if (
            value &&
            !projects.some((p) =>
              p.name.toLowerCase().includes(value.toLowerCase())
            )
          ) {
            quickPick.items = [
              {
                label: `$(plus) Create "${value}"`,
                description: "new-project",
              },
              ...baseItems,
            ];
          } else {
            quickPick.items = baseItems;
          }
        });

        const selected = await new Promise<QuickPickItem | undefined>(
          (resolve) => {
            quickPick.onDidAccept(() => {
              const selection = quickPick.selectedItems[0];
              resolve(selection);
              quickPick.hide();
            });
            quickPick.onDidHide(() => resolve(undefined));
            quickPick.show();
          }
        );

        if (!selected) return;

        let projectId;
        if (
          selected === createNewOption ||
          selected.description === "new-project"
        ) {
          const name =
            selected.description === "new-project"
              ? quickPick.value
              : await vscode.window.showInputBox({
                placeHolder: "Enter project name",
                value: workspaceFolder.name,
              });
          if (!name) return;
          const newProject = await createProject(apiKey, apiUrl, orgId, name);
          projectId = newProject.id;
        } else {
          projectId = selected.description!;
        }

        mappings[workspaceFolder.uri.toString()] = projectId;
        await config.update("projectMappings", mappings, true);
      } catch (error) {
        vscode.window.showErrorMessage("Failed to set project");
        log("project set failed", error);
      }
    }),

    vscode.commands.registerCommand("solidtime.dashboard", () => {
      const dashboardUrl = `${apiUrl}/dashboard`;
      vscode.env.openExternal(vscode.Uri.parse(dashboardUrl));
    }),

    vscode.commands.registerCommand("solidtime.showOutput", () => {
      outputChannel.show();
    })
  );
}
