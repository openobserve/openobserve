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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeAssistant } from "@/components/ai-assistant/__tests__/fakeAssistant";
import aiToolsets from "@/services/ai_toolsets";

import AssistantToolsetForm from "./AssistantToolsetForm.vue";
import { settingsHarness } from "./assistantSettings.test-helpers";

const { fake, toast, confirm } = vi.hoisted(() => ({
  fake: {
    current: null as ReturnType<
      typeof import("@/components/ai-assistant/__tests__/fakeAssistant").fakeAssistant
    > | null,
  },
  toast: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantCapability: () => fake.current!.handle,
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));
vi.mock("@/composables/useConfirmDialog", () => ({ useConfirmDialog: () => ({ confirm }) }));
vi.mock("@/components/CodeQueryEditor.vue", () => ({ default: { render: () => null } }));
vi.mock("@/services/ai_toolsets", () => ({
  default: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

const STORED = {
  id: "ts_1",
  name: "pagerduty",
  kind: "mcp",
  description: "Pages people",
  data: { url: "https://pd.example/mcp", timeout_seconds: 20, headers: { Authorization: "***" } },
};

const CLI = {
  id: "ts_2",
  name: "kube",
  kind: "cli",
  data: { command: "kubectl", allowed_subcommands: ["get"], requires_confirmation: true, env: {} },
};

async function settle() {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
}

async function mountForm(props: Record<string, unknown>) {
  const h = settingsHarness();
  await h.router.push("/settings/assistant/toolsets");
  const w = mount(AssistantToolsetForm, {
    props: { existing: [], mergeSecrets: true, ...props },
    global: { plugins: h.plugins },
    attachTo: document.body,
  });
  await settle();
  return w;
}

async function save(w: ReturnType<typeof mount>) {
  await w.find("form").trigger("submit");
  await settle();
}

let wrapper: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  fake.current = fakeAssistant("available");
  vi.mocked(aiToolsets.update).mockResolvedValue({ data: {} } as never);
  vi.mocked(aiToolsets.create).mockResolvedValue({ data: {} } as never);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("AssistantToolsetForm", () => {
  it("keeps an unchanged secret as the mask on a merging server", async () => {
    vi.mocked(aiToolsets.get).mockResolvedValue({ data: STORED } as never);
    const w = (wrapper = await mountForm({ editId: "ts_1" }));
    expect(w.find('[data-test="ai-toolset-header-0-unchanged"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-toolset-retype-notice"]').exists()).toBe(false);
    expect(w.html()).not.toContain("***");
    await save(w);
    expect(aiToolsets.update).toHaveBeenCalledWith("acme", "ts_1", {
      description: "Pages people",
      data: {
        url: "https://pd.example/mcp",
        timeout_seconds: 20,
        headers: { Authorization: "***" },
      },
    });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Toolset updated" }));
  });

  it("sends only the replaced plaintext after Replace", async () => {
    vi.mocked(aiToolsets.get).mockResolvedValue({ data: STORED } as never);
    const w = (wrapper = await mountForm({ editId: "ts_1" }));
    await w.find('[data-test="ai-toolset-header-0-replace"]').trigger("click");
    await settle();
    await w.find('[data-test="ai-toolset-header-0-input"] input').setValue("Bearer new");
    await save(w);
    expect(vi.mocked(aiToolsets.update).mock.calls[0][2].data).toMatchObject({
      headers: { Authorization: "Bearer new" },
    });
  });

  it("blocks Save until every secret is typed again without merge, and never sends the mask", async () => {
    vi.mocked(aiToolsets.get).mockResolvedValue({ data: STORED } as never);
    const w = (wrapper = await mountForm({ editId: "ts_1", mergeSecrets: false }));
    expect(w.find('[data-test="ai-toolset-retype-notice"]').exists()).toBe(true);
    await save(w);
    expect(aiToolsets.update).not.toHaveBeenCalled();
    expect(w.text()).toContain("Enter the value again");
    await w.find('[data-test="ai-toolset-header-0-input"] input').setValue("Bearer typed");
    await save(w);
    const body = vi.mocked(aiToolsets.update).mock.calls[0][2];
    expect(JSON.stringify(body)).not.toContain("***");
    expect(body.data).toMatchObject({ headers: { Authorization: "Bearer typed" } });
  });

  it("shows a load error with Retry and Back, never a create form", async () => {
    vi.mocked(aiToolsets.get).mockRejectedValue({ response: { status: 500 } });
    const w = (wrapper = await mountForm({ editId: "ts_1" }));
    expect(w.find('[data-test="ai-toolset-form-load-error"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-toolset-save-btn"]').exists()).toBe(false);
    await w.find('[data-test="ai-toolset-form-back"]').trigger("click");
    expect(w.emitted("done")).toHaveLength(1);
  });

  it("asks before turning approval off on a saved CLI toolset", async () => {
    vi.mocked(aiToolsets.get).mockResolvedValue({ data: CLI } as never);
    confirm.mockResolvedValue(false);
    const w = (wrapper = await mountForm({ editId: "ts_2" }));
    expect(w.find('[data-test="ai-toolset-cli-approval-line"]').text()).toContain(
      "Members see an approval card",
    );
    await w.find('[data-test="ai-toolset-cli-approval-btn"]').trigger("click");
    await settle();
    expect(w.find('[data-test="ai-toolset-cli-approval-line"]').text()).toContain(
      "runs this command without asking",
    );
    await save(w);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Let the assistant run kubectl without asking?" }),
    );
    expect(aiToolsets.update).not.toHaveBeenCalled();
  });

  it("saves one of two toolsets whose names already clash", async () => {
    vi.mocked(aiToolsets.get).mockResolvedValue({ data: { ...STORED, name: "My_Tool" } } as never);
    const existing = [
      { id: "ts_1", name: "My_Tool", agentName: "my-tool" },
      { id: "ts_9", name: "my-tool", agentName: "my-tool" },
    ];
    const w = (wrapper = await mountForm({ editId: "ts_1", existing }));
    await save(w);
    expect(aiToolsets.update).toHaveBeenCalledTimes(1);
    expect(w.text()).not.toContain("Another toolset already reaches the assistant");
  });

  it("asks for every kept secret again when the URL changes, then never sends the mask", async () => {
    const two = {
      ...STORED,
      data: { ...STORED.data, headers: { Authorization: "***", "X-Team": "***" } },
    };
    vi.mocked(aiToolsets.get).mockResolvedValue({ data: two } as never);
    const w = (wrapper = await mountForm({ editId: "ts_1" }));
    await w.find('[data-test="ai-toolset-mcp-url"] input').setValue("https://other.example/mcp");
    await settle();
    expect(w.find('[data-test="ai-toolset-reenter-notice"]').text()).toContain(
      "Enter every secret again",
    );
    await save(w);
    expect(aiToolsets.update).not.toHaveBeenCalled();
    expect(w.find('[data-test="ai-toolset-header-0"]').attributes("data-state")).toBe("replacing");
    expect(w.find('[data-test="ai-toolset-header-1"]').attributes("data-state")).toBe("replacing");
    expect(w.find('[data-test="ai-toolset-reenter-notice"]').exists()).toBe(true);
    await w.find('[data-test="ai-toolset-header-0-input"] input').setValue("Bearer a");
    await w.find('[data-test="ai-toolset-header-1-input"] input').setValue("team-7");
    await save(w);
    const body = vi.mocked(aiToolsets.update).mock.calls[0][2];
    expect(JSON.stringify(body)).not.toContain("***");
    expect(body.data).toMatchObject({ headers: { Authorization: "Bearer a", "X-Team": "team-7" } });
  });

  it("asks for the other secrets again when one is replaced", async () => {
    const two = {
      ...STORED,
      data: { ...STORED.data, headers: { Authorization: "***", "X-Team": "***" } },
    };
    vi.mocked(aiToolsets.get).mockResolvedValue({ data: two } as never);
    const w = (wrapper = await mountForm({ editId: "ts_1" }));
    await w.find('[data-test="ai-toolset-header-1-replace"]').trigger("click");
    await settle();
    await w.find('[data-test="ai-toolset-header-1-input"] input').setValue("team-7");
    await settle();
    expect(w.find('[data-test="ai-toolset-reenter-notice"]').text()).toContain("new or replaced");
    await save(w);
    expect(aiToolsets.update).not.toHaveBeenCalled();
    expect(w.find('[data-test="ai-toolset-header-0"]').attributes("data-state")).toBe("replacing");
  });

  it("maps the server's destination_changed refusal onto the secrets, with no success toast", async () => {
    vi.mocked(aiToolsets.get).mockResolvedValue({ data: STORED } as never);
    vi.mocked(aiToolsets.update).mockRejectedValue({
      response: {
        status: 400,
        data: {
          code: "invalid_request",
          error_code: "destination_changed",
          fields: ["url"],
          message: "Re-enter every secret",
        },
      },
    });
    const w = (wrapper = await mountForm({ editId: "ts_1" }));
    await save(w);
    expect(toast).not.toHaveBeenCalled();
    expect(w.find('[data-test="ai-toolset-form-error"]').exists()).toBe(false);
    expect(w.find('[data-test="ai-toolset-reenter-notice"]').text()).toContain(
      "The server dropped the stored secrets",
    );
    expect(w.find('[data-test="ai-toolset-header-0"]').attributes("data-state")).toBe("replacing");
  });

  it("locks the key of a kept secret so a rename cannot drop it", async () => {
    vi.mocked(aiToolsets.get).mockResolvedValue({ data: STORED } as never);
    const w = (wrapper = await mountForm({ editId: "ts_1" }));
    expect(
      w.find('[data-test="ai-toolset-header-0-key"] input').attributes("readonly"),
    ).toBeDefined();
    await w.find('[data-test="ai-toolset-header-0-replace"]').trigger("click");
    await settle();
    expect(
      w.find('[data-test="ai-toolset-header-0-key"] input').attributes("readonly"),
    ).toBeUndefined();
    await w.find('[data-test="ai-toolset-header-0-key"] input').setValue("Authorization2");
    await w.find('[data-test="ai-toolset-header-0-keep"]').trigger("click");
    await settle();
    expect(
      (w.find('[data-test="ai-toolset-header-0-key"] input').element as HTMLInputElement).value,
    ).toBe("Authorization");
    await save(w);
    expect(vi.mocked(aiToolsets.update).mock.calls[0][2].data).toMatchObject({
      headers: { Authorization: "***" },
    });
  });

  it("refuses *** as a typed value and sends an emptied description", async () => {
    vi.mocked(aiToolsets.get).mockResolvedValue({ data: STORED } as never);
    const w = (wrapper = await mountForm({ editId: "ts_1" }));
    await w.find('[data-test="ai-toolset-description-input"] textarea').setValue("");
    await w.find('[data-test="ai-toolset-header-0-replace"]').trigger("click");
    await settle();
    await w.find('[data-test="ai-toolset-header-0-input"] input').setValue("***");
    await save(w);
    expect(aiToolsets.update).not.toHaveBeenCalled();
    expect(w.text()).toContain("*** is how a kept secret is sent");
    await w.find('[data-test="ai-toolset-header-0-input"] input').setValue("Bearer real");
    await save(w);
    expect(vi.mocked(aiToolsets.update).mock.calls[0][2]).toMatchObject({ description: "" });
  });

  it("hides the CLI presets on a saved toolset so they cannot replace stored credentials", async () => {
    vi.mocked(aiToolsets.get).mockResolvedValue({ data: CLI } as never);
    const w = (wrapper = await mountForm({ editId: "ts_2" }));
    expect(w.find('[data-test="ai-toolset-cli-fields"]').exists()).toBe(true);
    expect(w.find('[data-test="cli-preset-kubectl"]').exists()).toBe(false);
  });

  it("treats edit without an id as a load error, never a create form", async () => {
    const w = (wrapper = await mountForm({ mode: "edit" }));
    expect(w.find('[data-test="ai-toolset-form-title"]').text()).toBe("Edit toolset");
    expect(w.find('[data-test="ai-toolset-form-load-error"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-toolset-form-retry"]').exists()).toBe(false);
    expect(aiToolsets.get).not.toHaveBeenCalled();
  });

  it("names the Toolsets permission after a 403 and reports it to the list", async () => {
    vi.mocked(aiToolsets.get).mockResolvedValue({ data: STORED } as never);
    vi.mocked(aiToolsets.update).mockRejectedValue({ response: { status: 403 } });
    const w = (wrapper = await mountForm({ editId: "ts_1" }));
    await save(w);
    expect(w.find('[data-test="ai-toolset-form-error"]').text()).toContain("Toolsets permission");
    expect(w.emitted("forbidden")).toHaveLength(1);
  });

  it("previews the agent name and names the org in the create toast", async () => {
    const w = (wrapper = await mountForm({}));
    await w.find('[data-test="ai-toolset-name-input"] input').setValue("My_Tool");
    await settle();
    expect(w.find('[data-test="ai-toolset-agent-name"]').text()).toBe(
      "The assistant calls this my-tool",
    );
    await w.find('[data-test="ai-toolset-mcp-url"] input').setValue("https://x.example/mcp");
    await save(w);
    expect(aiToolsets.create).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ name: "My_Tool", kind: "mcp" }),
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Toolset added. O2 Assistant and incident analysis in Acme can use it from the next answer.",
      }),
    );
  });
});
