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
import { h, nextTick } from "vue";
import { createStore } from "vuex";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import OForm from "@/lib/forms/Form/OForm.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import onlineEvalsService, { type EvalJob, type Scorer } from "@/services/online-evals.service";
import { queryClient } from "@/composables/query/queryClient";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  hashDraftValue,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { fillField } from "@/test/unit/helpers/fillField";
import { byTest, click, clickLeave, clickRestore, pressEscape } from "@/test/unit/helpers/draftDom";
import OnlineEvals from "./OnlineEvals.vue";
import EvalJobList from "./onlineEvals/EvalJobList.vue";

vi.mock("@/services/online-evals.service", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      providers: { list: vi.fn() },
      scoreConfigs: { list: vi.fn(), versions: vi.fn() },
      scorers: { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      jobs: { list: vi.fn(), create: vi.fn(), update: vi.fn(), activate: vi.fn(), delete: vi.fn() },
    },
  });
});
vi.mock("@/services/gen-ai-agent-mapping.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/gen-ai-agent-mapping.service")>();
  return {
    ...actual,
    default: { ...actual.default, listAgents: vi.fn().mockResolvedValue({ agents: [] }) },
  };
});
const { streamsList } = vi.hoisted(() => ({
  streamsList: {
    current: (): Promise<unknown> => Promise.resolve({ list: [{ name: "default" }] }),
  },
}));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn(() => streamsList.current()),
    getStream: vi.fn().mockResolvedValue({ schema: [{ name: "name", type: "Utf8" }] }),
  }),
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

interface FormApi {
  setFieldValue: (field: string, value: unknown) => void;
  handleSubmit: () => Promise<void>;
  state: { values: Record<string, unknown> };
}

interface JobDraftData {
  values: Record<string, unknown>;
}

interface ScorerDraftData {
  values: Record<string, unknown> & { customHeaders: { key: string; value: string }[] };
}

const scope = (
  kind: "eval_job" | "eval_scorer",
  entityId: string | null,
  variant?: string,
): EditorDraftScope => ({ kind, org: "acme", entityId, userEmail: "me@x.io", variant });

const job: EvalJob = {
  id: "job-1",
  name: "Span quality",
  description: "",
  stream: "default",
  targetScope: "span",
  filterCondition: { type: "all" },
  scorers: [{ id: "s1", version: null }],
  samplingMode: "rate",
  samplingValue: 0.1,
  status: "active",
  version: 1,
  createdAt: 1,
  updatedAt: 2,
} as EvalJob;

const scorer: Scorer = {
  id: "s1",
  entityId: "s1",
  name: "Correctness",
  version: 1,
  scorerType: "llm_judge",
  description: "",
  template: "Judge {{ input }}",
  params: { provider_id: "p1" },
} as Scorer;

const store = createStore({
  state: {
    theme: "light",
    selectedOrganization: { identifier: "acme" },
    userInfo: { email: "me@x.io" },
    timezone: "UTC",
    zoConfig: {},
  },
});

const Blank = { render: () => h("div") };
let router: Router;
let wrapper: VueWrapper | null = null;

const mountAt = async (query: string) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/ai/evaluations",
        name: "aiEvaluations",
        component: OnlineEvals,
        props: { hideTabBar: true },
      },
      { path: "/logs", name: "logs", component: Blank },
      { path: "/settings/llm", name: "llmProviders", component: Blank },
    ],
  });
  await router.push(`/ai/evaluations?${query}`);
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: {
        plugins: [router, store, i18n],
        stubs: {
          QualityPage: true,
          DateTimePickerDashboard: true,
          AgentScopeCascade: true,
          JobScorerPicker: true,
          JobFilterBuilder: true,
          JobInputMapping: true,
          JobPreviewPanel: true,
          ScorerTestPanel: true,
        },
      },
    },
  );
  await flushPromises();
};

const remount = async (query: string) => {
  wrapper?.unmount();
  wrapper = null;
  await mountAt(query);
};

const form = () => (wrapper!.findComponent(OForm).vm as unknown as { form: FormApi }).form;

const edit = async (field: string, value: unknown) => {
  window.dispatchEvent(new Event("pointerdown"));
  form().setFieldValue(field, value);
  await nextTick();
};

describe("OnlineEvals editor drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    streamsList.current = () => Promise.resolve({ list: [{ name: "default" }] });
    vi.clearAllMocks();
    vi.mocked(onlineEvalsService.providers.list).mockResolvedValue([
      { id: "p1", name: "OpenAI" },
    ] as never);
    vi.mocked(onlineEvalsService.scoreConfigs.list).mockResolvedValue([]);
    vi.mocked(onlineEvalsService.scorers.list).mockResolvedValue([scorer]);
    vi.mocked(onlineEvalsService.jobs.list).mockResolvedValue([job]);
    vi.mocked(onlineEvalsService.jobs.update).mockResolvedValue({} as never);
    vi.mocked(onlineEvalsService.jobs.create).mockResolvedValue({ id: "job-9" } as never);
    vi.mocked(onlineEvalsService.scorers.update).mockResolvedValue({} as never);
    vi.mocked(onlineEvalsService.scorers.create).mockResolvedValue({} as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  describe("evaluation jobs", () => {
    it("drafts a new job filled with no key or pointer event, and a tab switch asks", async () => {
      await mountAt("tab=jobs&action=add");
      await fillField("job-form-name-input", "nightly");
      window.dispatchEvent(new Event("pagehide"));
      expect(readEditorDraft<JobDraftData>(scope("eval_job", null))?.data.values.name).toBe(
        "nightly",
      );

      const navigation = router.push("/ai/evaluations?tab=scorers");
      await flushPromises();
      expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
      clickLeave("o-dialog-close-btn");
      await navigation;
      expect(router.currentRoute.value.query).toMatchObject({ tab: "jobs", action: "add" });
      expect(byTest("job-form-title")).not.toBeNull();
    });

    it("continues a new job's draft under the local-changes title", async () => {
      await mountAt("tab=jobs&action=add");
      await edit("name", "nightly");
      await edit("samplingValue", "0.5");
      window.dispatchEvent(new Event("pagehide"));
      await remount("tab=jobs&action=add");

      expect(byTest("editor-draft-restore-dialog")?.textContent).toContain("Unsaved local changes");
      expect(byTest("editor-draft-restore-message")?.textContent).toContain("evaluation job");
      click("editor-draft-continue");
      await flushPromises();
      expect(form().state.values).toMatchObject({ name: "nightly", samplingValue: "0.5" });
    });

    it("a continued new job's draft brings back its stream even when the stream list arrives later", async () => {
      await mountAt("tab=jobs&action=add");
      await edit("name", "nightly");
      await edit("stream", "default");
      window.dispatchEvent(new Event("pagehide"));
      expect(readEditorDraft<JobDraftData>(scope("eval_job", null))?.data.values.stream).toBe(
        "default",
      );
      let streamsArrive: (value: unknown) => void = () => {};
      streamsList.current = () => new Promise((resolve) => (streamsArrive = resolve));
      await remount("tab=jobs&action=add");
      click("editor-draft-continue");
      await flushPromises();
      streamsArrive({ list: [{ name: "default" }, { name: "agents" }] });
      await flushPromises();

      expect(form().state.values).toMatchObject({ name: "nightly", stream: "default" });
      expect(byTest("job-form-stream-select")?.textContent).toContain("default");
    });

    it("start fresh drops the draft; escape keeps it", async () => {
      writeEditorDraft(scope("eval_job", null), {
        data: { values: { name: "old" }, endSignalGroup: null },
      });
      await mountAt("tab=jobs&action=add");
      pressEscape();
      await flushPromises();
      expect(byTest("editor-draft-restore-dialog")).toBeNull();
      expect(form().state.values.name).toBe("");
      expect(readEditorDraft(scope("eval_job", null))).not.toBeNull();

      await remount("tab=jobs&action=add");
      clickRestore("o-dialog-secondary-btn");
      await flushPromises();
      expect(form().state.values.name).toBe("");
      expect(readEditorDraft(scope("eval_job", null))).toBeNull();
    });

    it("a continued trace job keeps its own completion window and span selectors", async () => {
      writeEditorDraft(scope("eval_job", null), {
        data: {
          values: {
            name: "traces",
            description: "",
            stream: "default",
            streamType: "traces",
            targetScope: "trace",
            idleWindowSecs: 77,
            maxAgeSecs: 777,
            scorerIds: [],
            samplingMode: "all",
            samplingValue: "",
            filterGroup: { filterType: "group", logicalOperator: "AND", conditions: [] },
          },
          endSignalGroup: { filterType: "group", logicalOperator: "AND", conditions: [] },
          inputMappings: {},
          spanSelectors: [
            {
              id: "sel-1",
              name: "tool spans",
              filterCondition: {},
              fieldMode: "default",
              fields: [],
              maximumSpans: 3,
            },
          ],
          spanSelectorBindings: {},
          scorerVersions: {},
        },
      });
      await mountAt("tab=jobs&action=add");
      click("editor-draft-continue");
      await flushPromises();

      expect(form().state.values).toMatchObject({
        targetScope: "trace",
        idleWindowSecs: 77,
        maxAgeSecs: 777,
      });
      window.dispatchEvent(new Event("pagehide"));
      const stored = readEditorDraft<{ spanSelectors: { name: string }[] }>(
        scope("eval_job", null),
      );
      expect(stored?.data.spanSelectors.map((selector) => selector.name)).toEqual(["tool spans"]);
    });

    it("edit mode keys the draft by job id and hashes only what the form edits", async () => {
      await mountAt("tab=jobs&action=update&id=job-1");
      await fillField("job-form-description-input", "edited");
      window.dispatchEvent(new Event("pagehide"));
      const draft = readEditorDraft<JobDraftData>(scope("eval_job", "job-1"));
      expect(draft?.data.values.description).toBe("edited");
      const {
        status: _status,
        version: _version,
        createdAt: _created,
        updatedAt: _updated,
        ...definition
      } = job;
      expect(draft?.baseHash).toBe(hashDraftValue(definition));

      vi.mocked(onlineEvalsService.jobs.list).mockResolvedValue([
        { ...job, status: "paused", updatedAt: 99, version: 2 },
      ]);
      queryClient.clear();
      await remount("tab=jobs&action=update&id=job-1");
      expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
      expect(byTest("editor-draft-changed-on-server")).toBeNull();

      vi.mocked(onlineEvalsService.jobs.list).mockResolvedValue([{ ...job, stream: "other" }]);
      queryClient.clear();
      await remount("tab=jobs&action=update&id=job-1");
      expect(byTest("editor-draft-changed-on-server")).not.toBeNull();
    });

    it("save from the leave dialog updates the job, reloads the list and goes on", async () => {
      await mountAt("tab=jobs&action=update&id=job-1");
      await edit("description", "edited");
      const listCalls = vi.mocked(onlineEvalsService.jobs.list).mock.calls.length;

      const navigation = router.push("/logs");
      await flushPromises();
      clickLeave("editor-draft-leave-save");
      await navigation;
      await flushPromises();

      expect(onlineEvalsService.jobs.update).toHaveBeenCalledWith(
        "acme",
        "job-1",
        expect.objectContaining({ description: "edited" }),
      );
      expect(vi.mocked(onlineEvalsService.jobs.list).mock.calls.length).toBeGreaterThan(listCalls);
      expect(router.currentRoute.value.name).toBe("logs");
      expect(readEditorDraft(scope("eval_job", "job-1"))).toBeNull();
    });

    it("keep draft leaves and keeps the work", async () => {
      await mountAt("tab=jobs&action=update&id=job-1");
      await edit("description", "kept");
      const navigation = router.push("/logs");
      await flushPromises();
      clickLeave("o-dialog-secondary-btn");
      await navigation;

      expect(router.currentRoute.value.name).toBe("logs");
      expect(
        readEditorDraft<JobDraftData>(scope("eval_job", "job-1"))?.data.values.description,
      ).toBe("kept");
    });

    it("cancel asks, and discard closes the form and drops the draft", async () => {
      await mountAt("tab=jobs&action=update&id=job-1");
      await edit("description", "gone");
      window.dispatchEvent(new Event("pagehide"));

      click("job-form-cancel-btn");
      await flushPromises();
      expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
      clickLeave("o-dialog-neutral-btn");
      await flushPromises();

      expect(router.currentRoute.value.query.action).toBeUndefined();
      expect(byTest("job-form-title")).toBeNull();
      expect(byTest("editor-draft-leave-dialog")).toBeNull();
      expect(readEditorDraft(scope("eval_job", "job-1"))).toBeNull();
    });

    it("a normal save drops the draft and closes the form without asking", async () => {
      await mountAt("tab=jobs&action=update&id=job-1");
      await edit("description", "saved");
      window.dispatchEvent(new Event("pagehide"));

      await form().handleSubmit();
      await flushPromises();
      expect(onlineEvalsService.jobs.update).toHaveBeenCalledTimes(1);
      expect(router.currentRoute.value.query.action).toBeUndefined();
      expect(byTest("editor-draft-leave-dialog")).toBeNull();
      expect(readEditorDraft(scope("eval_job", "job-1"))).toBeNull();
    });

    it("dots New job and the job's row for this user's drafts", async () => {
      writeEditorDraft(scope("eval_job", null), { data: { values: { name: "new" } } });
      writeEditorDraft(scope("eval_job", "job-1"), { data: { values: { name: "Span quality" } } });
      await mountAt("tab=jobs");

      expect(byTest("eval-job-list-add-draft-dot")).not.toBeNull();
      expect(byTest("eval-job-list-add-btn")?.getAttribute("aria-label")).toBe(
        "New job · unsaved draft",
      );
      // The table renders its rows a tick after the list arrives.
      await vi.waitFor(() => expect(byTest("eval-job-list-job-1-draft-dot")).not.toBeNull());
    });

    it("deleting a job drops its draft; a bulk delete drops only the deleted ones", async () => {
      vi.mocked(onlineEvalsService.jobs.list).mockResolvedValue([
        job,
        { ...job, id: "job-2", name: "second" },
        { ...job, id: "job-3", name: "third" },
      ]);
      for (const id of ["job-1", "job-2", "job-3"]) {
        writeEditorDraft(scope("eval_job", id), { data: { values: {} } });
      }
      vi.mocked(onlineEvalsService.jobs.delete).mockImplementation(((_org: string, id: string) =>
        id === "job-3" ? Promise.reject(new Error("locked")) : Promise.resolve()) as never);
      await mountAt("tab=jobs");
      const list = wrapper!.findComponent(EvalJobList);
      const confirmDialog = wrapper!.findComponent(ConfirmDialog);

      list.vm.$emit("delete", job);
      await flushPromises();
      confirmDialog.vm.$emit("update:ok");
      await flushPromises();
      expect(readEditorDraft(scope("eval_job", "job-1"))).toBeNull();

      list.vm.$emit("delete-bulk", ["job-2", "job-3"]);
      await flushPromises();
      confirmDialog.vm.$emit("update:ok");
      await flushPromises();
      expect(readEditorDraft(scope("eval_job", "job-2"))).toBeNull();
      expect(readEditorDraft(scope("eval_job", "job-3"))).not.toBeNull();
    });

    it("opening the draft of a deleted job drops it with an info toast", async () => {
      writeEditorDraft(scope("eval_job", "job-gone"), { data: { values: {} } });
      await mountAt("tab=jobs&action=update&id=job-gone");

      expect(readEditorDraft(scope("eval_job", "job-gone"))).toBeNull();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "info",
          message: "This evaluation job no longer exists, so its unsaved draft was discarded.",
        }),
      );
    });

    it("keeps the draft when the job list failed to load", async () => {
      writeEditorDraft(scope("eval_job", "job-1"), { data: { values: {} } });
      vi.mocked(onlineEvalsService.jobs.list).mockRejectedValue(new Error("offline"));
      await mountAt("tab=jobs&action=update&id=job-1");
      expect(readEditorDraft(scope("eval_job", "job-1"))).not.toBeNull();
    });

    it("a job missing only from the cached list is re-read, kept and opened", async () => {
      await mountAt("tab=jobs");
      vi.mocked(onlineEvalsService.jobs.list).mockResolvedValue([
        job,
        { ...job, id: "job-new", name: "made in another tab" },
      ]);
      writeEditorDraft(scope("eval_job", "job-new"), {
        data: { values: { name: "made in another tab" } },
      });

      await router.push("/ai/evaluations?tab=jobs&action=update&id=job-new");
      await flushPromises();

      expect(readEditorDraft(scope("eval_job", "job-new"))).not.toBeNull();
      expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "info" }));
      expect(byTest("job-form-title")).not.toBeNull();
      expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
    });
  });

  describe("scorers", () => {
    it("keeps a new scorer's draft per type and dots New scorer", async () => {
      await mountAt("tab=scorers&action=add&scorer_type=llm_judge");
      await fillField("scorer-form-name-input", "judge");
      window.dispatchEvent(new Event("pagehide"));
      expect(
        readEditorDraft<ScorerDraftData>(scope("eval_scorer", null, "llm_judge"))?.data.values.name,
      ).toBe("judge");
      expect(readEditorDraft(scope("eval_scorer", null, "remote"))).toBeNull();

      const navigation = router.push("/ai/evaluations?tab=scorers");
      await flushPromises();
      clickLeave("o-dialog-secondary-btn");
      await navigation;
      await flushPromises();
      expect(byTest("scorers-list-add-draft-dot")).not.toBeNull();
      expect(byTest("scorers-list-add-btn")?.getAttribute("aria-label")).toBe(
        "New scorer · unsaved draft",
      );

      await router.push("/ai/evaluations?tab=scorers&action=add&scorer_type=remote");
      await flushPromises();
      expect(byTest("editor-draft-restore-dialog")).toBeNull();
    });

    it("never stores a remote scorer's token or any custom header value, but keeps the API-key header name", async () => {
      await mountAt("tab=scorers&action=add&scorer_type=remote");
      await edit("name", "remote judge");
      await edit("authType", "api_key");
      await edit("authApiKeyToken", "tok-123");
      await edit("authApiKeyHeaderName", "X-Judge-Key");
      await edit("customHeaders", [
        { key: "X-Api-Key", value: "hdr-secret" },
        { key: "X-Auth", value: "plain-cred" },
      ]);
      window.dispatchEvent(new Event("pagehide"));

      const stored = JSON.stringify(localStorage);
      expect(stored).not.toContain("tok-123");
      expect(stored).not.toContain("hdr-secret");
      const draft = readEditorDraft<ScorerDraftData>(scope("eval_scorer", null, "remote"));
      expect(draft?.data.values.authApiKeyHeaderName).toBe("X-Judge-Key");
      expect(stored).not.toContain("plain-cred");
      expect(draft?.data.values.customHeaders.map((header) => header.key)).toEqual([
        "X-Api-Key",
        "X-Auth",
      ]);
    });

    it("a changed secret header comes back blank, is named, and blocks Save until retyped", async () => {
      await mountAt("tab=scorers&action=add&scorer_type=remote");
      await edit("name", "remote judge");
      await edit("remoteEndpoint", "https://judge.example.com");
      await edit("customHeaders", [{ key: "X-Api-Key", value: "hdr-secret" }]);
      window.dispatchEvent(new Event("pagehide"));
      await remount("tab=scorers&action=add&scorer_type=remote");

      expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain(
        "X-Api-Key header",
      );
      click("editor-draft-continue");
      await flushPromises();

      await form().handleSubmit();
      await flushPromises();
      expect(onlineEvalsService.scorers.create).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Re-enter the changes that were not kept in the draft before saving.",
        }),
      );

      await edit("customHeaders", [{ key: "X-Api-Key", value: "hdr-new" }]);
      await form().handleSubmit();
      await flushPromises();
      expect(onlineEvalsService.scorers.create).toHaveBeenCalledTimes(1);
    });

    it("never stores a remote endpoint that carries a token, names it, and blocks Save until retyped", async () => {
      await mountAt("tab=scorers&action=add&scorer_type=remote");
      await edit("name", "remote judge");
      await edit("remoteEndpoint", "https://judge.example.com/score?token=s3cr3t");
      window.dispatchEvent(new Event("pagehide"));
      expect(JSON.stringify(localStorage)).not.toContain("s3cr3t");
      await remount("tab=scorers&action=add&scorer_type=remote");

      expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain(
        "Your change to the URL was not kept.",
      );
      click("editor-draft-continue");
      await flushPromises();
      expect(form().state.values.remoteEndpoint).toBe("");

      await edit("remoteEndpoint", "https://judge.example.com/score");
      await form().handleSubmit();
      await flushPromises();
      expect(onlineEvalsService.scorers.create).toHaveBeenCalledTimes(1);
    });

    it("switching a remote scorer's auth to none releases a token that was not kept", async () => {
      await mountAt("tab=scorers&action=add&scorer_type=remote");
      await edit("name", "remote judge");
      await edit("remoteEndpoint", "https://judge.example.com");
      await edit("authType", "bearer");
      await edit("authBearerToken", "tok-123");
      window.dispatchEvent(new Event("pagehide"));
      await remount("tab=scorers&action=add&scorer_type=remote");
      click("editor-draft-continue");
      await flushPromises();
      expect(form().state.values.authBearerToken).toBe("");

      await edit("authType", "");
      await form().handleSubmit();
      await flushPromises();
      expect(onlineEvalsService.scorers.create).toHaveBeenCalledTimes(1);
    });

    it("start fresh drops a scorer's draft; escape keeps it", async () => {
      writeEditorDraft(scope("eval_scorer", null, "llm_judge"), {
        data: { values: { name: "old judge" } },
      });
      await mountAt("tab=scorers&action=add&scorer_type=llm_judge");
      pressEscape();
      await flushPromises();
      expect(byTest("editor-draft-restore-dialog")).toBeNull();
      expect(form().state.values.name).toBe("");
      expect(readEditorDraft(scope("eval_scorer", null, "llm_judge"))).not.toBeNull();

      await remount("tab=scorers&action=add&scorer_type=llm_judge");
      clickRestore("o-dialog-secondary-btn");
      await flushPromises();
      expect(form().state.values.name).toBe("");
      expect(readEditorDraft(scope("eval_scorer", null, "llm_judge"))).toBeNull();
    });

    it("cancel asks, and discard closes the scorer form and drops the draft", async () => {
      await mountAt("tab=scorers&action=update&id=s1");
      await edit("description", "gone");
      window.dispatchEvent(new Event("pagehide"));
      expect(readEditorDraft(scope("eval_scorer", "s1"))).not.toBeNull();

      click("scorer-form-cancel-btn");
      await flushPromises();
      expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
      clickLeave("o-dialog-neutral-btn");
      await flushPromises();

      expect(router.currentRoute.value.query.action).toBeUndefined();
      expect(byTest("scorer-form-title")).toBeNull();
      expect(byTest("editor-draft-leave-dialog")).toBeNull();
      expect(readEditorDraft(scope("eval_scorer", "s1"))).toBeNull();
    });

    it("save from the leave dialog updates the scorer and goes on", async () => {
      await mountAt("tab=scorers&action=update&id=s1");
      await edit("description", "sharper");

      const navigation = router.push("/logs");
      await flushPromises();
      clickLeave("editor-draft-leave-save");
      await navigation;
      await flushPromises();

      expect(onlineEvalsService.scorers.update).toHaveBeenCalledWith(
        "acme",
        "s1",
        expect.objectContaining({ description: "sharper" }),
      );
      expect(router.currentRoute.value.name).toBe("logs");
      expect(readEditorDraft(scope("eval_scorer", "s1"))).toBeNull();
    });

    it("dots a scorer's row, drops it on delete, and drops a deleted scorer's draft on open", async () => {
      writeEditorDraft(scope("eval_scorer", "s1"), { data: { values: {} } });
      writeEditorDraft(scope("eval_scorer", "s-gone"), {
        data: { values: {} },
      });
      vi.mocked(onlineEvalsService.scorers.delete).mockResolvedValue(undefined as never);
      await mountAt("tab=scorers");
      // The table renders its rows a tick after the list arrives.
      await vi.waitFor(() => expect(byTest("scorer-list-s1-draft-dot")).not.toBeNull());

      wrapper!.findComponent({ name: "ScorerList" }).vm.$emit("delete", scorer);
      await flushPromises();
      wrapper!.findComponent(ConfirmDialog).vm.$emit("update:ok");
      await flushPromises();
      expect(readEditorDraft(scope("eval_scorer", "s1"))).toBeNull();

      await router.push("/ai/evaluations?tab=scorers&action=update&id=s-gone");
      await flushPromises();
      expect(readEditorDraft(scope("eval_scorer", "s-gone"))).toBeNull();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "info",
          message: "This scorer no longer exists, so its unsaved draft was discarded.",
        }),
      );
    });
  });
});
