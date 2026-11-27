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
import { byTest, click } from "@/test/unit/helpers/draftDom";
import { fillField } from "@/test/unit/helpers/fillField";
import {
  editorDraftKey,
  readEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";

import AssistantToolsetForm from "./AssistantToolsetForm.vue";
import { settingsHarness } from "./assistantSettings.test-helpers";

const { fake } = vi.hoisted(() => ({
  fake: {
    current: null as ReturnType<
      typeof import("@/components/ai-assistant/__tests__/fakeAssistant").fakeAssistant
    > | null,
  },
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantCapability: () => fake.current!.handle,
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/components/CodeQueryEditor.vue", () => ({
  __esModule: true,
  default: { name: "QueryEditorStub", props: ["query"], render: () => null },
}));
vi.mock("@/services/ai_toolsets", () => ({
  default: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    prebuilt: vi.fn(),
    discover: vi.fn(),
  },
}));

const EMAIL = "ada@example.com";
const newScope: EditorDraftScope = {
  kind: "ai_toolset",
  org: "acme",
  entityId: null,
  userEmail: EMAIL,
};

const DATADOG = {
  id: "datadog",
  kind: "mcp",
  label: "Datadog",
  revision: 3,
  url_template: "https://mcp.{site}/api/mcp",
  params: [{ name: "site", label: "Site", options: ["datadoghq.com"], default: "datadoghq.com" }],
  headers: [{ name: "DD-API-KEY" }],
  allowed_tools: ["search_logs"],
  write_tools: [],
};

const STORED = {
  id: "ts_1",
  name: "pagerduty",
  kind: "mcp",
  description: "Pages people",
  data: { url: "https://pd.example/mcp", timeout_seconds: 20, headers: { Authorization: "***" } },
};

async function settle() {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
}

let wrapper: ReturnType<typeof mount> | null = null;

async function mountForm(query: Record<string, string>, props: Record<string, unknown> = {}) {
  const h = settingsHarness();
  Object.assign(h.store.state, { userInfo: { email: EMAIL } });
  await h.router.push({ path: "/settings/assistant/toolsets", query });
  wrapper = mount(AssistantToolsetForm, {
    props: { existing: [], mergeSecrets: true, ...props },
    global: { plugins: h.plugins },
    attachTo: document.body,
  });
  await settle();
  return { w: wrapper, router: h.router };
}

function unmount() {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
}

beforeEach(() => {
  localStorage.clear();
  fake.current = fakeAssistant("available");
  vi.mocked(aiToolsets.prebuilt).mockResolvedValue({ data: { presets: [DATADOG] } } as never);
  vi.mocked(aiToolsets.discover).mockRejectedValue({ response: { status: 503 } });
});

afterEach(() => {
  unmount();
  vi.clearAllMocks();
});

describe("AssistantToolsetForm drafts", () => {
  it("never writes a header value, the client secret or a URL carrying a token to storage", async () => {
    const { w } = await mountForm({ action: "add", preset: "datadog" });
    await fillField("ai-toolset-header-0-input", "dd-s3cr3t");
    await fillField("ai-toolset-mcp-url", "https://mcp.example/api/mcp?api_key=k3y");
    await fillField("ai-toolset-client-id", "client-1");
    await fillField("ai-toolset-client-secret", "oauth-s3cr3t");
    await fillField("ai-toolset-description-input", "Kept in the draft");
    window.dispatchEvent(new Event("pagehide"));

    const stored = localStorage.getItem(editorDraftKey(newScope)) ?? "";
    expect(stored).toContain("Kept in the draft");
    expect(stored).toContain("DD-API-KEY");
    expect(stored).toContain("client-1");
    for (const secret of ["dd-s3cr3t", "oauth-s3cr3t", "k3y"]) expect(stored).not.toContain(secret);
    expect(w.exists()).toBe(true);

    unmount();
    await mountForm({ action: "add" });
    const note = byTest("editor-draft-credentials-not-saved")?.textContent ?? "";
    expect(note).toContain("DD-API-KEY header");
    expect(note).toContain("Client secret");
    expect(note).toContain("Endpoint URL");
  });

  it("continues a new toolset's draft on its own type, and names that type in the URL", async () => {
    await mountForm({ action: "add", preset: "datadog" });
    await fillField("ai-toolset-description-input", "From the draft");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft<{ description: string }>(newScope)?.data.description).toBe(
      "From the draft",
    );

    unmount();
    const { w, router } = await mountForm({ action: "add" });
    expect(w.find('[data-test="ai-toolset-type-step"]').exists()).toBe(true);
    click("editor-draft-continue");
    await settle();
    expect(w.find('[data-test="ai-toolset-type-step"]').exists()).toBe(false);
    expect(
      (w.find('[data-test="ai-toolset-description-input"] textarea').element as HTMLTextAreaElement)
        .value,
    ).toBe("From the draft");
    expect(
      (w.find('[data-test="ai-toolset-mcp-url"] input').element as HTMLInputElement).value,
    ).toBe("https://mcp.datadoghq.com/api/mcp");
    expect(router.currentRoute.value.query.preset).toBe("datadog");
  });

  it("asks again for a secret the draft could not keep, and keeps a saved toolset's name", async () => {
    vi.mocked(aiToolsets.get).mockResolvedValue({ data: STORED } as never);
    const props = { mode: "edit", editId: "ts_1" };
    const { w } = await mountForm({ action: "edit", id: "ts_1" }, props);
    await w.find('[data-test="ai-toolset-header-0-replace"]').trigger("click");
    await settle();
    await fillField("ai-toolset-header-0-input", "Bearer new-s3cr3t");
    window.dispatchEvent(new Event("pagehide"));
    const scope = { ...newScope, entityId: "ts_1" };
    expect(localStorage.getItem(editorDraftKey(scope)) ?? "").not.toContain("new-s3cr3t");

    unmount();
    const again = await mountForm({ action: "edit", id: "ts_1" }, props);
    click("editor-draft-continue");
    await settle();
    const row = again.w.find('[data-test="ai-toolset-header-0"]');
    expect(row.attributes("data-state")).toBe("replacing");
    expect(again.w.text()).toContain("Re-enter this value");
    expect(
      (again.w.find('[data-test="ai-toolset-name-input"] input').element as HTMLInputElement).value,
    ).toBe("pagerduty");
  });

  it("drops the draft once the toolset is saved", async () => {
    vi.mocked(aiToolsets.create).mockResolvedValue({ data: {} } as never);
    const { w } = await mountForm({ action: "add", kind: "mcp" });
    await fillField("ai-toolset-name-input", "my-tool");
    await fillField("ai-toolset-mcp-url", "https://x.example/mcp");
    await w.find("form").trigger("submit");
    await settle();
    expect(aiToolsets.create).toHaveBeenCalledTimes(1);
    expect(w.emitted("done")).toHaveLength(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(newScope)).toBeNull();
  });
});

describe("AssistantToolsetForm type step in the URL", () => {
  it("moves between the type step and the form with Back and Forward", async () => {
    const { w, router } = await mountForm({ action: "add" });
    await w.find('[data-test="ai-toolsets-add-datadog"]').trigger("click");
    await w.find('[data-test="ai-toolset-continue-btn"]').trigger("click");
    await settle();
    expect(router.currentRoute.value.query).toMatchObject({ action: "add", preset: "datadog" });
    expect(w.find('[data-test="ai-toolset-type-step"]').exists()).toBe(false);

    router.back();
    await settle();
    expect(router.currentRoute.value.query.preset).toBeUndefined();
    expect(w.find('[data-test="ai-toolset-type-step"]').exists()).toBe(true);

    router.forward();
    await settle();
    expect(w.find('[data-test="ai-toolset-type-step"]').exists()).toBe(false);
    expect(
      (w.find('[data-test="ai-toolset-mcp-url"] input').element as HTMLInputElement).value,
    ).toBe("https://mcp.datadoghq.com/api/mcp");
  });

  it("goes back to the type step through the URL, and on to a skill with ?kind=skill", async () => {
    const { w, router } = await mountForm({ action: "add", kind: "mcp" });
    expect(w.find('[data-test="ai-toolset-mcp-url"]').exists()).toBe(true);
    await w.find('[data-test="ai-toolset-step-back-btn"]').trigger("click");
    await settle();
    expect(router.currentRoute.value.query).toEqual({ action: "add" });
    expect(w.find('[data-test="ai-toolset-type-step"]').exists()).toBe(true);
    await w.find('[data-test="ai-toolsets-add-skill"]').trigger("click");
    await w.find('[data-test="ai-toolset-continue-btn"]').trigger("click");
    await settle();
    expect(router.currentRoute.value.query).toMatchObject({ kind: "skill" });
    expect(w.find('[data-test="ai-toolset-skill-template"]').exists()).toBe(true);
  });
});
