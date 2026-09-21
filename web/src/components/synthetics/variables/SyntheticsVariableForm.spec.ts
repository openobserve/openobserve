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
import { flushPromises, mount, shallowMount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";

const confirmMock = vi.fn();
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

const createEnvVar = vi.fn().mockResolvedValue({});
const createGlobalVar = vi.fn().mockResolvedValue({});
const updateEnvVar = vi.fn().mockResolvedValue({});
vi.mock("@/services/synthetics", () => ({
  default: {
    createEnvironmentVariable: (...a: unknown[]) => createEnvVar(...a),
    createGlobalVariable: (...a: unknown[]) => createGlobalVar(...a),
    updateEnvironmentVariable: (...a: unknown[]) => updateEnvVar(...a),
    updateGlobalVariable: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

import { nextTick } from "vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import SyntheticsVariableForm from "./SyntheticsVariableForm.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";

function mountForm(props: Record<string, unknown> = {}) {
  return shallowMount(SyntheticsVariableForm, {
    props: { open: true, ...props },
    global: {
      plugins: [i18n],
      provide: { store: { state: { selectedOrganization: { identifier: "default" } } } },
      stubs: {
        ODrawer: { template: "<div><slot /></div>" },
        OForm: { template: "<form><slot /></form>" },
      },
    },
  }) as VueWrapper;
}

// Real OForm + OFormInput so typing drives the field the way a user does.
function mountFormWithInputs(props: Record<string, unknown> = {}) {
  return mount(SyntheticsVariableForm, {
    props: { open: true, ...props },
    global: {
      plugins: [i18n],
      provide: { store: { state: { selectedOrganization: { identifier: "default" } } } },
      stubs: {
        ODrawer: { template: "<div><slot /></div>" },
        OFormSelect: { template: "<div />", props: ["name", "options", "disabled", "hint"] },
        OBanner: { template: "<div><slot /></div>", props: ["variant"] },
      },
    },
  }) as VueWrapper;
}

describe("SyntheticsVariableForm — cross-tier shadow confirms", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("asks before creating an env variable that shadows a global", async () => {
    wrapper = mountForm({ environment: "staging", otherTierNames: { URL: [] } });
    await (wrapper.vm as any).save({ name: "url", kind: "plain", value: "x" });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    const message = String(confirmMock.mock.calls[0][0].message);
    expect(message).toContain("staging");
    expect(message).toContain("URL");
    expect(createEnvVar).toHaveBeenCalledTimes(1);
  });

  it("declining the confirm saves nothing", async () => {
    confirmMock.mockResolvedValue(false);
    wrapper = mountForm({ environment: "staging", otherTierNames: { URL: [] } });
    await (wrapper.vm as any).save({ name: "URL", kind: "plain", value: "x" });

    expect(createEnvVar).not.toHaveBeenCalled();
    expect(wrapper.emitted("update:list")).toBeUndefined();
  });

  it("a name with no counterpart in the other tier saves without asking", async () => {
    wrapper = mountForm({ environment: "staging", otherTierNames: { URL: [] } });
    await (wrapper.vm as any).save({ name: "TIMEOUT", kind: "plain", value: "x" });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(createEnvVar).toHaveBeenCalledTimes(1);
  });

  it("editing an existing shadow without renaming does not re-ask", async () => {
    wrapper = mountForm({
      environment: "staging",
      isEdit: true,
      data: { id: "v1", name: "URL", kind: "plain", value: "https://a.test", has_value: true },
      otherTierNames: { URL: [] },
    });
    await (wrapper.vm as any).save({ name: "URL", kind: "plain", value: "" });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(updateEnvVar).toHaveBeenCalledTimes(1);
  });

  it("creating a global under env rows names the environments that keep theirs", async () => {
    wrapper = mountForm({ environment: null, otherTierNames: { URL: ["staging", "ap1"] } });
    await (wrapper.vm as any).save({ name: "URL", kind: "plain", value: "x" });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    const message = String(confirmMock.mock.calls[0][0].message);
    expect(message).toContain("staging, ap1");
    expect(createGlobalVar).toHaveBeenCalledTimes(1);
  });
});

describe("SyntheticsVariableForm — kind is fixed at creation", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("disables the Kind select when editing an existing variable", () => {
    wrapper = mountForm({
      environment: "staging",
      isEdit: true,
      data: { id: "v1", name: "API_KEY", kind: "secret", has_value: true },
    });

    expect(wrapper.findComponent(OFormSelect).props("disabled")).toBe(true);
  });

  it("leaves the Kind select enabled when creating inside an environment", () => {
    wrapper = mountForm({ environment: "staging" });

    expect(wrapper.findComponent(OFormSelect).props("disabled")).toBe(false);
  });

  it("keeps the Kind select disabled on the global tab, where a secret cannot exist", () => {
    wrapper = mountForm({ environment: null });

    const select = wrapper.findComponent(OFormSelect);
    expect(select.props("disabled")).toBe(true);
    const values = (select.props("options") as { value: string }[]).map((o) => o.value);
    expect(values).toEqual(["plain"]);
  });

  it("warns that a global value reaches production, and only on the global tab", () => {
    const warnings = () =>
      wrapper.findAllComponents(OBanner).filter((b) => b.props("variant") === "warning");
    wrapper = mountForm({ environment: null });
    expect(warnings()).toHaveLength(1);
    wrapper.unmount();

    wrapper = mountForm({ environment: "staging" });
    expect(warnings()).toHaveLength(0);
  });
});

describe("SyntheticsVariableForm — value field", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  const valueInput = () =>
    wrapper.findAllComponents(OFormInput).find((input) => input.props("name") === "value");
  const defaults = () => (wrapper.vm as unknown as { defaults: { value: string } }).defaults;

  it("prefills a plain variable's current value on edit", () => {
    wrapper = mountForm({
      environment: "staging",
      isEdit: true,
      data: { id: "v1", name: "URL", kind: "plain", value: "https://a.test", has_value: true },
    });

    expect(defaults().value).toBe("https://a.test");
    expect(valueInput()?.props("type")).toBe("text");
  });

  it("never prefills a secret", () => {
    wrapper = mountForm({
      environment: "staging",
      isEdit: true,
      data: { id: "v1", name: "TOKEN", kind: "secret", has_value: false },
    });

    expect(defaults().value).toBe("");
  });

  it("masks the value once a new variable is switched to secret", async () => {
    wrapper = mountForm({ environment: "staging" });
    expect(valueInput()?.props("type")).toBe("text");

    wrapper.findComponent(OFormSelect).vm.$emit("update:model-value", "secret");
    await nextTick();

    expect(valueInput()?.props("type")).toBe("password");
  });
});

describe("SyntheticsVariableForm — saving an edit", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("sends an emptied plain value rather than keeping the stored one", async () => {
    wrapper = mountForm({
      environment: "staging",
      isEdit: true,
      data: { id: "v1", name: "URL", kind: "plain", value: "https://a.test", has_value: true },
    });
    await (wrapper.vm as any).save({ name: "URL", kind: "plain", value: "" });

    expect(updateEnvVar).toHaveBeenCalledTimes(1);
    expect(updateEnvVar.mock.calls[0][3]).toMatchObject({ value: "" });
  });

  it("omits a blank secret value so the stored one is kept", async () => {
    wrapper = mountForm({
      environment: "staging",
      isEdit: true,
      data: { id: "v1", name: "TOKEN", kind: "secret", has_value: true },
    });
    await (wrapper.vm as any).save({ name: "TOKEN", kind: "secret", value: "" });

    expect(updateEnvVar.mock.calls[0][3]).not.toHaveProperty("value");
  });
});

describe("SyntheticsVariableForm — the name is upper-case from the first keystroke", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  const nameInput = () => wrapper.find('[data-test="synthetics-variable-name-input"] input');

  it("shows MY_URL in the Name input after typing my_url", async () => {
    wrapper = mountFormWithInputs({ environment: "staging" });
    await nameInput().setValue("my_url");
    await flushPromises();

    expect((nameInput().element as HTMLInputElement).value).toBe("MY_URL");
  });

  it("submitting the typed form sends the upper-cased name", async () => {
    wrapper = mountFormWithInputs({ environment: "staging" });
    await nameInput().setValue("my_url");
    await wrapper.find('[data-test="synthetics-variable-value-input"] input').setValue("x");
    await wrapper.find("form").trigger("submit");
    await vi.waitFor(() => expect(createEnvVar).toHaveBeenCalledTimes(1));

    expect(createEnvVar.mock.calls[0][2]).toMatchObject({ name: "MY_URL" });
  });

  it("save() sends the upper-cased name even when handed a lower-case one", async () => {
    wrapper = mountForm({ environment: "staging" });
    await (wrapper.vm as any).save({ name: "my_url", kind: "plain", value: "x" });

    expect(createEnvVar).toHaveBeenCalledTimes(1);
    expect(createEnvVar.mock.calls[0][2]).toMatchObject({ name: "MY_URL" });
  });

  it("the create toast names the stored (upper-cased) variable", async () => {
    wrapper = mountForm({ environment: "staging" });
    await (wrapper.vm as any).save({ name: "my_url", kind: "plain", value: "x" });

    expect(toast).toHaveBeenCalledTimes(1);
    const message = String(vi.mocked(toast).mock.calls[0][0].message);
    expect(message).toContain("MY_URL");
    expect(message).not.toContain("my_url");
  });
});

describe("SyntheticsVariableForm — captions explain the locked Kind and the write-only secret", () => {
  let wrapper: VueWrapper;
  const locale = "en-us";
  const keys = ["secretNeedsEnvironment", "secretWriteOnly"] as const;
  const originals: Partial<Record<(typeof keys)[number], string>> = {};

  // Sentinels prove the caption goes through the locale key, not a hard-coded string.
  beforeEach(() => {
    const variables = (i18n.global.getLocaleMessage(locale) as any).synthetics?.variables ?? {};
    for (const key of keys) originals[key] = variables[key];
    i18n.global.mergeLocaleMessage(locale, {
      synthetics: {
        variables: {
          secretNeedsEnvironment: "SENTINEL_GLOBAL",
          secretWriteOnly: "SENTINEL_WRITE_ONLY",
        },
      },
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    const variables = (i18n.global.getLocaleMessage(locale) as any).synthetics.variables;
    for (const key of keys) {
      if (originals[key] === undefined) delete variables[key];
      else variables[key] = originals[key];
    }
  });

  const secretEdit = (has_value: boolean) => ({
    environment: "staging",
    isEdit: true,
    data: { id: "v1", name: "TOKEN", kind: "secret", has_value },
  });

  it("ships both caption keys in en-US", () => {
    for (const key of keys) {
      expect(originals[key], key).toBeTypeOf("string");
    }
  });

  it("on the global tab, tells why no secret can be created there", () => {
    wrapper = mountForm({ environment: null });

    expect(wrapper.text()).toContain("SENTINEL_GLOBAL");
  });

  it("inside an environment, shows no such caption", () => {
    wrapper = mountForm({ environment: "staging" });

    expect(wrapper.text()).not.toContain("SENTINEL_GLOBAL");
  });

  it("no longer passes the caption as a hint the select would drop", () => {
    wrapper = mountForm({ environment: null });

    expect(wrapper.findComponent(OFormSelect).attributes("hint")).toBeUndefined();
  });

  it("editing a stored secret says the value is write-only", () => {
    wrapper = mountForm(secretEdit(true));

    expect(wrapper.find('[data-test="synthetics-variable-value-set"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("SENTINEL_WRITE_ONLY");
  });

  it("editing a secret with no stored value shows the input, not the write-only caption", () => {
    wrapper = mountForm(secretEdit(false));

    expect(wrapper.text()).not.toContain("SENTINEL_WRITE_ONLY");
  });

  it("choosing Replace swaps the write-only caption for the value input", async () => {
    wrapper = mountForm(secretEdit(true));
    (wrapper.vm as any).replacing = true;
    await nextTick();

    expect(wrapper.find('[data-test="synthetics-variable-value-set"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("SENTINEL_WRITE_ONLY");
  });

  it("editing a plain variable says nothing about write-only", () => {
    wrapper = mountForm({
      environment: "staging",
      isEdit: true,
      data: { id: "v1", name: "URL", kind: "plain", value: "https://a.test", has_value: true },
    });

    expect(wrapper.text()).not.toContain("SENTINEL_WRITE_ONLY");
  });
});
