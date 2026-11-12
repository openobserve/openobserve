// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it } from "vitest";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { raw } from "@/types/i18n";

describe("useConfirmDialog", () => {
  const dialog = useConfirmDialog();

  afterEach(() => dialog.handleCancel());

  it("exposes messageKeypath, messageName and confirmVariant to the provider", () => {
    dialog.confirm({
      title: raw("Delete panel"),
      messageKeypath: "panel.deletePanelMessage",
      messageName: "cpu-high",
      confirmVariant: "destructive",
    });
    expect(dialog.currentDialog.value).toMatchObject({
      open: true,
      messageKeypath: "panel.deletePanelMessage",
      messageName: "cpu-high",
      confirmVariant: "destructive",
    });
    expect(dialog.currentDialog.value?.message).toBeUndefined();
  });

  it("keeps a plain message", () => {
    dialog.confirm({ title: raw("Title"), message: raw("Plain message") });
    expect(dialog.currentDialog.value?.message).toBe("Plain message");
    expect(dialog.currentDialog.value?.messageKeypath).toBeUndefined();
  });

  it("resolves with the user's choice and clears the state", async () => {
    const confirmed = dialog.confirm({ title: raw("T"), message: raw("M") });
    dialog.handleConfirm();
    await expect(confirmed).resolves.toBe(true);
    expect(dialog.currentDialog.value).toBeNull();
    const cancelled = dialog.confirm({ title: raw("T"), message: raw("M") });
    dialog.handleUpdateOpen(false);
    await expect(cancelled).resolves.toBe(false);
  });
});
