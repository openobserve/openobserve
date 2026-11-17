// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";
import commonService from "@/services/common";
import { DETECTIONS_FOLDER_NAME, detectionFolderId, detectionSaveFailure } from "./detectionFolder";

vi.mock("@/services/common", () => ({ default: { list_Folders: vi.fn(), new_Folder: vi.fn() } }));

const listFolders = commonService.list_Folders as unknown as ReturnType<typeof vi.fn>;
const newFolder = commonService.new_Folder as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  listFolders.mockReset();
  newFolder.mockReset();
});

describe("detectionFolderId", () => {
  it("reuses the existing Security Detections folder", async () => {
    listFolders.mockResolvedValue({
      data: {
        list: [
          { name: "default", folderId: "default" },
          { name: DETECTIONS_FOLDER_NAME, folderId: "f-sec" },
        ],
      },
    });
    expect(await detectionFolderId("acme")).toBe("f-sec");
    expect(listFolders).toHaveBeenCalledWith("acme", "alerts", { skipAccessToast: true });
    expect(newFolder).not.toHaveBeenCalled();
  });

  it("creates the folder when it is missing", async () => {
    listFolders.mockResolvedValue({ data: { list: [{ name: "default", folderId: "default" }] } });
    newFolder.mockResolvedValue({ data: { folderId: "f-new" } });
    expect(await detectionFolderId("acme")).toBe("f-new");
    expect(newFolder).toHaveBeenCalledWith(
      "acme",
      "alerts",
      expect.objectContaining({ name: "Security Detections" }),
      { skipAccessToast: true },
    );
  });

  it("falls back to the default folder when creating it is forbidden", async () => {
    listFolders.mockResolvedValue({ data: { list: [] } });
    newFolder.mockRejectedValue({ response: { status: 403 } });
    expect(await detectionFolderId("acme")).toBe("default");
  });

  it("rethrows any other failure", async () => {
    listFolders.mockResolvedValue({ data: { list: [] } });
    newFolder.mockRejectedValue({ response: { status: 500 } });
    await expect(detectionFolderId("acme")).rejects.toEqual({ response: { status: 500 } });
  });
});

describe("detectionSaveFailure", () => {
  it("keeps the server's Security permission reason on a 403", () => {
    const error = {
      response: {
        status: 403,
        data: { message: "Security detections need the Security permission" },
      },
    };
    expect(detectionSaveFailure(error)).toEqual({
      reason: "Security detections need the Security permission",
      forbidden: true,
    });
  });

  it("reads an `error` field and flags a bare 403", () => {
    expect(detectionSaveFailure({ response: { status: 400, data: { error: "bad" } } })).toEqual({
      reason: "bad",
      forbidden: false,
    });
    expect(detectionSaveFailure({ response: { status: 403, data: {} } })).toEqual({
      reason: undefined,
      forbidden: true,
    });
  });
});
