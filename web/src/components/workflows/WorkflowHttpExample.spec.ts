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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { computed, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import { HTTP_ENDPOINT_KEY, type WorkflowHttpEndpoint } from "@/plugins/workflows/httpEndpointUi";
import type { HttpTriggerConfig, HttpTriggerPermissions } from "@/services/workflows";
import { httpConfig, httpCredential, OTooltipStub } from "@/test/unit/helpers/workflowHttp";
import WorkflowHttpExample from "./WorkflowHttpExample.vue";

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...a: unknown[]) => mockToast(...a) }));

const ROW_VALUE = "o2wh_ROWVALUEREVEALEDFROMTHETABLE01";

const CodeBlockStub = {
  name: "OCodeBlock",
  props: ["code", "lang", "copyable", "wrap", "padded", "sensitive", "dataTest"],
  template: `<div class="o-code"><pre class="o-code-text">{{ code }}</pre><slot name="actions" /></div>`,
};
const ButtonStub = {
  name: "OButton",
  props: ["variant", "size", "loading"],
  emits: ["click"],
  template: `<button v-bind="$attrs" @click="$emit('click')"><slot /></button>`,
};

const mountExample = (over: Partial<HttpTriggerConfig> = {}, perms?: HttpTriggerPermissions) => {
  const config = ref(
    httpConfig({
      credentials: [httpCredential({ display_prefix: "o2wh_4fK9…oI4k" })],
      ...(perms ? { permissions: perms } : {}),
      ...over,
    }),
  );
  const revealedCredentials = ref<Record<string, string>>({});
  const endpoint = {
    config,
    permissions: computed(() => config.value.permissions),
    activeCredential: computed(() => config.value.credentials.find((c) => c.state === "active")),
    revealedCredentials,
    revealing: ref<string | null>(null),
    revealCredential: vi.fn(async (id: string) => {
      revealedCredentials.value = { ...revealedCredentials.value, [id]: ROW_VALUE };
    }),
    hideCredential: vi.fn((id: string) => {
      const { [id]: _gone, ...rest } = revealedCredentials.value;
      revealedCredentials.value = rest;
    }),
    copyExample: vi.fn().mockResolvedValue(true),
  };
  const wrapper = mount(WorkflowHttpExample, {
    global: {
      plugins: [i18n],
      provide: { [HTTP_ENDPOINT_KEY as symbol]: endpoint as unknown as WorkflowHttpEndpoint },
      stubs: { OCodeBlock: CodeBlockStub, OButton: ButtonStub, OTooltip: OTooltipStub },
    },
  });
  return { wrapper, endpoint };
};

const codeOf = (w: ReturnType<typeof mount>) => w.find(".o-code-text").text();

describe("WorkflowHttpExample", () => {
  beforeEach(() => mockToast.mockClear());

  it("shows a bash curl call masked by the active credential's prefix, with its own copy button", () => {
    const { wrapper } = mountExample();
    const block = wrapper.findComponent(CodeBlockStub as never);
    expect(block.props("lang")).toBe("bash");
    expect(block.props("copyable")).toBe(false);
    expect(block.props("sensitive")).toBe("");
    expect(codeOf(wrapper)).toContain("Authorization: Bearer o2wh_4fK9••••");
    expect(codeOf(wrapper)).toContain("oI4k");
    expect(wrapper.find('[data-test="workflow-http-example-credential"]').text()).toContain(
      "o2wh_4fK9…oI4k",
    );
    expect(wrapper.find('[data-test="workflow-http-example-copy"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="workflow-http-example-hint"]').text()).toContain(
      "Postman or Insomnia",
    );
  });

  it("the eye reveals and hides through the shared, audited row reveal", async () => {
    const { wrapper, endpoint } = mountExample();
    await wrapper.find('[data-test="workflow-http-example-reveal"]').trigger("click");
    await flushPromises();
    expect(endpoint.revealCredential).toHaveBeenCalledWith("c1");
    expect(codeOf(wrapper)).toContain(`Bearer ${ROW_VALUE}`);

    await wrapper.find('[data-test="workflow-http-example-reveal"]').trigger("click");
    expect(endpoint.hideCredential).toHaveBeenCalledWith("c1");
    expect(codeOf(wrapper)).not.toContain(ROW_VALUE);
  });

  it("copy goes through copyExample and toasts like the row copy", async () => {
    const { wrapper, endpoint } = mountExample();
    await wrapper.find('[data-test="workflow-http-example-copy"]').trigger("click");
    await flushPromises();
    expect(endpoint.copyExample).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success", message: "Token copied" }),
    );
  });

  it("uses the copied mode for the toast after a mode switch", async () => {
    const { wrapper, endpoint } = mountExample();
    let finish!: (value: boolean) => void;
    endpoint.copyExample.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    await wrapper.find('[data-test="workflow-http-example-copy"]').trigger("click");
    endpoint.config.value = { ...endpoint.config.value, auth_mode: "signature" };
    finish(true);
    await flushPromises();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success", message: "Token copied" }),
    );
  });

  it("without reveal permission shows placeholders and no eye", () => {
    const { wrapper } = mountExample({}, { edit: false, test: false, reveal: false });
    expect(codeOf(wrapper)).toContain("$O2_HOOK_TOKEN");
    expect(codeOf(wrapper)).not.toContain("••••");
    expect(wrapper.find('[data-test="workflow-http-example-reveal"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="workflow-http-example-copy"]').exists()).toBe(true);
  });

  it("signed mode shows the openssl signing script and its own hint", () => {
    const { wrapper } = mountExample({
      auth_mode: "signature",
      credentials: [httpCredential({ kind: "signing_secret", display_prefix: "whsec_Ab12…Yz90" })],
    });
    expect(codeOf(wrapper)).toContain("SECRET='whsec_Ab12••••");
    expect(codeOf(wrapper)).toContain("openssl dgst -sha256");
    expect(wrapper.find('[data-test="workflow-http-example-hint"]').text()).toContain(
      "Import tools cannot sign",
    );
  });
});
