import { ref } from "vue";

export type AiDashboardEventType =
  | "dashboard_created"
  | "dashboard_updated"
  | "dashboard_deleted"
  | "panel_added"
  | "panel_updated"
  | "panel_deleted";

export interface AiDashboardEvent {
  type: AiDashboardEventType;
  dashboardId?: string;
  folderId?: string;
}

type AiDashboardEventHandler = (event: AiDashboardEvent) => void;

const listeners = ref<Set<AiDashboardEventHandler>>(new Set());

/**
 * Maps SRE agent tool names to dashboard event types.
 * Returns null if the tool is not a dashboard-mutating tool.
 */
export const getDashboardEventType = (
  toolName: string
): AiDashboardEventType | null => {
  const normalized = toolName.toLowerCase();

  if (normalized.includes("createdashboard")) return "dashboard_created";
  if (normalized.includes("updatedashboard")) return "dashboard_updated";
  if (normalized.includes("deletedashboard")) return "dashboard_deleted";
  if (normalized.includes("addpanel")) return "panel_added";
  if (normalized.includes("updatepanel")) return "panel_updated";
  if (normalized.includes("deletepanel")) return "panel_deleted";

  return null;
};

export const useAiDashboardEvents = () => {
  const emit = (event: AiDashboardEvent) => {
    listeners.value.forEach((handler) => {
      try {
        handler(event);
      } catch (e) {
        console.error("[AiDashboardEvents] Handler error:", e);
      }
    });
  };

  const on = (handler: AiDashboardEventHandler) => {
    listeners.value.add(handler);
  };

  const off = (handler: AiDashboardEventHandler) => {
    listeners.value.delete(handler);
  };

  return { emit, on, off };
};
