// Copyright 2026 OpenObserve Inc.

import commonService from "@/services/common";
import { folderKeys } from "@/services/common.querykeys";
import { queryClient } from "@/composables/query/queryClient";

/** Looked up by name, so it is an identifier and never translated. */
export const DETECTIONS_FOLDER_NAME = "Security Detections";

const DEFAULT_FOLDER_ID = "default";

interface RejectedResponse {
  response?: { status?: number; data?: { message?: unknown; error?: unknown } };
}

const isForbidden = (error: unknown) =>
  (error as RejectedResponse | undefined)?.response?.status === 403;

/** The server's reason for refusing a detection save, and whether it was a 403. */
export const detectionSaveFailure = (error: unknown): { reason?: string; forbidden: boolean } => {
  const data = (error as RejectedResponse | undefined)?.response?.data;
  const reason = [data?.message, data?.error].find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  return { reason, forbidden: isForbidden(error) };
};

/** The "Security Detections" alert folder, created when missing; "default" when the user may not create it. */
export async function detectionFolderId(org: string): Promise<string> {
  try {
    const res = await commonService.list_Folders(org, "alerts", { skipAccessToast: true });
    const list: { name?: string; folderId?: string }[] = res.data?.list ?? [];
    const existing = list.find((folder) => folder.name === DETECTIONS_FOLDER_NAME);
    if (existing?.folderId) return String(existing.folderId);
    const created = await commonService.new_Folder(
      org,
      "alerts",
      { name: DETECTIONS_FOLDER_NAME, description: "Detections created from Security" },
      { skipAccessToast: true },
    );
    void queryClient.invalidateQueries({ queryKey: folderKeys.list(org, "alerts") });
    return String(created.data?.folderId ?? DEFAULT_FOLDER_ID);
  } catch (error) {
    // A user who may not create folders still saves, into the folder every org has.
    if (isForbidden(error)) return DEFAULT_FOLDER_ID;
    throw error;
  }
}
