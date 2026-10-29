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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises, DOMWrapper, type VueWrapper } from "@vue/test-utils";
import type { RouteLocationNormalizedLoaded } from "vue-router";
import TemplateList from "./TemplateList.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { http, HttpResponse } from "msw";
import templateService from "@/services/alert_templates";
import alertsFixture from "@/test/unit/mockData/alerts";
import router from "@/test/unit/helpers/router";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import type { Template } from "@/ts/interfaces";
import { resetListViewState, useListViewState } from "@/composables/useListViewState";
import {
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";

interface TemplateListVm {
  showTemplateEditor: boolean;
  editingTemplate: Template | null;
  cloningTemplate: boolean;
  cloningSource: string | null;
  templates: Template[];
  lastUpdatedAt: number;
  cloneTemplate: (template: Template) => void;
}

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// OTable holds the skeleton visible for MIN_SKELETON_MS = 2000ms via setTimeout.
// Use fake timers so we can advance past that hold without real waits.
const SKELETON_HOLD_MS = 2100;

describe("Alert List", async () => {
  let wrapper: any;
  beforeEach(async () => {
    // Install fake timers before mounting so OTable's skeleton-hold setTimeout
    // is registered as a fake timer. Only fake setTimeout/clearTimeout/Date to
    // keep MSW's fetch/http machinery on real timers.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });

    wrapper = mount(TemplateList, {
      attachTo: "#app",
      global: {
        provide: {
          store: store,
        },
        plugins: [i18n, router],
      },
    });

    // Let MSW respond and the component finish its initial data fetch.
    await flushPromises();
    // Advance past OTable's 2-second skeleton hold timer so real rows are visible.
    vi.advanceTimersByTime(SKELETON_HOLD_MS);
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("titles itself with the SECTION, so the peer tabs never move", () => {
    // All four alerting pages carry this identical string: the title block
    // sizes to its content, so a per-page title would shift the tab strip
    // horizontally on every navigation. The active tab says which page it is.
    expect(wrapper.find(".app-page-header h1").text()).toBe("Alerts");
  });

  it("Should reder table with templates", () => {
    expect(wrapper.find('[data-test="alert-templates-list-table"]').exists()).toBeTruthy();
  });

  it("Should display table column headers", async () => {
    const tableData = wrapper
      .find('[data-test="alert-templates-list-table"]')
      .find("thead")
      .find("tr")
      .findAll("th");
    // Index 0 is the checkbox column, so actual columns start at index 1
    expect(tableData[1].text()).toBe("#");
    expect(tableData[2].text()).toContain("Name");
    // Action column headers are rendered empty by OTable for isAction columns
    expect(tableData[3].exists()).toBe(true);
  });

  it("Should display table row data", async () => {
    // Target the real data tbody (not the skeleton tbody).
    const tableData = wrapper
      .find('[data-test="alert-templates-list-table"]')
      .find('[data-test="o2-table-body"]')
      .find("tr")
      .findAll("td");
    // Index 0 is the checkbox cell; actual data cells start at index 1.
    expect(tableData[1].text()).toBe("01");
    // The Name cell now includes a Prebuilt/Custom badge next to the name,
    // so concat'd text() ends with the badge label (e.g. "Template2Custom").
    expect(tableData[2].text()).toContain("Template2");
  });

  it("names the template and uses a destructive confirm", async () => {
    await wrapper
      .find('[data-test="alert-template-list-Template2-delete-template"]')
      .trigger("click");
    await flushPromises();

    const dialog = wrapper
      .findAllComponents({ name: "ConfirmDialog" })
      .find((c: any) => c.props("messageKeypath") === "alert_templates.deleteTemplateMessage");
    expect(dialog.props("messageName")).toBe("Template2");
    expect(dialog.props("okVariant")).toBe("destructive");
  });

  it("uses a destructive confirm for bulk delete", () => {
    const dialog = wrapper
      .findAllComponents({ name: "ConfirmDialog" })
      .find((c: any) => c.props("title") === i18n.global.t("alert_templates.deleteTemplatesTitle"));
    expect(dialog.props("okVariant")).toBe("destructive");
  });

  describe("When user clicks on delete alert", () => {
    const template_name = "Template2";
    const deleteAlert = vi.spyOn(templateService, "delete");
    const listTemplates = vi.spyOn(templateService, "list");
    let listCallsBeforeDelete = 0;
    beforeEach(async () => {
      const templatesUrl = `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts/templates`;
      global.server.use(
        http.delete(`${templatesUrl}/${template_name}`, () => {
          return HttpResponse.json({ code: 200 });
        }),
        // The delete's invalidation refetches the list; the shared fixture would put the row back.
        http.get(templatesUrl, () =>
          HttpResponse.json(
            alertsFixture.templates.get.filter((tpl: any) => tpl.name !== template_name),
          ),
        ),
      );
      listCallsBeforeDelete = listTemplates.mock.calls.length;

      // Click the delete button — only visible once skeleton is cleared (done in outer beforeEach).
      await wrapper
        .find(`[data-test="alert-template-list-${template_name}-delete-template"]`)
        .trigger("click");
      await flushPromises();

      // Confirm the deletion in the dialog.
      const mainWrapper = new DOMWrapper(document.body);
      await mainWrapper.find('[data-test="o-dialog-primary-btn"]').trigger("click");
      await flushPromises();
    });

    it("Should delete alert from the list", () => {
      expect(deleteAlert).toHaveBeenCalledTimes(1);
    });

    it("drops the deleted row in place, leaving the rest of the list alone", () => {
      // The mutation's invalidation refetches the mounted list in the background; the splice keeps the row gone meanwhile.
      expect(listTemplates.mock.calls.length).toBe(listCallsBeforeDelete + 1);
      const body = wrapper
        .find('[data-test="alert-templates-list-table"]')
        .find('[data-test="o2-table-body"]');
      expect(body.findAll("tr").length).toBe(2);
      expect(body.text()).not.toContain(template_name);
      expect(body.text()).toContain("Template3");
    });
  });
});

// ── pagination restoration ────────────────────────────────────────────────
// This spec mounts the real OTable (not stubbed), so the TanStack pageIndex
// restoration itself (setTimeout(0) + OTable restorePage) isn't exercised
// end-to-end here. These tests cover what IS reachable: seeding currentPage
// from the URL, and that navigating to/from the add/edit/clone/import views
// preserves the `page` query param instead of stripping it.
describe("TemplateList pagination persistence", () => {
  let wrapper: any;

  const mountComponent = () =>
    mount(TemplateList, {
      attachTo: "#app",
      global: {
        provide: { store },
        plugins: [i18n, router],
      },
    });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("seeds currentPage from the URL's page query param", async () => {
    (router as any).currentRoute.value.query = { page: "3" };
    // Mocked so the clamp's own URL rewrite (covered below) never becomes a real navigation that leaks into later tests.
    const replaceSpy = vi
      .spyOn(router, "replace")
      .mockImplementation((() => Promise.resolve()) as any);
    wrapper = mountComponent();

    // Read before the fetch settles: once it does, a page past the end is clamped.
    expect((wrapper.vm as any).currentPage).toBe(3);

    await vi.waitFor(() => expect((wrapper.vm as any).currentPage).toBe(1));
    replaceSpy.mockRestore();
  });

  it("falls back to page 1 once the list loads shorter than the URL's page", async () => {
    (router as any).currentRoute.value.query = { page: "3" };
    const replaceSpy = vi
      .spyOn(router, "replace")
      .mockImplementation((() => Promise.resolve()) as any);
    wrapper = mountComponent();
    // The restore runs in a setTimeout(0) after the fetch lands, so poll rather than guess the delay.
    await vi.waitFor(() => expect((wrapper.vm as any).currentPage).toBe(1));

    expect(replaceSpy).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ page: "1" }) }),
    );
    replaceSpy.mockRestore();
  });

  it("defaults currentPage to 1 when no page query param is present", async () => {
    (router as any).currentRoute.value.query = {};
    wrapper = mountComponent();
    await flushPromises();

    expect((wrapper.vm as any).currentPage).toBe(1);
  });

  it("onPageChange updates currentPage and replaces the URL, preserving other query params", async () => {
    (router as any).currentRoute.value.query = { org_identifier: "test-org" };
    wrapper = mountComponent();
    await flushPromises();
    const replaceSpy = vi.spyOn(router, "replace");

    (wrapper.vm as any).onPageChange(3);

    expect((wrapper.vm as any).currentPage).toBe(3);
    expect(replaceSpy).toHaveBeenCalledWith({
      query: { org_identifier: "test-org", page: "3" },
    });
  });

  it("onPageChange is a no-op on the URL when the page hasn't actually changed", async () => {
    (router as any).currentRoute.value.query = { page: "1" };
    wrapper = mountComponent();
    await flushPromises();
    const replaceSpy = vi.spyOn(router, "replace");

    (wrapper.vm as any).onPageChange(1);

    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it("editTemplate(null) preserves the page query param when opening the add form", async () => {
    (router as any).currentRoute.value.query = {};
    wrapper = mountComponent();
    await flushPromises();
    (router as any).currentRoute.value.query = { page: "3", org_identifier: "test-org" };
    const pushSpy = vi.spyOn(router, "push");

    (wrapper.vm as any).editTemplate(null);

    const pushedQuery = pushSpy.mock.calls[0][0].query;
    expect(pushedQuery.page).toBe("3");
    expect(pushedQuery.action).toBe("add");
  });

  it("editTemplate(row) preserves the page query param when opening the edit form", async () => {
    (router as any).currentRoute.value.query = {};
    wrapper = mountComponent();
    await flushPromises();
    (router as any).currentRoute.value.query = { page: "3", org_identifier: "test-org" };
    const pushSpy = vi.spyOn(router, "push");

    (wrapper.vm as any).editTemplate({ name: "Template2" });

    const pushedQuery = pushSpy.mock.calls[0][0].query;
    expect(pushedQuery.page).toBe("3");
    expect(pushedQuery.action).toBe("update");
    expect(pushedQuery.name).toBe("Template2");
  });

  it("cloneTemplate preserves the page query param", async () => {
    (router as any).currentRoute.value.query = {};
    wrapper = mountComponent();
    await flushPromises();
    (router as any).currentRoute.value.query = { page: "3", org_identifier: "test-org" };
    const pushSpy = vi.spyOn(router, "push");

    (wrapper.vm as any).cloneTemplate({ name: "Template2" });

    const pushedQuery = pushSpy.mock.calls[0][0].query;
    expect(pushedQuery.page).toBe("3");
    expect(pushedQuery.action).toBe("add");
    expect(pushedQuery.clone).toBe("Template2");
  });

  it("importTemplate preserves the page query param", async () => {
    (router as any).currentRoute.value.query = {};
    wrapper = mountComponent();
    await flushPromises();
    (router as any).currentRoute.value.query = { page: "3", org_identifier: "test-org" };
    const pushSpy = vi.spyOn(router, "push");

    (wrapper.vm as any).importTemplate();

    const pushedQuery = pushSpy.mock.calls[0][0].query;
    expect(pushedQuery.page).toBe("3");
    expect(pushedQuery.action).toBe("import");
  });

  it("toggleTemplateEditor drops action/name but keeps page when closing the editor", async () => {
    (router as any).currentRoute.value.query = {};
    wrapper = mountComponent();
    await flushPromises();
    (wrapper.vm as any).showTemplateEditor = true;
    (router as any).currentRoute.value.query = {
      action: "update",
      name: "Template2",
      page: "3",
      org_identifier: "test-org",
    };
    const pushSpy = vi.spyOn(router, "push");

    (wrapper.vm as any).toggleTemplateEditor();

    const pushedQuery = pushSpy.mock.calls[0][0].query;
    expect(pushedQuery.page).toBe("3");
    expect(pushedQuery.action).toBeUndefined();
    expect(pushedQuery.name).toBeUndefined();
  });
});

describe("alertTemplates view state restore", () => {
  let viewWrapper: any;
  const mountComponent = () =>
    mount(TemplateList, {
      attachTo: "#app",
      global: { provide: { store }, plugins: [i18n, router] },
    });

  beforeEach(() => resetListViewState());

  afterEach(() => viewWrapper?.unmount());

  it("restores search, tab, page size and sort", () => {
    useListViewState("alertTemplates", {
      filterQuery: "slack",
      tab: "custom",
      pageSize: 50,
      sortBy: "name",
      sortOrder: "desc",
    });
    viewWrapper = mountComponent();
    const vm = viewWrapper.vm as any;
    expect(vm.filterQuery).toBe("slack");
    expect(vm.activeTab).toBe("custom");
    expect(vm.pageSize).toBe(50);
    expect(vm.sortBy).toBe("name");
    expect(vm.sortOrder).toBe("desc");
  });

  it("saves changes to the view state", async () => {
    viewWrapper = mountComponent();
    const vm = viewWrapper.vm as any;
    vm.filterQuery = "abc";
    vm.activeTab = "prebuilt";
    vm.pageSize = 100;
    await flushPromises();
    const saved: any = useListViewState("alertTemplates", {});
    expect(saved.filterQuery).toBe("abc");
    expect(saved.tab).toBe("prebuilt");
    expect(saved.pageSize).toBe(100);
  });
});

describe("TemplateList drafts", () => {
  let wrapper: any;
  const scope = (entityId: string | null): EditorDraftScope => ({
    kind: "alert_template",
    org: "default",
    entityId,
    userEmail: "example@gmail.com",
  });

  beforeEach(async () => {
    localStorage.clear();
    writeEditorDraft(scope(null), { data: {} });
    writeEditorDraft(scope("Template2"), { data: {} });
    (router as any).currentRoute.value.query = {};
    resetListViewState();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    wrapper = mount(TemplateList, {
      attachTo: "#app",
      global: { provide: { store }, plugins: [i18n, router] },
    });
    await flushPromises();
    vi.advanceTimersByTime(SKELETON_HOLD_MS);
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("marks the Add button and the drafted row only", () => {
    const add = wrapper.get('[data-test="template-list-add-btn"]');
    expect(add.find('[data-test="template-list-add-draft-dot"]').exists()).toBe(true);
    expect(add.attributes("aria-label")).toContain("unsaved draft");
    expect(wrapper.find('[data-test="alert-template-list-Template2-draft-dot"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="alert-template-list-Template3-draft-dot"]').exists()).toBe(
      false,
    );
  });

  it("marks the clone action of a template whose clone has a kept draft", async () => {
    writeEditorDraft({ ...scope(null), variant: "clone:Template2" }, { data: {} });
    await flushPromises();

    const clone = wrapper.get('[data-test="alert-template-list-Template2-clone-template"]');
    expect(clone.find('[data-test="alert-template-list-Template2-clone-draft-dot"]').exists()).toBe(
      true,
    );
    expect(clone.attributes("aria-label")).toMatch(/^Clone · unsaved draft · .*\d/);
    // Sighted users read the same dated name in the button's own tooltip, not a bare native title.
    expect(clone.attributes("title")).toBeUndefined();
    const tip = clone.findComponent(OTooltip);
    expect(tip.props("content")).toBe(clone.attributes("aria-label"));
    expect(
      wrapper.find('[data-test="alert-template-list-Template3-clone-draft-dot"]').exists(),
    ).toBe(false);
    const plain = wrapper.get('[data-test="alert-template-list-Template3-clone-template"]');
    expect(plain.findComponent(OTooltip).props("content")).toBe("Clone");
  });

  it("marks the phone row menu and its Clone item for a kept clone draft", async () => {
    writeEditorDraft({ ...scope(null), variant: "clone:Template2" }, { data: {} });
    await flushPromises();

    const triggers = wrapper.findAll('[data-test="alert-template-list-row-more-actions"]');
    const trigger = triggers.find((t: DOMWrapper<Element>) =>
      t.find('[data-test="alert-template-list-Template2-more-actions-draft-dot"]').exists(),
    );
    expect(trigger?.attributes("aria-label")).toMatch(/^More actions · unsaved draft · .*\d/);
    expect(trigger?.attributes("title")).toBeUndefined();
    expect(wrapper.findAll('[data-test$="-more-actions-draft-dot"]').length).toBe(1);

    await trigger!.trigger("keydown", { key: "Enter" });
    await flushPromises();
    const item = document.body.querySelector(
      '[data-test="alert-template-list-Template2-clone-template-menu"]',
    );
    const menuDot = item?.querySelector(
      '[data-test="alert-template-list-Template2-clone-template-menu-draft-dot"]',
    );
    expect(menuDot?.getAttribute("aria-label")).toMatch(/^Unsaved draft · .*\d/);
  });

  it("drops a deleted template's draft", async () => {
    const templatesUrl = `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts/templates`;
    global.server.use(
      http.delete(`${templatesUrl}/Template2`, () => HttpResponse.json({ code: 200 })),
      http.get(templatesUrl, () =>
        HttpResponse.json(
          alertsFixture.templates.get.filter((tpl: any) => tpl.name !== "Template2"),
        ),
      ),
    );
    await wrapper
      .find('[data-test="alert-template-list-Template2-delete-template"]')
      .trigger("click");
    await flushPromises();
    await new DOMWrapper(document.body).find('[data-test="o-dialog-primary-btn"]').trigger("click");
    await flushPromises();

    expect(readEditorDraft(scope("Template2"))).toBeNull();
    expect(readEditorDraft(scope(null))).not.toBeNull();
  });
});

describe("TemplateList refetch while the editor is open", () => {
  let wrapper: VueWrapper | null = null;
  let routeName: RouteLocationNormalizedLoaded["name"];
  const route = () => router.currentRoute.value;
  const vm = () => wrapper!.vm as unknown as TemplateListVm;

  const mountAt = async (query: Record<string, string>) => {
    route().query = query;
    wrapper = mount(TemplateList, {
      attachTo: "#app",
      global: { provide: { store }, plugins: [i18n, router] },
    });
    await vi.waitFor(() => expect(vm().showTemplateEditor).toBe(true), { timeout: 3000 });
    // AddTemplate is an async component, so it can land after the list says the editor is open.
    await vi.waitFor(
      () => expect(wrapper!.findComponent({ name: "AddTemplate" }).exists()).toBe(true),
      { timeout: 3000 },
    );
    await flushPromises();
  };

  const refetch = async () => {
    const { queryClient } = await import("@/composables/query/queryClient");
    const before = vm().lastUpdatedAt;
    await queryClient.refetchQueries();
    await vi.waitFor(() => expect(vm().lastUpdatedAt).not.toBe(before), { timeout: 3000 });
    await flushPromises();
  };

  beforeEach(() => {
    localStorage.clear();
    resetListViewState();
    // Pinned: a real navigation through the app router lands at an unpredictable moment and rewrites the query.
    vi.spyOn(router, "push").mockImplementation((() => Promise.resolve()) as never);
    vi.spyOn(router, "replace").mockImplementation((() => Promise.resolve()) as never);
    // AddTemplate runs drafts only on its own route.
    routeName = route().name;
    route().name = "alertTemplates";
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
    route().name = routeName;
  });

  it("keeps the edit open on the same template", async () => {
    await mountAt({ action: "update", name: "Template2" });
    expect(vm().editingTemplate?.name).toBe("Template2");

    await refetch();

    expect(vm().showTemplateEditor).toBe(true);
    expect(vm().editingTemplate?.name).toBe("Template2");
    expect(wrapper!.findComponent({ name: "AddTemplate" }).exists()).toBe(true);
  });

  it("keeps a new template open", async () => {
    await mountAt({ action: "add" });

    await refetch();

    expect(vm().showTemplateEditor).toBe(true);
    expect(vm().editingTemplate).toBeNull();
  });

  it("opens a clone on its own draft slot, never offering the new-template draft", async () => {
    writeEditorDraft(
      { kind: "alert_template", org: "default", entityId: null, userEmail: "example@gmail.com" },
      { data: {} },
    );
    route().query = {};
    wrapper = mount(TemplateList, {
      attachTo: "#app",
      global: { provide: { store }, plugins: [i18n, router] },
    });
    await vi.waitFor(() => expect(vm().templates.length).toBeGreaterThan(0), {
      timeout: 3000,
    });
    const source = vm().templates[0].name;
    vm().cloneTemplate(vm().templates[0]);
    await vi.waitFor(
      () => expect(wrapper!.findComponent({ name: "AddTemplate" }).exists()).toBe(true),
      { timeout: 3000 },
    );
    await flushPromises();

    expect(wrapper!.findComponent({ name: "AddTemplate" }).props("cloneSource")).toBe(source);
    expect(document.body.querySelector('[data-test="editor-draft-restore-dialog"]')).toBeNull();
  });

  it("reopens a clone from its URL on reload and offers the clone's own draft", async () => {
    writeEditorDraft(
      {
        kind: "alert_template",
        org: "default",
        entityId: null,
        userEmail: "example@gmail.com",
        variant: "clone:Template2",
      },
      { data: {} },
    );
    await mountAt({ action: "add", clone: "Template2" });

    expect(vm().cloningTemplate).toBe(true);
    expect(vm().editingTemplate?.name).toBe("Copy_of_Template2");
    expect(wrapper!.findComponent({ name: "AddTemplate" }).props("cloneSource")).toBe("Template2");
    await vi.waitFor(() =>
      expect(
        document.body.querySelector('[data-test="editor-draft-restore-dialog"]'),
      ).not.toBeNull(),
    );

    await refetch();
    expect(vm().showTemplateEditor).toBe(true);
    expect(vm().cloningSource).toBe("Template2");
  });

  it("keeps a clone open with its copied content", async () => {
    route().query = {};
    wrapper = mount(TemplateList, {
      attachTo: "#app",
      global: { provide: { store }, plugins: [i18n, router] },
    });
    await vi.waitFor(() => expect(vm().templates.length).toBeGreaterThan(0), {
      timeout: 3000,
    });
    vm().cloneTemplate(vm().templates[0]);
    route().query = {
      action: "add",
      clone: vm().templates[0].name,
    };
    await flushPromises();

    await refetch();

    expect(vm().showTemplateEditor).toBe(true);
    expect(vm().cloningTemplate).toBe(true);
    expect(vm().editingTemplate?.name).toMatch(/^Copy_of_/);
  });
});
