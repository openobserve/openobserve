// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import {
  HOUR_US,
  HTTP_ROW_VALUE,
  OPopoverStub,
  httpCredential,
} from "@/test/unit/helpers/workflowHttp";
import type { HttpCredential } from "@/services/workflows";
import WorkflowHttpCredentialsTable from "./WorkflowHttpCredentialsTable.vue";

const t = (k: string, v?: Record<string, unknown>) => i18n.global.t(k, v ?? {});

const mountTable = (props: Record<string, unknown> = {}) =>
  mount(WorkflowHttpCredentialsTable, {
    props: {
      credentials: [httpCredential()] as HttpCredential[],
      mode: "token",
      canEdit: true,
      canReveal: true,
      revoking: null,
      revealed: {},
      revealing: null,
      revealError: {},
      ...props,
    },
    global: { plugins: [i18n, store], stubs: { OPopover: OPopoverStub } },
  });

const byTest = (w: ReturnType<typeof mountTable>, id: string) => w.find(`[data-test="${id}"]`);

describe("WorkflowHttpCredentialsTable", () => {
  it("lists Token, Created, Last used, Status", () => {
    const w = mountTable();
    const text = byTest(w, "workflow-http-credentials").text();
    for (const key of ["colToken", "colCreated", "colLastUsed", "colStatus"]) {
      expect(text).toContain(t(`workflow.http.${key}`));
    }
    expect(text).toContain(t("workflow.http.never"));
    expect(text).toContain(t("workflow.http.active"));
    expect(text).toContain("a@example.com");
  });

  // Measured in the built UI at 1920 px: the xl drawer leaves the table 707 px inside its frame.
  it("fits every column inside the xl panel, so nothing scrolls sideways", () => {
    const w = mountTable();
    const columns = w.findComponent({ name: "OTable" }).props("columns") as {
      size?: number;
      minSize?: number;
      meta?: { flex?: boolean };
    }[];
    const needed = columns.reduce(
      (sum, c) => sum + (c.meta?.flex ? (c.minSize ?? 48) : (c.size ?? 150)),
      0,
    );
    expect(needed).toBeLessThanOrEqual(707);
  });

  it("shows when and by whom in one Created cell, with times as in the mockups", () => {
    const w = mountTable({
      credentials: [httpCredential({ last_used_at: 1_792_575_690_000_000 })],
    });
    const columns = w.findComponent({ name: "OTable" }).props("columns") as { id: string }[];
    expect(columns.map((c) => c.id)).toEqual([
      "value",
      "created_at",
      "last_used_at",
      "state",
      "actions",
    ]);
    const created = byTest(w, "workflow-http-credential-c1-created");
    expect(created.text()).toContain("Oct 21, 09:39");
    expect(created.text()).toContain("a@example.com");
    const text = byTest(w, "workflow-http-credentials").text();
    expect(text).toContain("Oct 21, 09:41");
    expect(text).not.toContain("2026-10-21");
  });

  it("signed mode names the column Secret", () => {
    const w = mountTable({ mode: "signature" });
    expect(byTest(w, "workflow-http-credentials").text()).toContain(t("workflow.http.colSecret"));
  });

  it("tags creators who left", () => {
    const w = mountTable({ credentials: [httpCredential({ creator_in_org: false })] });
    expect(w.text()).toContain(t("workflow.http.creatorGone"));
  });

  it("a row shows its prefix until Show", () => {
    const w = mountTable();
    const cell = byTest(w, "workflow-http-credential-c1-value");
    expect(cell.attributes("data-o2-privacy")).toBe("mask");
    expect(cell.text()).toContain("o2wh_4fK9…oI4k");
    expect(cell.text()).not.toContain(HTTP_ROW_VALUE);
  });

  it("Show swaps in the value with data-o2-privacy=mask and hides it again", async () => {
    const w = mountTable();
    await byTest(w, "workflow-http-credential-c1-show").trigger("click");
    expect(w.emitted("reveal")?.[0]).toEqual(["c1"]);
    await w.setProps({ revealed: { c1: HTTP_ROW_VALUE } });
    const cell = byTest(w, "workflow-http-credential-c1-value");
    expect(cell.attributes("data-o2-privacy")).toBe("mask");
    expect(cell.text()).toContain(HTTP_ROW_VALUE);
    await byTest(w, "workflow-http-credential-c1-show").trigger("click");
    expect(w.emitted("hide")?.[0]).toEqual(["c1"]);
  });

  // A cut value cannot be compared with the caller's copy, so the shown value wraps in full.
  it("a shown value wraps in full instead of cutting with an ellipsis", () => {
    const w = mountTable({ revealed: { c1: HTTP_ROW_VALUE } });
    const cell = byTest(w, "workflow-http-credential-c1-value");
    expect(cell.findComponent({ name: "OTruncatedText" }).exists()).toBe(false);
    const value = cell.find('[data-test="workflow-http-credential-c1-shown"]');
    expect(value.text()).toBe(HTTP_ROW_VALUE);
    expect(value.classes()).toEqual(
      expect.arrayContaining(["break-all", "whitespace-normal", "font-mono"]),
    );
  });

  it("Copy copies the real value without showing it", async () => {
    const w = mountTable();
    await byTest(w, "workflow-http-credential-c1-copy").trigger("click");
    expect(w.emitted("copy")?.[0]).toEqual(["c1"]);
    expect(byTest(w, "workflow-http-credential-c1-value").text()).not.toContain(HTTP_ROW_VALUE);
  });

  it("Show/Copy hidden without permissions.reveal", () => {
    const w = mountTable({ canReveal: false });
    expect(byTest(w, "workflow-http-credential-c1-show").exists()).toBe(false);
    expect(byTest(w, "workflow-http-credential-c1-copy").exists()).toBe(false);
    expect(byTest(w, "workflow-http-credential-reveal-denied").text()).toBe(
      t("workflow.http.revealDenied"),
    );
  });

  // Measured in the built UI: Show 28 + Copy 28 + "Revoke now" 88 + two 4 px gaps + 8 + 12 cell padding.
  it("sizes the actions column for Show, Copy and Revoke now, so the retiring row's Show is not clipped", () => {
    const w = mountTable();
    const columns = w.findComponent({ name: "OTable" }).props("columns") as {
      id: string;
      size?: number;
    }[];
    expect(columns.find((c) => c.id === "actions")?.size).toBeGreaterThanOrEqual(174);
  });

  it("a retiring row reveals until it expires", () => {
    const now = Date.now() * 1000;
    const w = mountTable({
      credentials: [
        httpCredential({ id: "c2" }),
        httpCredential({ id: "c1", state: "retiring", expires_at: now + 24 * HOUR_US }),
        httpCredential({ id: "c3", state: "retiring", expires_at: now - HOUR_US }),
      ],
    });
    expect(byTest(w, "workflow-http-credential-retiring").text()).toContain(
      t("workflow.http.retiring"),
    );
    expect(byTest(w, "workflow-http-credential-c1-show").exists()).toBe(true);
    expect(byTest(w, "workflow-http-credential-c3-show").exists()).toBe(false);
    expect(byTest(w, "workflow-http-credential-c1-revoke").text()).toBe(
      t("workflow.http.revokeNow"),
    );
  });

  it("revoke confirms in a popover", async () => {
    const w = mountTable();
    await byTest(w, "workflow-http-credential-c1-revoke").trigger("click");
    expect(w.emitted("revoke")).toBeUndefined();
    expect(byTest(w, "workflow-http-credential-c1-revoke-popover").text()).toContain(
      t("workflow.http.revokeTitle", { prefix: "o2wh_4fK9…oI4k" }),
    );
    await byTest(w, "workflow-http-credential-c1-revoke-confirm").trigger("click");
    expect(w.emitted("revoke")?.[0]).toEqual(["c1"]);
  });

  it("drops the empty Actions column when the user can neither show nor revoke", () => {
    const ids = (w: ReturnType<typeof mountTable>) =>
      (w.findComponent({ name: "OTable" }).props("columns") as { id: string }[]).map((c) => c.id);
    expect(ids(mountTable({ canEdit: false, canReveal: false }))).not.toContain("actions");
    expect(ids(mountTable({ canEdit: false, canReveal: true }))).toContain("actions");
    expect(ids(mountTable({ canEdit: true, canReveal: false }))).toContain("actions");
  });

  it("revoke is hidden without edit", () => {
    const w = mountTable({ canEdit: false });
    expect(byTest(w, "workflow-http-credential-c1-revoke").exists()).toBe(false);
  });

  it("a failed reveal shows the row error", () => {
    const w = mountTable({ revealError: { c1: "gone" } });
    expect(byTest(w, "workflow-http-credential-c1-reveal-error").text()).toBe(
      t("workflow.http.revealFailed", { reason: "gone" }),
    );
  });
});
