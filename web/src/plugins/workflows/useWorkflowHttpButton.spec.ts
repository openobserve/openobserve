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
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import workflows from "@/services/workflows";
import { httpAbsent, httpConfig } from "@/test/unit/helpers/workflowHttp";
import {
  httpButtonChip,
  httpButtonState,
  httpButtonTooltip,
  useWorkflowHttpButton,
  type HttpButtonState,
} from "./useWorkflowHttpButton";

vi.mock("@/services/workflows", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { getHttpTrigger: vi.fn() },
  });
});

const api = vi.mocked(workflows);
const t = (k: string) => i18n.global.t(k);

describe("httpButtonState", () => {
  it("reads none, off, draft, paused and on, with draft ahead of paused", () => {
    expect(httpButtonState(undefined, false, true)).toBe("none");
    expect(httpButtonState(httpAbsent(), false, true)).toBe("none");
    expect(httpButtonState(httpConfig({ enabled: false }), true, false)).toBe("off");
    expect(httpButtonState(httpConfig(), true, false)).toBe("draft");
    expect(httpButtonState(httpConfig(), false, false)).toBe("paused");
    expect(httpButtonState(httpConfig(), false, true)).toBe("on");
  });
});

describe("httpButtonChip and httpButtonTooltip", () => {
  const cases: [HttpButtonState, string | null, string | null, string | null][] = [
    ["on", "success-soft", "On", null],
    ["paused", "warning-soft", "On", "Requests get 403 while the workflow is paused"],
    ["draft", "warning-soft", "On", "Requests get 403 until the workflow is published"],
    ["off", "default-soft", "Off", "Let another system start this workflow with an HTTP request"],
    ["none", null, null, "Let another system start this workflow with an HTTP request"],
  ];

  it.each(cases)("%s: chip %s %s, tooltip %s", (state, variant, label, tooltip) => {
    const chip = httpButtonChip(state);
    expect(chip?.variant ?? null).toBe(variant);
    expect(chip ? t(chip.labelKey) : null).toBe(label);
    const key = httpButtonTooltip(state);
    expect(key ? t(key) : null).toBe(tooltip);
  });

  it("the draft and paused tooltips differ", () => {
    expect(httpButtonTooltip("draft")).not.toBe(httpButtonTooltip("paused"));
  });
});

describe("useWorkflowHttpButton", () => {
  const mounted: VueWrapper[] = [];
  const isDraft = ref(false);
  const workflowEnabled = ref(true);

  const mountButton = async (workflowId = "wf1") => {
    let result!: ReturnType<typeof useWorkflowHttpButton>;
    const Host = defineComponent({
      setup() {
        result = useWorkflowHttpButton({ workflowId: ref(workflowId), isDraft, workflowEnabled });
        return () => h("div");
      },
    });
    mounted.push(mount(Host, { global: { plugins: [i18n, store] } }));
    await flushPromises();
    return result;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    isDraft.value = false;
    workflowEnabled.value = true;
    store.state.zoConfig = { ...store.state.zoConfig, workflow_hooks_enabled: true };
    api.getHttpTrigger.mockResolvedValue(httpConfig());
  });
  afterEach(() => {
    for (const w of mounted.splice(0)) w.unmount();
    store.state.zoConfig = { ...store.state.zoConfig, workflow_hooks_enabled: false };
  });

  it("follows the endpoint and the workflow state", async () => {
    const button = await mountButton();
    expect(button.visible.value).toBe(true);
    expect(button.state.value).toBe("on");
    expect(button.endpointOn.value).toBe(true);
    isDraft.value = true;
    expect(button.state.value).toBe("draft");
    isDraft.value = false;
    workflowEnabled.value = false;
    expect(button.state.value).toBe("paused");
    expect(button.endpointOn.value).toBe(true);
  });

  it("an endpoint switched off reads off with the neutral chip", async () => {
    api.getHttpTrigger.mockResolvedValue(httpConfig({ enabled: false }));
    const button = await mountButton();
    expect(button.state.value).toBe("off");
    expect(button.endpointOn.value).toBe(false);
    expect(button.chip.value?.variant).toBe("default-soft");
  });

  it("no endpoint configured shows no chip", async () => {
    api.getHttpTrigger.mockResolvedValue(httpAbsent());
    const button = await mountButton();
    expect(button.state.value).toBe("none");
    expect(button.chip.value).toBeNull();
  });

  it("asks for nothing while HTTP endpoints are disabled for the org", async () => {
    store.state.zoConfig = { ...store.state.zoConfig, workflow_hooks_enabled: false };
    const button = await mountButton();
    expect(button.visible.value).toBe(false);
    expect(button.state.value).toBe("none");
    expect(api.getHttpTrigger).not.toHaveBeenCalled();
  });
});
