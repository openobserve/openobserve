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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import OnCallPolicyEditor from "@/components/oncall/OnCallPolicyEditor.vue";
import { resetOnCallPermissions } from "@/composables/useOnCallPermissions";
import { __resetOnCallRoutingConfig } from "@/composables/useOnCallRoutingConfig";
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import { toast } from "@/lib/feedback/Toast/useToast";
import store from "@/test/unit/helpers/store";
import type { L0Policy, OnCallPolicy } from "@/ts/interfaces/oncall";
import {
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";

vi.mock("@/services/oncall", () => ({
  default: {
    setPolicy: vi.fn(),
    listMembers: vi.fn(),
    whoIsOnCall: vi.fn(),
    getRoutingConfig: vi.fn(),
    getTeamChannel: vi.fn(),
    setTeamChannel: vi.fn(),
    getContact: vi.fn(),
  },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/services/alert_destination", () => ({
  default: { list: vi.fn(async () => ({ data: { list: [] } })) },
}));

const service = vi.mocked(oncallService);

const policy: OnCallPolicy = {
  id: "pol_1",
  org_id: "default",
  team_id: "team_1",
  rungs: [
    {
      priority: 1,
      steps: [{ after_micros: 0, targets: [{ kind: "rotation", rotation_id: "rot_primary" }] }],
      channels: ["email"],
    },
  ],
};

const scope: EditorDraftScope = {
  kind: "oncall_policy",
  org: "default",
  entityId: "team_1",
  userEmail: "example@gmail.com",
};

const ALL_OFF: L0Policy = {
  mode: { P1: "off", P2: "off", P3: "off", P4: "off" },
  triage_budget_seconds: 90,
  allow_promotion: true,
  max_promotion_steps: 2,
  allow_downgrade: true,
  allow_suppress: false,
};

const open = ref(true);
let saved = 0;
let router: Router;
let wrapper: VueWrapper | null = null;

const Host = defineComponent({
  setup() {
    return () =>
      h(OnCallPolicyEditor, {
        teamId: "team_1",
        policy,
        open: open.value,
        priority: 1,
        rotations: [{ id: "rot_primary", name: "Primary", shift_rules: [] }],
        "onUpdate:open": (value: boolean) => (open.value = value),
        onSaved: () => {
          saved++;
          open.value = false;
        },
      });
  },
});

const mountEditor = async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/oncall/teams/team_1", name: "team", component: Host },
      { path: "/oncall/teams", name: "teams", component: { render: () => h("div") } },
    ],
  });
  await router.push("/oncall/teams/team_1");
  wrapper = mount(
    { render: () => h(RouterView) },
    { attachTo: document.body, global: { plugins: [i18n, store, router] } },
  );
  await flushPromises();
};

const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const inDialog = (dialog: string, id: string) =>
  document.body.querySelector<HTMLElement>(`[data-test="${dialog}"] [data-test="${id}"]`);
const choose = async (dialog: string, id: string) => {
  inDialog(dialog, id)!.click();
  await flushPromises();
};
const smsBox = () =>
  document.body.querySelector<HTMLElement>(
    '[data-test="oncall-policy-channel-1-sms"] [role="checkbox"]',
  );

// A real click: the pointer lands first, then the box toggles.
const tickSms = async () => {
  const box = smsBox()!;
  box.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  box.click();
  await flushPromises();
};

const reopen = async () => {
  open.value = false;
  await flushPromises();
  open.value = true;
  await flushPromises();
};

describe("OnCallPolicyEditor drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    __resetOnCallRoutingConfig();
    resetOnCallPermissions();
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open.value = true;
    saved = 0;
    service.getTeamChannel.mockResolvedValue({
      data: { team_id: "team_1", destinations: [], source: "policy" },
    } as never);
    service.getRoutingConfig.mockResolvedValue({
      data: { org_id: "default", default_team_id: null, default_team_name: null, updated_at: 0 },
    } as never);
    service.listMembers.mockResolvedValue({ data: [] } as never);
    service.whoIsOnCall.mockResolvedValue({ data: [] } as never);
    service.setPolicy.mockResolvedValue({ data: {} } as never);
    service.getContact.mockResolvedValue({
      data: {
        unverified: [],
        phone_is_pageable: false,
        phone_provider_available: true,
        press4_available: false,
      },
    } as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("drafts a ladder edit made inside the teleported drawer under the team's key", async () => {
    await mountEditor();
    await tickSms();
    await vi.advanceTimersByTimeAsync(1100);

    const stored = readEditorDraft<{ rungs: { channels: string[] }[] }>(scope);
    expect(stored?.data.rungs[0].channels).toEqual(["email", "sms"]);
  });

  it("the drawer's ✕ with edits asks; Discard closes and keeps nothing", async () => {
    await mountEditor();
    await tickSms();

    byTest("o-drawer-close-btn")!.click();
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    expect(open.value).toBe(true);

    await choose("editor-draft-leave-dialog", "o-dialog-neutral-btn");
    expect(open.value).toBe(false);
    expect(readEditorDraft(scope)).toBeNull();
  });

  it("closing the leave dialog keeps the drawer open with the edit", async () => {
    await mountEditor();
    await tickSms();
    byTest("o-drawer-close-btn")!.click();
    await flushPromises();

    await choose("editor-draft-leave-dialog", "o-dialog-close-btn");
    expect(open.value).toBe(true);
    expect(smsBox()?.getAttribute("aria-checked")).toBe("true");
  });

  it("Keep draft closes; reopening offers it and Continue brings the edit back", async () => {
    await mountEditor();
    await tickSms();
    const cancel = [...document.body.querySelectorAll<HTMLElement>("button")].find(
      (button) => button.textContent?.trim() === "Cancel",
    )!;
    cancel.click();
    await flushPromises();
    await choose("editor-draft-leave-dialog", "o-dialog-secondary-btn");
    expect(open.value).toBe(false);
    expect(readEditorDraft(scope)).not.toBeNull();

    await reopen();
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
    await choose("editor-draft-restore-dialog", "editor-draft-continue");
    expect(smsBox()?.getAttribute("aria-checked")).toBe("true");
  });

  it("Start fresh drops the draft and opens on the stored policy", async () => {
    writeEditorDraft(scope, {
      data: {
        rungs: [{ ...policy.rungs[0], channels: ["email", "sms"] }],
        destinations: [],
        repeatCount: 1,
        finalAction: "stop",
        l0: null,
      },
    });
    await mountEditor();
    await choose("editor-draft-restore-dialog", "o-dialog-secondary-btn");

    expect(readEditorDraft(scope)).toBeNull();
    expect(smsBox()?.getAttribute("aria-checked")).toBe("false");
  });

  it("a restored triage gate reaches the AI triage editor", async () => {
    writeEditorDraft(scope, {
      data: {
        rungs: policy.rungs,
        destinations: [],
        repeatCount: 1,
        finalAction: "stop",
        l0: ALL_OFF,
      },
    });
    await mountEditor();
    const editor = wrapper!.findComponent(OnCallPolicyEditor).vm as unknown as {
      policyTab: string;
    };
    editor.policyTab = "triage";
    await flushPromises();
    expect(byTest("oncall-l0-ai-triage-toggle-btn")?.getAttribute("aria-checked")).toBe("true");

    await choose("editor-draft-restore-dialog", "editor-draft-continue");
    await nextTick();
    expect(byTest("oncall-l0-ai-triage-toggle-btn")?.getAttribute("aria-checked")).toBe("false");
  });

  it("the leave dialog's Save stores the policy and closes the drawer without navigating", async () => {
    await mountEditor();
    await tickSms();
    byTest("o-drawer-close-btn")!.click();
    await flushPromises();

    await choose("editor-draft-leave-dialog", "editor-draft-leave-save");

    expect(service.setPolicy).toHaveBeenCalledTimes(1);
    const body = (service.setPolicy.mock.calls[0][0] as unknown as { data: OnCallPolicy }).data;
    expect(body.rungs[0].channels).toEqual(["email", "sms"]);
    expect(saved).toBe(1);
    expect(open.value).toBe(false);
    expect(router.currentRoute.value.name).toBe("team");
    expect(readEditorDraft(scope)).toBeNull();
  });

  it("the leave dialog's Save says why when saving is denied, and keeps the drawer open", async () => {
    service.setPolicy.mockRejectedValueOnce({ response: { status: 403 } });
    await mountEditor();
    await tickSms();
    byTest("oncall-policy-save")!.click();
    await flushPromises();
    vi.mocked(toast).mockClear();

    byTest("o-drawer-close-btn")!.click();
    await flushPromises();
    await choose("editor-draft-leave-dialog", "editor-draft-leave-save");

    expect(service.setPolicy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast)).toHaveBeenCalledWith({
      variant: "error",
      title: i18n.global.t("oncall.savePolicyFailed"),
      message: i18n.global.t("oncall.configDenied"),
    });
    expect(open.value).toBe(true);
    expect(smsBox()?.getAttribute("aria-checked")).toBe("true");
  });

  it("the leave dialog's Save on an out-of-range hold budget says the policy was not saved", async () => {
    writeEditorDraft(scope, {
      data: {
        rungs: policy.rungs,
        destinations: [],
        repeatCount: 1,
        finalAction: "stop",
        l0: { ...ALL_OFF, triage_budget_seconds: 5 },
      },
    });
    await mountEditor();
    const editor = wrapper!.findComponent(OnCallPolicyEditor).vm as unknown as {
      policyTab: string;
    };
    editor.policyTab = "triage";
    await flushPromises();
    await choose("editor-draft-restore-dialog", "editor-draft-continue");
    await flushPromises();
    vi.mocked(toast).mockClear();

    byTest("o-drawer-close-btn")!.click();
    await flushPromises();
    await choose("editor-draft-leave-dialog", "editor-draft-leave-save");

    expect(service.setPolicy).not.toHaveBeenCalled();
    expect(vi.mocked(toast)).toHaveBeenCalledWith({
      variant: "error",
      title: i18n.global.t("oncall.savePolicyFailed"),
      message: i18n.global.t("oncall.l0BudgetInvalidNotSaved"),
    });
    expect(open.value).toBe(true);
  });

  it("a route leave with edits asks first, and staying keeps the page", async () => {
    await mountEditor();
    await tickSms();

    void router.push("/oncall/teams");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    await choose("editor-draft-leave-dialog", "o-dialog-close-btn");

    expect(router.currentRoute.value.name).toBe("team");
  });

  it("switching the open priority or tab alone is not an unsaved change", async () => {
    await mountEditor();
    const editor = wrapper!.findComponent(OnCallPolicyEditor).vm as unknown as {
      policyTab: string;
    };
    window.dispatchEvent(new Event("pointerdown"));
    editor.policyTab = "triage";
    await flushPromises();

    byTest("o-drawer-close-btn")!.click();
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(open.value).toBe(false);
  });
});
