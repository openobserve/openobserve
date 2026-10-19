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
import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import type { AnnotationConditionGroup, AnnotationSource } from "@/ts/interfaces/dashboard";

/** A root condition group (the alerts condition-tree shape FilterGroup.vue edits). */
const filterGroup = (
  conditions: AnnotationConditionGroup["conditions"] = [],
): AnnotationConditionGroup => ({ filterType: "group", logicalOperator: "AND", conditions });

const filterLeaf = (
  column: string,
  operator: string,
  value: string,
  logicalOperator: "AND" | "OR" = "AND",
) => ({ filterType: "condition" as const, column, operator, value, logicalOperator });

vi.mock("@/utils/commons", () => ({
  getDashboard: vi.fn(),
  updateDashboard: vi.fn(),
}));

vi.mock("@/services/search", () => ({
  default: { search: vi.fn() },
}));

// Defaults to the real implementation; one test below overrides it to simulate a slow-loading variable.
vi.mock("@/composables/dashboard/useDashboardAnnotationSources", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/composables/dashboard/useDashboardAnnotationSources")>();
  return { ...actual, runAnnotationSourceQuery: vi.fn(actual.runAnnotationSourceQuery) };
});

const streamsApi = vi.hoisted(() => ({
  getStreams: vi.fn(),
  getStream: vi.fn(),
}));
vi.mock("@/composables/useStreams", () => ({
  default: () => streamsApi,
}));

const notifications = {
  showPositiveNotification: vi.fn(),
  showErrorNotification: vi.fn(),
  showConfictErrorNotificationWithRefreshBtn: vi.fn(),
};
vi.mock("@/composables/useNotifications", () => ({
  default: () => notifications,
}));

// Monaco does not run under jsdom; the stub keeps the query/update contract the form relies on.
vi.mock("@/components/QueryEditor.vue", () => ({
  default: {
    name: "QueryEditor",
    props: ["query"],
    emits: ["update:query", "run-query"],
    template: '<textarea data-test="query-editor-stub" :value="query" />',
  },
}));

import AnnotationSettings from "./AnnotationSettings.vue";
import AnnotationSourceForm from "./AnnotationSourceForm.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import searchService from "@/services/search";
import { getDashboard, updateDashboard } from "@/utils/commons";
import { MAX_ANNOTATION_SOURCES } from "@/utils/dashboard/annotationSources";
import {
  ANNOTATION_PREVIEW_CONTEXT_KEY,
  runAnnotationSourceQuery,
  type AnnotationQueryVariable,
} from "@/composables/dashboard/useDashboardAnnotationSources";

const deploys: AnnotationSource = {
  id: "deploys",
  name: "Deploys",
  color: "#34d399",
  enabled: true,
  mode: "builder",
  streamType: "logs",
  stream: "k8s_events",
  filters: filterGroup([filterLeaf("event", "=", "deploy")]),
  title: "{service}",
};

const calendarEvents: AnnotationSource = {
  id: "calendar",
  name: "Calendar",
  color: "#34d399",
  enabled: true,
  mode: "builder",
  streamType: "logs",
  stream: "pt_change_calendar",
  filters: filterGroup(),
  title: "{title}",
  endTimeField: "end_ts",
};

const dashboardWith = (annotationSources?: AnnotationSource[]) => ({
  dashboardId: "d1",
  title: "Checkout",
  tabs: [
    {
      tabId: "t1",
      name: "Default",
      panels: [
        { id: "p1", type: "line", title: "Latency" },
        { id: "p2", type: "table", title: "Rows" },
      ],
    },
  ],
  variables: { list: [{ name: "env", scope: "global" }] },
  ...(annotationSources ? { annotationSources } : {}),
});

describe("AnnotationSettings", () => {
  let wrapper: VueWrapper | null = null;

  const mountSettings = async (committedVariables: AnnotationQueryVariable[] = []) => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }],
    });
    await router.push({ path: "/", query: { dashboard: "d1", folder: "default" } });
    await router.isReady();
    wrapper = mount(AnnotationSettings, {
      attachTo: document.body,
      global: {
        plugins: [i18n, store, router],
        provide: {
          [ANNOTATION_PREVIEW_CONTEXT_KEY as symbol]: {
            timeRange: () => undefined,
            variables: () => committedVariables,
          },
        },
      },
    });
    await flushPromises();
    return wrapper;
  };

  // Strips FilterGroup's fresh client-only ids so a saved tree can match a literal fixture.
  const stripTreeIds = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    const { id: _id, groupId: _groupId, ...rest } = node as Record<string, unknown>;
    if (Array.isArray(rest.conditions)) rest.conditions = rest.conditions.map(stripTreeIds);
    return rest;
  };

  const lastSavedSources = () => {
    const sources = vi.mocked(updateDashboard).mock.calls.at(-1)?.[3]?.annotationSources as
      AnnotationSource[] | undefined;
    return sources?.map((source) => ({ ...source, filters: stripTreeIds(source.filters) }));
  };

  const form = () => wrapper!.findComponent(AnnotationSourceForm);
  const typeInto = async (dataTest: string, value: string) => {
    const field = wrapper!.find(`[data-test="${dataTest}"]`);
    const input = field.element.tagName === "INPUT" ? field : field.find("input");
    await input.setValue(value);
  };
  const submit = async () => {
    await wrapper!.find('[data-test="dashboard-annotation-source-save"]').trigger("click");
    await flushPromises();
    await flushPromises();
  };
  const switchMode = async (mode: "builder" | "sql") => {
    form()
      .findComponent<typeof OToggleGroup>('[data-test="dashboard-annotation-source-mode"]')
      .vm.$emit("update:modelValue", mode);
    await flushPromises();
  };

  beforeEach(() => {
    streamsApi.getStreams
      .mockReset()
      .mockResolvedValue({ list: [{ name: "k8s_events" }, { name: "app" }] });
    streamsApi.getStream.mockReset().mockImplementation(async (name: string) => ({
      schema:
        name === "pt_change_calendar"
          ? [{ name: "_timestamp" }, { name: "title" }, { name: "end_ts" }]
          : [{ name: "service" }, { name: "event" }, { name: "author" }],
    }));
    vi.mocked(getDashboard).mockReset();
    vi.mocked(updateDashboard)
      .mockReset()
      .mockResolvedValue({} as never);
    vi.mocked(searchService.search).mockReset();
    vi.mocked(runAnnotationSourceQuery).mockClear();
    Object.values(notifications).forEach((fn) => fn.mockReset());
    store.state.selectedOrganization = {
      identifier: "org1",
      label: "Org",
      id: 1,
      user_email: "a@b.c",
      subscription_type: "free",
    };
    store.state.timezone = "UTC";
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("shows the empty state and opens the add form from it", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith());
    await mountSettings();

    expect(wrapper!.find('[data-test="dashboard-annotation-sources-empty"]').exists()).toBe(true);
    await wrapper!.find('[data-test="dashboard-annotation-source-add"]').trigger("click");
    expect(form().exists()).toBe(true);
    expect(form().props("panelOptions")).toEqual([{ label: "Latency", value: "p1" }]);
  });

  it("disables Add source at the cap, with a tooltip explaining why", async () => {
    const atCap = Array.from({ length: MAX_ANNOTATION_SOURCES }, (_, i) => ({
      ...deploys,
      id: `s${i}`,
      name: `Source ${i}`,
    }));
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith(atCap));
    await mountSettings();

    const addButton = wrapper!.find('[data-test="dashboard-annotation-source-add"]');
    expect(addButton.attributes("aria-disabled")).toBe("true");

    await addButton.trigger("click");
    expect(form().exists()).toBe(false);
  });

  it("re-checks the cap against the freshly fetched dashboard, rejecting a save that would exceed it", async () => {
    const atCap = Array.from({ length: MAX_ANNOTATION_SOURCES }, (_, i) => ({
      ...deploys,
      id: `other${i}`,
      name: `Other ${i}`,
    }));
    vi.mocked(getDashboard)
      .mockResolvedValueOnce(dashboardWith([deploys]))
      .mockResolvedValueOnce(dashboardWith(atCap));
    vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [] } } as never);
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    await submit();

    await vi.waitFor(() =>
      expect(notifications.showErrorNotification).toHaveBeenCalledWith(
        "A dashboard can have at most 10 annotation sources.",
        { timeout: 2000 },
      ),
    );
    expect(updateDashboard).not.toHaveBeenCalled();
  });

  it("lists a source with its mode and stream summary", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    await mountSettings();

    expect(wrapper!.find('[data-test="dashboard-annotation-source-name-deploys"]').text()).toBe(
      "Deploys",
    );
    expect(wrapper!.find('[data-test="dashboard-annotation-source-mode-deploys"]').text()).toBe(
      "Builder",
    );
    expect(wrapper!.text()).toContain("logs · k8s_events");
    expect(wrapper!.text()).toContain("All time-series panels");
  });

  it("shows an inline error and logs it when loading streams for a type fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    streamsApi.getStreams.mockReset().mockRejectedValue(new Error("boom"));
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith());
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-add"]').trigger("click");
    await flushPromises();

    expect(
      wrapper!.find('[data-test="dashboard-annotation-source-stream-load-error"]').exists(),
    ).toBe(true);
    expect(wrapper!.text()).toContain("Failed to load streams for this type.");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("shows an inline error when loading a stream's schema fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    streamsApi.getStream.mockReset().mockRejectedValue(new Error("boom"));
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    expect(
      wrapper!.find('[data-test="dashboard-annotation-source-stream-load-error"]').exists(),
    ).toBe(true);
    expect(wrapper!.text()).toContain("Failed to load this stream's fields.");
    consoleError.mockRestore();
  });

  it("does not save a new source without a name and title", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith());
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-add"]').trigger("click");
    await submit();

    expect(updateDashboard).not.toHaveBeenCalled();
    expect(wrapper!.text()).toContain("Name is required");
    expect(wrapper!.text()).toContain("Title is required");
  });

  it("does not save a new source with a name another source already uses, case-insensitively", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-add"]').trigger("click");
    await typeInto("dashboard-annotation-source-name", " deploys ");
    await typeInto("dashboard-annotation-source-title", "{service}");
    await submit();

    expect(updateDashboard).not.toHaveBeenCalled();
    expect(wrapper!.text()).toContain("Another source already uses this name");
  });

  it("allows renaming a source back to its own unchanged name while editing", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys, calendarEvents]));
    vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [] } } as never);
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    await typeInto("dashboard-annotation-source-name", "Deploys");
    await submit();
    await vi.waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1), { timeout: 3000 });

    expect(wrapper!.text()).not.toContain("Another source already uses this name");
    expect(lastSavedSources()?.find((source) => source.id === "deploys")?.name).toBe("Deploys");
  });

  it("saves an edited source with explicit keys through getDashboard → updateDashboard", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    await typeInto("dashboard-annotation-source-name", "Backend deploys");
    await submit();

    await vi.waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1));
    expect(notifications.showErrorNotification).not.toHaveBeenCalled();
    expect(lastSavedSources()).toEqual([
      {
        id: "deploys",
        name: "Backend deploys",
        color: "#34d399",
        enabled: true,
        mode: "builder",
        streamType: "logs",
        stream: "k8s_events",
        filters: filterGroup([filterLeaf("event", "=", "deploy")]),
        title: "{service}",
      },
    ]);
    expect(wrapper!.emitted("save")).toHaveLength(1);
    expect(form().exists()).toBe(false);
  });

  it("edits the color through the shared swatch picker and saves the new hex", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    await wrapper!
      .find('[data-test="dashboard-annotation-source-color-swatch-0"]')
      .trigger("click");
    await submit();

    await vi.waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1));
    expect(lastSavedSources()?.[0].color).toBe("#b91c1c");
  });

  it("hides the 'no color' swatch so a source always keeps a color", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    expect(wrapper!.find('[data-test="dashboard-annotation-source-color-none"]').exists()).toBe(
      false,
    );
  });

  it("pre-fills Custom SQL from the builder and switches back silently while unedited", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    await switchMode("sql");
    expect(
      (wrapper!.find('[data-test="query-editor-stub"]').element as HTMLTextAreaElement).value,
    ).toBe(
      `SELECT _timestamp, service\nFROM k8s_events\nWHERE event = 'deploy'\nORDER BY _timestamp DESC`,
    );

    await switchMode("builder");
    expect(wrapper!.find('[data-test="dashboard-annotation-source-discard-sql"]').exists()).toBe(
      false,
    );
    expect(wrapper!.find('[data-test="dashboard-annotation-source-stream"]').exists()).toBe(true);
  });

  it("includes the end-time field in the Custom SQL pre-fill", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([calendarEvents]));
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-calendar"]').trigger("click");
    await flushPromises();

    await switchMode("sql");
    expect(
      (wrapper!.find('[data-test="query-editor-stub"]').element as HTMLTextAreaElement).value,
    ).toBe(`SELECT _timestamp, title, end_ts\nFROM pt_change_calendar\nORDER BY _timestamp DESC`);
  });

  it("asks before discarding edited SQL when switching back to the builder", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    await switchMode("sql");
    form()
      .findComponent({ name: "QueryEditor" })
      .vm.$emit("update:query", "SELECT _timestamp, title FROM incidents");
    await flushPromises();
    await switchMode("builder");

    const confirm = wrapper!.find('[data-test="dashboard-annotation-source-discard-sql"]');
    expect(confirm.exists()).toBe(true);
    expect(wrapper!.find('[data-test="query-editor-stub"]').exists()).toBe(true);

    await wrapper!
      .find('[data-test="dashboard-annotation-source-discard-sql-confirm"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper!.find('[data-test="query-editor-stub"]').exists()).toBe(false);
  });

  it("previews the first rows and flags a placeholder the result lacks", async () => {
    vi.mocked(getDashboard).mockResolvedValue(
      dashboardWith([{ ...deploys, description: "by {who}" }]),
    );
    vi.mocked(searchService.search).mockResolvedValue({
      data: { hits: [{ _timestamp: 1_700_000_000_000_000, service: "checkout" }] },
    } as never);
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    await wrapper!.find('[data-test="dashboard-annotation-source-run"]').trigger("click");
    await flushPromises();

    expect(searchService.search).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchService.search).mock.calls[0][0].query.query.size).toBe(10);
    const preview = wrapper!.find('[data-test="dashboard-annotation-source-preview"]');
    expect(preview.text()).toContain("checkout");
    expect(preview.text()).toContain(
      "{who} is not in the query result, so that part of the marker is empty.",
    );
  });

  it("ignores a blank filter condition in the query, hints on it, and does not save it", async () => {
    vi.mocked(getDashboard).mockResolvedValue(
      dashboardWith([
        {
          ...deploys,
          filters: filterGroup([
            filterLeaf("event", "=", "deploy"),
            filterLeaf("service", "=", ""),
          ]),
        },
      ]),
    );
    vi.mocked(searchService.search).mockResolvedValue({
      data: { hits: [{ _timestamp: 1_700_000_000_000_000, service: "checkout" }] },
    } as never);
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    expect(
      wrapper!.find('[data-test="dashboard-annotation-source-filters-blank-hint"]').text(),
    ).toBe("Conditions with no value are ignored.");

    await wrapper!.find('[data-test="dashboard-annotation-source-run"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(searchService.search).mock.calls[0][0].query.query.sql).toBe(
      `SELECT _timestamp, service\nFROM k8s_events\nWHERE event = 'deploy'\nORDER BY _timestamp DESC`,
    );
    expect(wrapper!.text()).not.toContain("No rows in the current time range.");

    await submit();
    await vi.waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1));
    expect(lastSavedSources()?.[0].filters).toEqual(
      filterGroup([filterLeaf("event", "=", "deploy")]),
    );
  });

  it("supports AND/OR and nested condition groups, same as the alerts builder", async () => {
    vi.mocked(getDashboard).mockResolvedValue(
      dashboardWith([
        {
          ...deploys,
          filters: filterGroup([
            filterLeaf("event", "=", "deploy"),
            filterGroup([
              filterLeaf("namespace", "=", "backend", "OR"),
              filterLeaf("service", "=", "checkout", "OR"),
            ]),
          ]),
        },
      ]),
    );
    vi.mocked(searchService.search).mockResolvedValue({
      data: { hits: [{ _timestamp: 1_700_000_000_000_000, service: "checkout" }] },
    } as never);
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    await switchMode("sql");
    expect(
      (wrapper!.find('[data-test="query-editor-stub"]').element as HTMLTextAreaElement).value,
    ).toBe(
      `SELECT _timestamp, service\nFROM k8s_events\nWHERE event = 'deploy' AND (namespace = 'backend' OR service = 'checkout')\nORDER BY _timestamp DESC`,
    );
  });

  it("resets filters on a stream type change, since they were built against the old stream's columns", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [] } } as never);
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    form()
      .findComponent('[data-test="dashboard-annotation-source-stream-type"]')
      .vm.$emit("update:modelValue", "metrics");
    await flushPromises();
    form()
      .findComponent('[data-test="dashboard-annotation-source-stream"]')
      .vm.$emit("update:modelValue", "app");
    await flushPromises();
    await submit();
    await vi.waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1), { timeout: 3000 });

    expect(
      lastSavedSources()?.find((source) => source.id === "deploys")?.filters.conditions,
    ).toEqual([]);
  });

  it("resets filters on a direct stream change too", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [] } } as never);
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    form()
      .findComponent('[data-test="dashboard-annotation-source-stream"]')
      .vm.$emit("update:modelValue", "app");
    await flushPromises();
    await submit();
    await vi.waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1), { timeout: 3000 });

    expect(
      lastSavedSources()?.find((source) => source.id === "deploys")?.filters.conditions,
    ).toEqual([]);
  });

  it("lists each stream once even when the stream store holds it twice", async () => {
    streamsApi.getStreams.mockResolvedValue({
      list: [{ name: "pt_change_calendar" }, { name: "pt_change_calendar" }, { name: "app" }],
    });
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith());
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-add"]').trigger("click");
    await flushPromises();

    const stream = form().findComponent<typeof OFormSelect>(
      '[data-test="dashboard-annotation-source-stream"]',
    );
    expect(stream.props("options")).toEqual([
      { label: "$env (variable)", value: "$env" },
      { label: "pt_change_calendar", value: "pt_change_calendar" },
      { label: "app", value: "app" },
    ]);
  });

  it("picks a dashboard variable as the stream, and keeps the $var literal in the SQL pre-fill", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    const stream = form().findComponent<typeof OFormSelect>(
      '[data-test="dashboard-annotation-source-stream"]',
    );
    expect(stream.props("options")).toEqual(
      expect.arrayContaining([{ label: "$env (variable)", value: "$env" }]),
    );
    stream.vm.$emit("update:modelValue", "$env");
    await flushPromises();

    await switchMode("sql");
    expect(
      (wrapper!.find('[data-test="query-editor-stub"]').element as HTMLTextAreaElement).value,
    ).toContain(`FROM "$env"`);
  });

  it("resolves a $variable stream to its current value for the schema lookup and the Run query", async () => {
    streamsApi.getStream.mockReset().mockResolvedValue({ schema: [{ name: "service" }] });
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [] } } as never);
    await mountSettings([{ name: "env", value: "k8s_events" }]);
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    const stream = form().findComponent<typeof OFormSelect>(
      '[data-test="dashboard-annotation-source-stream"]',
    );
    stream.vm.$emit("update:modelValue", "$env");
    await flushPromises();

    expect(streamsApi.getStream).toHaveBeenLastCalledWith("k8s_events", "logs", true);

    await wrapper!.find('[data-test="dashboard-annotation-source-run"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(searchService.search).mock.calls[0][0].query.query.sql).toContain(
      `FROM "k8s_events"`,
    );
  });

  it("offers a dashboard variable as a filter value", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    const combobox = form().find('[data-test="alert-conditions-value-combobox"]');
    expect(combobox.exists()).toBe(true);
  });

  it("offers a custom query's stream fields for the end time without a Run", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();
    await switchMode("sql");
    form()
      .findComponent({ name: "QueryEditor" })
      .vm.$emit(
        "update:query",
        `SELECT _timestamp, title, end_ts AS "ends" FROM "pt_change_calendar" WHERE kind = 'maint'`,
      );
    await flushPromises();

    expect(streamsApi.getStream).toHaveBeenLastCalledWith("pt_change_calendar", "logs", true);
    const endField = form().findComponent<typeof OFormSelect>(
      '[data-test="dashboard-annotation-source-end-time-field"]',
    );
    expect(endField.props("options")).toEqual(
      expect.arrayContaining([
        { label: "end_ts", value: "end_ts" },
        { label: "ends", value: "ends" },
      ]),
    );
    expect(searchService.search).not.toHaveBeenCalled();
  });

  it("flags a custom query without _timestamp at Run", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    vi.mocked(searchService.search).mockResolvedValue({
      data: { hits: [{ _timestamp: 1_700_000_000_000_000, title: "maint" }] },
    } as never);
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();
    await switchMode("sql");
    form()
      .findComponent({ name: "QueryEditor" })
      .vm.$emit("update:query", `SELECT title FROM "pt_change_calendar"`);
    await flushPromises();
    await wrapper!.find('[data-test="dashboard-annotation-source-run"]').trigger("click");
    await flushPromises();

    expect(wrapper!.text()).toContain(
      "The query does not return _timestamp, so its rows cannot be placed on the time axis.",
    );
  });

  it("blocks Save while a missing field stands, and allows it once fixed", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [] } } as never);
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    await typeInto("dashboard-annotation-source-title", "Deploy {ver}");
    await submit();
    await vi.waitFor(() =>
      expect(wrapper!.text()).toContain(
        "{ver} is not in the query result, so that part of the marker is empty.",
      ),
    );

    expect(updateDashboard).not.toHaveBeenCalled();
    expect(
      wrapper!.find('[data-test="dashboard-annotation-source-save"]').attributes("aria-disabled"),
    ).toBe("true");
    expect(vi.mocked(searchService.search).mock.calls[0][0].query.query.sql).toBe(
      `SELECT _timestamp\nFROM k8s_events\nWHERE event = 'deploy'\nORDER BY _timestamp DESC`,
    );

    await typeInto("dashboard-annotation-source-title", "Deploy {service}");
    await flushPromises();
    expect(
      wrapper!.find('[data-test="dashboard-annotation-source-save"]').attributes("aria-disabled"),
    ).toBeUndefined();

    await submit();
    await vi.waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1));
    expect(lastSavedSources()?.[0].title).toBe("Deploy {service}");
  });

  it("blocks Save when the check itself fails, pointing back to Run via the inline error", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    vi.mocked(searchService.search).mockRejectedValue(new Error("stream not found"));
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    await submit();
    await vi.waitFor(() => expect(wrapper!.text()).toContain("stream not found"));

    expect(updateDashboard).not.toHaveBeenCalled();
    expect(
      wrapper!.find('[data-test="dashboard-annotation-source-save"]').attributes("aria-disabled"),
    ).toBe("true");
  });

  it("blocks Save when a Custom SQL query never names _timestamp", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    vi.mocked(searchService.search).mockResolvedValue({
      data: { hits: [{ _timestamp: 1_700_000_000_000_000, title: "maint" }] },
    } as never);
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();
    await switchMode("sql");
    form()
      .findComponent({ name: "QueryEditor" })
      .vm.$emit("update:query", `SELECT title FROM "pt_change_calendar"`);
    await flushPromises();

    await submit();
    await vi.waitFor(() =>
      expect(wrapper!.text()).toContain(
        "The query does not return _timestamp, so its rows cannot be placed on the time axis.",
      ),
    );

    expect(updateDashboard).not.toHaveBeenCalled();
  });

  it("allows Save for a valid source whose query returns no rows in range", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [] } } as never);
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    await submit();
    await vi.waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1));

    expect(notifications.showErrorNotification).not.toHaveBeenCalled();
  });

  it("waits for a still-loading variable instead of treating the check as already valid", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    vi.mocked(searchService.search).mockResolvedValue({
      data: { hits: [{ _timestamp: 1_700_000_000_000_000, service: "checkout" }] },
    } as never);
    vi.mocked(runAnnotationSourceQuery)
      .mockImplementationOnce(async () => null)
      .mockImplementationOnce(async () => null);
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    await wrapper!.find('[data-test="dashboard-annotation-source-save"]').trigger("click");
    await vi.waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(runAnnotationSourceQuery).toHaveBeenCalledTimes(3);
  });

  it("names a source whose panels were all deleted instead of showing raw ids", async () => {
    vi.mocked(getDashboard).mockResolvedValue(
      dashboardWith([
        { ...deploys, panels: ["Panel_ID485510"] },
        { ...deploys, id: "kept", name: "Kept", panels: ["Panel_ID485510", "p1"] },
      ]),
    );
    await mountSettings();

    expect(wrapper!.find('[data-test="dashboard-annotation-source-panels-deploys"]').text()).toBe(
      "No panels",
    );
    expect(
      wrapper!.find('[data-test="dashboard-annotation-source-panels-hint-deploys"]').exists(),
    ).toBe(true);
    expect(wrapper!.find('[data-test="dashboard-annotation-source-panels-kept"]').text()).toBe(
      "Latency",
    );
    expect(wrapper!.text()).not.toContain("Panel_ID485510");

    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();
    expect(form().props("source")?.panels).toEqual([]);
    expect(wrapper!.text()).toContain(
      "Its panels were deleted, so it currently draws on no panel.",
    );
  });

  it("keeps a pruned source's panels empty on save, even when only the title is edited", async () => {
    vi.mocked(getDashboard).mockResolvedValue(
      dashboardWith([{ ...deploys, panels: ["Panel_ID485510"] }]),
    );
    vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [] } } as never);
    await mountSettings();

    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();
    await typeInto("dashboard-annotation-source-title", "{service} updated");
    await submit();
    await vi.waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1), { timeout: 3000 });

    expect(lastSavedSources()?.find((source) => source.id === "deploys")?.panels).toEqual([]);
  });

  it("reopens a pruned-to-empty source and saves it with no edits at all, panels stays []", async () => {
    vi.mocked(getDashboard).mockResolvedValue(
      dashboardWith([{ ...deploys, panels: ["Panel_ID485510"] }]),
    );
    vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [] } } as never);
    await mountSettings();

    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();
    await submit();
    await vi.waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1), { timeout: 3000 });

    expect(lastSavedSources()?.find((source) => source.id === "deploys")?.panels).toEqual([]);
  });

  it("restores all panels when the panel field is touched and left empty, even on a pruned source", async () => {
    // Two time-series panels so picking just "p1" is a genuine partial selection,
    // not the full set (which the select-all collapse would treat as "all").
    const dashboard = dashboardWith([{ ...deploys, panels: ["Panel_ID485510"] }]);
    dashboard.tabs[0].panels.push({ id: "p3", type: "bar", title: "Errors" });
    vi.mocked(getDashboard).mockResolvedValue(dashboard);
    vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [] } } as never);
    await mountSettings();

    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    const panelsField = form().findComponent('[data-test="dashboard-annotation-source-panels"]');
    panelsField.vm.$emit("update:modelValue", ["p1"]);
    await flushPromises();
    panelsField.vm.$emit("update:modelValue", []);
    await flushPromises();

    await submit();
    await vi.waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1), { timeout: 3000 });

    expect(lastSavedSources()?.find((source) => source.id === "deploys")?.panels).toBeUndefined();
  });

  it("selects every time-series panel through the Select All row, saving panels as absent", async () => {
    const dashboard = dashboardWith([deploys]);
    dashboard.tabs[0].panels.push({ id: "p3", type: "bar", title: "Errors" });
    vi.mocked(getDashboard).mockResolvedValue(dashboard);
    vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [] } } as never);
    await mountSettings();

    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    const panelsField = form().findComponent('[data-test="dashboard-annotation-source-panels"]');
    // Mirrors OSelect's own toggleAllSelections: emits every selectable option's value.
    panelsField.vm.$emit("update:modelValue", ["p1", "p3"]);
    await flushPromises();

    await submit();
    await vi.waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1), { timeout: 3000 });

    expect(lastSavedSources()?.find((source) => source.id === "deploys")?.panels).toBeUndefined();
  });

  it("keeps an explicit subset when only some panels are picked, not the select-all sentinel", async () => {
    const dashboard = dashboardWith([deploys]);
    dashboard.tabs[0].panels.push({ id: "p3", type: "bar", title: "Errors" });
    vi.mocked(getDashboard).mockResolvedValue(dashboard);
    vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [] } } as never);
    await mountSettings();

    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();

    const panelsField = form().findComponent('[data-test="dashboard-annotation-source-panels"]');
    panelsField.vm.$emit("update:modelValue", ["p1", "p3"]);
    await flushPromises();
    // Unchecking one panel after a full selection switches back to an explicit list.
    panelsField.vm.$emit("update:modelValue", ["p1"]);
    await flushPromises();

    await submit();
    await vi.waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1), { timeout: 3000 });

    expect(lastSavedSources()?.find((source) => source.id === "deploys")?.panels).toEqual(["p1"]);
  });

  it("treats an explicit panels: null the same as absent, consistently with the list view", async () => {
    vi.mocked(getDashboard).mockResolvedValue(
      dashboardWith([{ ...deploys, panels: null as never }]),
    );
    vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [] } } as never);
    await mountSettings();

    expect(wrapper!.find('[data-test="dashboard-annotation-source-panels-deploys"]').text()).toBe(
      "All time-series panels",
    );

    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();
    await typeInto("dashboard-annotation-source-title", "updated");
    await submit();
    await vi.waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1), { timeout: 3000 });

    expect(lastSavedSources()?.find((source) => source.id === "deploys")?.panels).toBeUndefined();
  });

  it("reveals the no-panels hint on hover and on focus", async () => {
    vi.mocked(getDashboard).mockResolvedValue(
      dashboardWith([{ ...deploys, panels: ["Panel_ID485510"] }]),
    );
    await mountSettings();

    const hint = wrapper!.find('[data-test="dashboard-annotation-source-panels-hint-deploys"]');
    expect(document.body.textContent).not.toContain("Its panels were deleted");

    hint.element.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    await nextTick();
    expect(document.body.textContent).toContain("Its panels were deleted");

    hint.element.dispatchEvent(new Event("mouseleave", { bubbles: true }));
    await nextTick();

    hint.element.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 250));
    await nextTick();
    expect(document.body.textContent).toContain("Its panels were deleted");
  });

  it("flags an empty result in the preview", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [] } } as never);
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();
    await wrapper!.find('[data-test="dashboard-annotation-source-run"]').trigger("click");
    await flushPromises();

    expect(wrapper!.text()).toContain("No rows in the current time range.");
  });

  it("flags truncation in the preview when the query returns exactly the preview row cap", async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      _timestamp: 1_700_000_000_000_000 + index,
      service: `svc-${index}`,
    }));
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    vi.mocked(searchService.search).mockResolvedValue({ data: { hits: rows } } as never);
    await mountSettings();
    await wrapper!.find('[data-test="dashboard-annotation-source-edit-deploys"]').trigger("click");
    await flushPromises();
    await wrapper!.find('[data-test="dashboard-annotation-source-run"]').trigger("click");
    await flushPromises();

    expect(wrapper!.text()).toContain("Showing the latest 10 rows; more may exist in this range.");
  });

  it("toggles a source off from the list", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    await mountSettings();

    wrapper!
      .findComponent('[data-test="dashboard-annotation-source-enabled-deploys"]')
      .vm.$emit("update:modelValue", false);
    await flushPromises();

    expect(lastSavedSources()).toEqual([{ ...deploys, enabled: false }]);
  });

  it("shows the conflict notification and leaves the list unmodified on a 409 from the server", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    vi.mocked(updateDashboard).mockRejectedValue({
      response: { status: 409, data: { message: "Conflict: stale hash" } },
    });
    await mountSettings();

    const toggle = wrapper!.findComponent(
      '[data-test="dashboard-annotation-source-enabled-deploys"]',
    );
    toggle.vm.$emit("update:modelValue", false);
    await flushPromises();

    expect(notifications.showConfictErrorNotificationWithRefreshBtn).toHaveBeenCalledWith(
      "Conflict: stale hash",
      expect.anything(),
    );
    expect(notifications.showErrorNotification).not.toHaveBeenCalled();
    expect(toggle.props("modelValue")).toBe(true);
    expect(wrapper!.find('[data-test="dashboard-annotation-source-name-deploys"]').text()).toBe(
      "Deploys",
    );
  });

  it("does not toast on toggle, so flipping it twice quickly never stacks one", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    await mountSettings();
    const toggle = wrapper!.findComponent(
      '[data-test="dashboard-annotation-source-enabled-deploys"]',
    );

    toggle.vm.$emit("update:modelValue", false);
    toggle.vm.$emit("update:modelValue", true);
    await flushPromises();
    await vi.waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(2));

    expect(notifications.showPositiveNotification).not.toHaveBeenCalled();
  });

  it("disables the switch while its own toggle save is in flight", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    let resolveUpdate!: () => void;
    vi.mocked(updateDashboard).mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = () => resolve(undefined as never);
      }),
    );
    await mountSettings();
    const toggle = wrapper!.findComponent(
      '[data-test="dashboard-annotation-source-enabled-deploys"]',
    );

    toggle.vm.$emit("update:modelValue", false);
    await nextTick();
    expect(toggle.props("disabled")).toBe(true);

    resolveUpdate();
    await flushPromises();
    expect(toggle.props("disabled")).toBe(false);
  });

  it("serializes writes so two different rows toggled back to back both persist with no conflict", async () => {
    let serverDashboard = dashboardWith([deploys, calendarEvents]);
    vi.mocked(getDashboard).mockImplementation(async () => serverDashboard);
    vi.mocked(updateDashboard).mockImplementation(
      async (_store, _org, _id, currentDashboardData) => {
        serverDashboard = currentDashboardData as ReturnType<typeof dashboardWith>;
        return { data: { success: true } } as never;
      },
    );
    await mountSettings();

    const toggleDeploys = wrapper!.findComponent(
      '[data-test="dashboard-annotation-source-enabled-deploys"]',
    );
    const toggleCalendar = wrapper!.findComponent(
      '[data-test="dashboard-annotation-source-enabled-calendar"]',
    );

    toggleDeploys.vm.$emit("update:modelValue", false);
    toggleCalendar.vm.$emit("update:modelValue", false);
    await flushPromises();

    expect(updateDashboard).toHaveBeenCalledTimes(2);
    expect(notifications.showConfictErrorNotificationWithRefreshBtn).not.toHaveBeenCalled();
    expect(lastSavedSources()).toEqual([
      { ...deploys, enabled: false },
      { ...calendarEvents, enabled: false },
    ]);
  });

  it("deletes a source after confirming, dropping the key when none remain", async () => {
    vi.mocked(getDashboard).mockResolvedValue(dashboardWith([deploys]));
    await mountSettings();

    await wrapper!
      .find('[data-test="dashboard-annotation-source-delete-deploys"]')
      .trigger("click");
    await flushPromises();
    wrapper!.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
    await flushPromises();

    expect(updateDashboard).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateDashboard).mock.calls[0][3]).not.toHaveProperty("annotationSources");
  });
});
