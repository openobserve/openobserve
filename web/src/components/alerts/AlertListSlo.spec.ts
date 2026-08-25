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

//! SLO alerts inside the generic alerts list (Feature 5, Phase 2 + 3.4).
//!
//! Two things are being pinned here:
//!
//!  * **Labelling.** An SLO alert has no stream, so without a deliberate
//!    branch its row says nothing about what it watches. It must name its SLO
//!    and link to it — and must degrade to the raw id rather than to a blank
//!    when the name cannot be resolved.
//!  * **Containment.** Clone is the one row action that would create an SLO
//!    alert outside the SLO page (D1) and silently consume a burn-window pair,
//!    so it is disabled. Everything else — enable/disable especially — has to
//!    keep working: the toggle is the 3am action and the only way to free a
//!    pair slot.
//!
//! The row shape matters and is easy to get wrong: `getAlertsFn`'s mapper
//! rebuilds every API row, so the MAPPED row has `alert_id` (not `id`), a
//! flattened `type` discriminator and `rawCondition` — while the API row it is
//! built from has `condition`. A test written against the wrong one passes
//! while the feature no-ops.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false", isEnterprise: "false" },
}));

// Overlay, not replace: this module also exports the co-located queries the
// component reads, and a wholesale mock strips them.
vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      listByFolderId: vi.fn(),
      get_by_alert_id: vi.fn(),
      toggle_state_by_alert_id: vi.fn(),
      delete_by_alert_id: vi.fn(),
      create_by_alert_id: vi.fn(),
      clone_by_id: vi.fn(),
      getHistory: vi.fn(),
      export_by_id: vi.fn(),
      retrain_by_id: vi.fn(),
      trigger_alert: vi.fn(),
    },
  });
});
vi.mock("@/services/alert_templates", () => ({ default: { list: vi.fn() } }));
vi.mock("@/services/alert_destination", () => ({ default: { list: vi.fn() } }));
vi.mock("@/services/slos", () => ({ default: { list: vi.fn() } }));

// `toast()` returns a `dismiss` FUNCTION that several call sites invoke (the
// loading toast around the list fetch, for one). A mock that returns undefined
// blows up the whole file with "dismiss is not a function", so keep the shape.
const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...a: any[]) => {
    mockToast(...a);
    return () => {};
  },
}));

import AlertList from "@/components/alerts/AlertList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import AlertService from "@/services/alerts";
import TemplateService from "@/services/alert_templates";
import DestinationService from "@/services/alert_destination";
import SloService from "@/services/slos";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// @ts-ignore — export builds a Blob URL; jsdom has no object-URL support.
if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => "blob:x");
// @ts-ignore
if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();

const alertsSvc = AlertService as any;
const sloSvc = SloService as any;

/** A plain (non-SLO) scheduled alert, in the shape the LIST API returns. */
const plainAlert = (overrides: Record<string, any> = {}) => ({
  alert_id: "plain-1",
  name: "plain-alert",
  alert_type: "scheduled",
  is_real_time: false,
  enabled: true,
  condition: { type: "sql", sql: "select 1" },
  description: "",
  owner: "o@ex.com",
  trigger_condition: { period: 5, frequency: 5, frequency_type: "interval", cron: "" },
  last_triggered_at: 0,
  last_satisfied_at: 0,
  folder_id: "default",
  folder_name: "Default",
  ...overrides,
});

/**
 * An SLO alert as the LIST endpoint returns it.
 *
 * No stream fields: `ListAlertsResponseBodyItem`
 * (src/api/management/src/models/alerts/responses.rs) carries none for ANY
 * alert, so a fixture with them would be testing something the API cannot
 * send. `operator` IS always present — `SloCondition::operator` has no
 * skip_serializing_if (src/config/src/meta/slo/condition.rs).
 */
const sloAlert = (overrides: Record<string, any> = {}) => ({
  alert_id: "slo-alert-1",
  name: "slo-burn-alert",
  alert_type: "scheduled",
  is_real_time: false,
  enabled: true,
  condition: {
    type: "slo",
    slo_condition: {
      slo_id: "slo-123",
      kind: "burn_rate",
      operator: ">",
      critical: 14.4,
      long_window_secs: 3600,
      short_window_secs: 300,
    },
  },
  description: "",
  owner: "o@ex.com",
  trigger_condition: { period: 1, frequency: 1, frequency_type: "minutes", cron: "" },
  last_triggered_at: 0,
  last_satisfied_at: 0,
  folder_id: "default",
  folder_name: "Default",
  ...overrides,
});

const O_OVERLAY_PROPS = {
  open: { type: Boolean, default: false },
  size: { type: String, default: undefined },
  title: { type: String, default: undefined },
  persistent: { type: Boolean, default: false },
  primaryButtonLabel: { type: String, default: undefined },
  secondaryButtonLabel: { type: String, default: undefined },
  primaryButtonDisabled: { type: Boolean, default: false },
};

async function mountBare(rows: any[]) {
  (alertsSvc.listByFolderId as any) = vi
    .fn()
    .mockImplementation(() => Promise.resolve({ data: { list: rows } }));

  const wrapper = mount(AlertList, {
    attachTo: node,
    global: {
      plugins: [i18n, store, router],
      stubs: {
        FolderList: { template: '<div data-test="stub-folder-list"></div>' },
        MoveAcrossFolders: true,
        AlertHistoryDrawer: true,
        ImportAlert: true,
        AddAlert: true,
        SelectFolderDropDown: true,
        // `v-if="open"` matches the real ODialog, which portals its body and
        // mounts it only while open. Without it the clone/move dialog bodies
        // are permanently in the tree, and every page-wide `find` in this file
        // could be satisfied by something the user cannot see.
        ODialog: {
          name: "ODialog",
          props: O_OVERLAY_PROPS,
          template: '<div v-if="open" class="o-dialog-stub"><slot /></div>',
        },
        ConfirmDialog: {
          name: "ConfirmDialog",
          props: ["modelValue", "title", "message"],
          template: '<div class="confirm-dialog-stub" :data-open="modelValue"></div>',
        },
        // ODropdown portals its menu to document.body and only mounts it while
        // open, which puts Delete/Export out of `wrapper.find`'s reach. These
        // stubs render the items inline so the row's REAL menu markup — and any
        // v-if/:disabled the containment work puts on it — is what gets
        // asserted, rather than a hidden keyboard-shortcut proxy button.
        ODropdown: {
          name: "ODropdown",
          template: '<div class="o-dropdown-stub"><slot name="trigger" /><slot /></div>',
        },
        ODropdownItem: {
          name: "ODropdownItem",
          props: { disabled: { type: Boolean, default: false } },
          emits: ["select"],
          template:
            '<button class="o-dropdown-item-stub" :disabled="disabled" ' +
            "@click=\"$emit('select')\"><slot /></button>",
        },
        ODropdownSeparator: true,
      },
    },
  });
  (wrapper.vm as any).router.currentRoute.value.name = "alertList";
  (wrapper.vm as any).router.currentRoute.value.query = {} as any;
  await flushPromises();
  return wrapper;
}

const settle = async () => {
  await flushPromises();
  // OTable holds its skeleton for ~50ms so it does not flash on fast responses.
  await new Promise((r) => setTimeout(r, 75));
  await flushPromises();
};

async function mountList(rows: any[]) {
  const wrapper = await mountBare(rows);
  // Drive the REAL fetch + row mapper. Hand-building rows and assigning them to
  // `filteredResults` (as some older specs do) would test the fixture, not the
  // mapper — and the mapper is precisely where the SLO branch lives.
  await (wrapper.vm as any).getAlertsFn(store, "default");
  await settle();
  return wrapper;
}

/** The MAPPED table row for an alert id (not the API row it came from). */
const rowOf = (wrapper: any, alertId: string) =>
  (wrapper.vm.filteredResults as any[]).find((r: any) => r.alert_id === alertId);

/** Every tooltip string currently mounted. A disabled button swallows hover
 *  events, so the explanatory tooltip is anchored on a wrapper rather than on
 *  the button — asserting on the rendered set keeps the test honest about the
 *  string without pinning that plumbing. */
const tooltipContents = (wrapper: any): string[] =>
  wrapper.findAllComponents({ name: "OTooltip" }).map((tt: any) => tt.props("content"));

/** The row's NAME CELL. Every labelling assertion is scoped through this:
 *  a page-wide `find` would be satisfied by markup parked anywhere on the page
 *  — including somewhere the user never looks.
 *
 *  NOTE for the implementer — hooks this file requires in AlertList.vue:
 *   * `alert-list-{name}-name-cell` on the `#cell-name` slot's root, for EVERY
 *     row (the non-SLO assertions scope through it too);
 *   * `alert-list-{name}-slo-badge`, `-slo-link` (SLOs enabled) and
 *     `-slo-name` (SLOs disabled) inside that cell. */
const nameCell = (wrapper: any, alertName: string) =>
  wrapper.find(`[data-test="alert-list-${alertName}-name-cell"]`);

describe("AlertList — SLO alert rows", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // Keyed by type, the way production stores it — the component's watcher
    // reads `foldersByType["alerts"]`.
    (store.state as any).organizationData.foldersByType = {
      alerts: [{ folderId: "default", name: "Default" }],
    };
    (store.state as any).organizationData.allAlertsListByFolderId = {};
    (store.state as any).alertListFilters = {
      searchQuery: "",
      filterQuery: "",
      searchAcrossFolders: false,
    };

    vi.mocked(TemplateService).list.mockResolvedValue({ data: [{ name: "t1" }] } as any);
    vi.mocked(DestinationService).list.mockResolvedValue({ data: [{ name: "d1" }] } as any);
    sloSvc.list = vi.fn().mockResolvedValue({
      data: { list: [{ id: "slo-123", name: "checkout-availability" }] },
    });
    alertsSvc.get_by_alert_id = vi.fn().mockResolvedValue({ data: {} });
    alertsSvc.toggle_state_by_alert_id = vi.fn().mockResolvedValue({ data: { enabled: false } });
    alertsSvc.export_by_id = vi.fn().mockResolvedValue({ data: { name: "x" } });
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  // ── Row mapping ────────────────────────────────────────────────────────────

  it("carries the SLO id onto the mapped row", async () => {
    wrapper = await mountList([plainAlert(), sloAlert()]);

    const slo = rowOf(wrapper, "slo-alert-1");
    expect(slo.type).toBe("slo");
    expect(slo.slo_id).toBe("slo-123");

    // The non-SLO row must not sprout an SLO id, or every row would look like
    // an SLO alert to the containment checks below.
    expect(rowOf(wrapper, "plain-1").slo_id).toBeFalsy();
  });

  // ── Labelling ──────────────────────────────────────────────────────────────

  it("names the SLO the alert belongs to, in the row itself", async () => {
    wrapper = await mountList([sloAlert()]);

    const link = nameCell(wrapper, "slo-burn-alert").find(
      '[data-test="alert-list-slo-burn-alert-slo-link"]',
    );
    expect(link.exists()).toBe(true);
    expect(link.isVisible()).toBe(true);
    expect(link.text()).toContain("checkout-availability");
  });

  it("badges SLO rows, and only SLO rows", async () => {
    wrapper = await mountList([plainAlert(), sloAlert()]);

    const badge = nameCell(wrapper, "slo-burn-alert").find(
      '[data-test="alert-list-slo-burn-alert-slo-badge"]',
    );
    expect(badge.exists()).toBe(true);
    expect(badge.isVisible()).toBe(true);
    // Spelled out rather than compared against t(): a missing i18n key makes
    // t() echo the key back, which would make a key-to-key comparison pass.
    expect(badge.text()).toBe("SLO");

    const plain = nameCell(wrapper, "plain-alert");
    expect(plain.exists()).toBe(true);
    expect(plain.find('[data-test="alert-list-plain-alert-slo-badge"]').exists()).toBe(false);
    expect(plain.find('[data-test="alert-list-plain-alert-slo-link"]').exists()).toBe(false);
  });

  // Never blank: an unresolvable id is still an answer to "which SLO?", and it
  // is the only thing that makes the row diagnosable.
  it("degrades to the raw slo_id when the name cannot be resolved", async () => {
    sloSvc.list = vi.fn().mockResolvedValue({ data: { list: [] } });
    wrapper = await mountList([sloAlert()]);

    const label = wrapper.find('[data-test="alert-list-slo-burn-alert-slo-link"]');
    expect(label.exists()).toBe(true);
    expect(label.text()).toContain("slo-123");
  });

  it("degrades to the raw slo_id when the SLO list fetch fails", async () => {
    sloSvc.list = vi.fn().mockRejectedValue(new Error("boom"));
    wrapper = await mountList([sloAlert()]);

    expect(wrapper.find('[data-test="alert-list-slo-burn-alert-slo-link"]').text()).toContain(
      "slo-123",
    );
  });

  // A once-only latch that is armed by FAILURE turns one transient 5xx into
  // KSUIDs for the rest of the visit — and Refresh, the obvious thing to try,
  // would not fix it.
  it("retries the name lookup after a failed one", async () => {
    sloSvc.list = vi.fn().mockRejectedValue(new Error("boom"));
    wrapper = await mountList([sloAlert()]);
    expect(wrapper.find('[data-test="alert-list-slo-burn-alert-slo-link"]').text()).toContain(
      "slo-123",
    );

    sloSvc.list = vi.fn().mockResolvedValue({
      data: { list: [{ id: "slo-123", name: "checkout-availability" }] },
    });
    await (wrapper.vm as any).getAlertsFn(store, "default");
    await settle();

    expect(sloSvc.list).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="alert-list-slo-burn-alert-slo-link"]').text()).toContain(
      "checkout-availability",
    );
  });

  // `list_slos` is unpaginated, so ONE fetch resolves every row. Resolving per
  // row would put an N+1 on the alerts list.
  it("resolves every SLO name with a single fetch", async () => {
    wrapper = await mountList([
      sloAlert(),
      sloAlert({ alert_id: "slo-alert-2", name: "slo-slow-burn" }),
      sloAlert({
        alert_id: "slo-alert-3",
        name: "other-slo-alert",
        condition: {
          type: "slo",
          slo_condition: {
            slo_id: "slo-999",
            kind: "error_budget",
            operator: ">",
            critical: 50,
          },
        },
      }),
    ]);

    // Every row's id comes from ITS OWN condition, not from a constant.
    expect(rowOf(wrapper, "slo-alert-3").slo_id).toBe("slo-999");

    expect(sloSvc.list).toHaveBeenCalledTimes(1);
    // No folder scope: SLOs live in folders and an alert may sit in a different
    // one from its SLO, so a folder-scoped fetch would leave rows stuck on the
    // raw id for no reason. (`list(org, folder?)` — a falsy second arg means
    // "all folders" server-side.)
    expect(sloSvc.list.mock.calls[0][1]).toBeFalsy();

    // The one fetch has to serve every row, and a row whose id is not in the
    // response still shows the id.
    expect(wrapper.find('[data-test="alert-list-slo-slow-burn-slo-link"]').text()).toContain(
      "checkout-availability",
    );
    expect(wrapper.find('[data-test="alert-list-other-slo-alert-slo-link"]').text()).toContain(
      "slo-999",
    );
  });

  it("does not fetch SLO names when no row is an SLO alert", async () => {
    wrapper = await mountList([plainAlert()]);
    expect(sloSvc.list).not.toHaveBeenCalled();
  });

  // The whole push object, not `objectContaining`: `sloAlertEditRoute` returns
  // the same name and params plus `edit_alert`, so a loose matcher cannot tell
  // "show me this SLO" from "open this alert's editor". And exactly one push —
  // the row itself is clickable (`@row-click` → alertDetail), so a missing
  // `@click.stop` would navigate somewhere else entirely and still match.
  it("links to the SLO's own page, and does not open the alert editor", async () => {
    wrapper = await mountList([sloAlert()]);
    const push = vi.spyOn(router, "push").mockResolvedValue(undefined as any);

    await wrapper.find('[data-test="alert-list-slo-burn-alert-slo-link"]').trigger("click");
    await flushPromises();

    expect(push).toHaveBeenCalledTimes(1);
    const target = push.mock.calls[0][0] as any;
    expect(target.name).toBe("sloDetail");
    expect(target.params).toEqual({ slo_id: "slo-123" });
    expect(target.query?.edit_alert).toBeUndefined();
    push.mockRestore();
  });

  // `query_type = slo` with a NULL condition is representable in the table.
  // The row still has to render — and must not offer a link to nowhere.
  it("renders an SLO alert whose SLO cannot be determined, without a link", async () => {
    wrapper = await mountList([sloAlert({ condition: { type: "slo", slo_condition: null } })]);

    expect(wrapper.find('[data-test="alert-list-slo-burn-alert-slo-badge"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-list-slo-burn-alert-slo-link"]').exists()).toBe(false);
  });

  // ── Edit diversion (3.4) ───────────────────────────────────────────────────
  //
  // `sloAlertEditRoute` returns null for two unrelated situations — "not an SLO
  // alert" and "an SLO alert whose SLO cannot be resolved" — and only the first
  // may fall through to the generic editor. The second must be refused: the
  // generic form cannot represent an SLO alert, so saving from it either fails
  // forever or strips the SLO wiring.
  describe("edit diversion", () => {
    /** Only the ERROR toasts. The list fires a "loading alerts…" toast on every
     *  mount, so a bare `not.toHaveBeenCalled()` here would be testing that
     *  instead of the guard. */
    const errorToasts = () =>
      mockToast.mock.calls.map((c: any[]) => c[0]).filter((o: any) => o?.variant === "error");

    const clickEdit = async (w: any, alertName: string) => {
      const btn = w.find(`[data-test="alert-list-${alertName}-update-alert"]`);
      expect(btn.exists()).toBe(true);
      await btn.trigger("click");
      await flushPromises();
    };

    it("sends the edit action to the SLO page, not the generic editor", async () => {
      wrapper = await mountList([sloAlert()]);
      const push = vi.spyOn(router, "push").mockResolvedValue(undefined as any);

      await clickEdit(wrapper, "slo-burn-alert");

      expect(push).toHaveBeenCalledTimes(1);
      const target = push.mock.calls[0][0] as any;
      expect(target.name).toBe("sloDetail");
      expect(target.params).toEqual({ slo_id: "slo-123" });
      expect(target.query?.edit_alert).toBe("slo-alert-1");
      expect(errorToasts()).toEqual([]);
      push.mockRestore();
    });

    it("refuses the generic editor for an SLO alert whose SLO cannot be resolved", async () => {
      wrapper = await mountList([sloAlert({ condition: { type: "slo", slo_condition: null } })]);
      const push = vi.spyOn(router, "push").mockResolvedValue(undefined as any);

      await clickEdit(wrapper, "slo-burn-alert");

      expect(push).not.toHaveBeenCalled();
      // A missing i18n key makes t() echo the key back, so pin that it is
      // really translated before comparing against it.
      expect(i18n.global.t("alerts.sloAlertUnplaceable")).not.toBe("alerts.sloAlertUnplaceable");
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: i18n.global.t("alerts.sloAlertUnplaceable"),
        }),
      );
      push.mockRestore();
    });

    // The guard must not swallow ordinary alerts: they still reach the generic
    // editor, which this page opens by pushing `action=update` onto its own
    // route (a watcher then fetches and shows the form).
    it("still opens the generic editor for an ordinary alert", async () => {
      wrapper = await mountList([plainAlert()]);
      const push = vi.spyOn(router, "push").mockResolvedValue(undefined as any);

      await clickEdit(wrapper, "plain-alert");

      expect(errorToasts()).toEqual([]);
      expect(push).toHaveBeenCalledTimes(1);
      const target = push.mock.calls[0][0] as any;
      expect(target.name).toBe("alertList");
      expect(target.query).toMatchObject({ action: "update", alert_id: "plain-1" });
      push.mockRestore();
    });

    // ── The `action=update` deep link ────────────────────────────────────────
    //
    // `sloAlertRouting.ts`'s own docstring says the query param is "handled in
    // two independent places". Both go through `divertSloAlert`
    // (`AlertList.vue:1758`), called from the on-mount branch (`:1738`) and
    // from the `action` watcher (`:1977`) — the hard-reload / bookmark / Back
    // path. The row-button tests above exercise NEITHER: gutting
    // `divertSloAlert` entirely leaves them all green.
    describe("via the action=update deep link", () => {
      /** The SINGLE-ALERT GET shape. `getAlertById` feeds `divertSloAlert`
       *  from `get_by_alert_id`, whose body is the API `Alert` model
       *  (`query_condition`) — not the list item (`condition`). A list-shaped
       *  fixture here would test nothing. */
      const fetchedAlert = (queryCondition: any) => ({
        id: "slo-alert-1",
        name: "slo-burn-alert",
        stream_name: "",
        query_condition: queryCondition,
      });

      // `router` is a module singleton shared by every test in this file, and
      // these cases are the only ones that put a real query on it. Both
      // navigations are stubbed and the query is wiped afterwards — letting a
      // real `push`/`replace` through leaves the shared router on another route
      // and every later test in the file fails for an unrelated reason.
      let push: any;
      let replace: any;
      beforeEach(() => {
        push = vi.spyOn(router, "push").mockResolvedValue(undefined as any);
        replace = vi.spyOn(router, "replace").mockResolvedValue(undefined as any);
      });
      afterEach(() => {
        push.mockRestore();
        replace.mockRestore();
        router.currentRoute.value.query = {} as any;
      });

      const deepLink = async (fetched: any) => {
        const w = await mountBare([]);
        alertsSvc.get_by_alert_id = vi.fn().mockResolvedValue({ data: fetched });
        (w.vm as any).router.currentRoute.value.query = {
          action: "update",
          alert_id: fetched.id,
          // Written alongside action/alert_id when the editor is opened.
          name: "slo-burn-alert",
          // Carried so the refusal below can be shown to strip only the keys it
          // means to, rather than emptying the query.
          folder: "default",
          org_identifier: "default",
        };
        // The route object is not reactive in tests, so the `query.action`
        // watcher cannot be fired by the assignment above — drive its named
        // handler directly instead.
        await (w.vm as any).handleActionQuery("update");
        await settle();
        return w;
      };

      it("diverts to the SLO page instead of opening the editor", async () => {
        wrapper = await deepLink(
          fetchedAlert({ type: "slo", slo_condition: { slo_id: "slo-123" } }),
        );

        expect(push).toHaveBeenCalledWith(
          expect.objectContaining({ name: "sloDetail", params: { slo_id: "slo-123" } }),
        );
        expect((wrapper.vm as any).showAddAlertDialog).toBe(false);
      });

      it("refuses the editor for an SLO alert whose SLO cannot be resolved", async () => {
        wrapper = await deepLink(fetchedAlert({ type: "slo", slo_condition: null }));

        expect((wrapper.vm as any).showAddAlertDialog).toBe(false);
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            variant: "error",
            message: i18n.global.t("alerts.sloAlertUnplaceable"),
          }),
        );
      });

      // Refusing without clearing the query leaves the URL at
      // `?action=update&alert_id=<bad>` forever. The editor is opened by a
      // watcher on `query.action` ALONE, so the next edit of an ordinary alert
      // pushes `action=update` again, the watched value never changes, and the
      // editor silently never opens. Clearing it is what makes the refusal
      // recoverable rather than a dead end.
      it("clears the stale action so the next edit still opens the editor", async () => {
        wrapper = await deepLink(fetchedAlert({ type: "slo", slo_condition: null }));

        expect(replace).toHaveBeenCalled();
        const target = replace.mock.calls[replace.mock.calls.length - 1][0] as any;
        expect(target.name).toBe("alertList");
        expect(target.query?.action).toBeUndefined();
        expect(target.query?.alert_id).toBeUndefined();
        expect(target.query?.name).toBeUndefined();
        // Only the editor's own params. Emptying the query would drop the user
        // out of the folder they were looking at and lose the org.
        expect(target.query).toEqual({ folder: "default", org_identifier: "default" });
      });

      it("still opens the editor for an ordinary alert", async () => {
        wrapper = await deepLink({
          id: "plain-1",
          name: "plain-alert",
          stream_name: "default",
          query_condition: { type: "sql", sql: "select 1" },
        });

        expect(errorToasts()).toEqual([]);
        expect(replace).not.toHaveBeenCalled();
        expect((wrapper.vm as any).showAddAlertDialog).toBe(true);
      });
    });
  });

  // ── Containment (3.4) ──────────────────────────────────────────────────────

  it("disables Clone on an SLO row and says why", async () => {
    wrapper = await mountList([sloAlert()]);

    const cloneBtn = wrapper.find('[data-test="alert-list-slo-burn-alert-clone-alert"]');
    expect(cloneBtn.exists()).toBe(true);
    expect(cloneBtn.attributes("disabled")).toBeDefined();

    // A missing i18n key makes t() echo the key back, so pin that the key is
    // really translated before comparing against it.
    expect(i18n.global.t("alerts.sloCloneDisabled")).not.toBe("alerts.sloCloneDisabled");
    expect(tooltipContents(wrapper)).toContain(i18n.global.t("alerts.sloCloneDisabled"));
  });

  it("leaves Clone enabled on a normal alert row", async () => {
    wrapper = await mountList([plainAlert()]);

    const cloneBtn = wrapper.find('[data-test="alert-list-plain-alert-clone-alert"]');
    expect(cloneBtn.attributes("disabled")).toBeUndefined();
    expect(tooltipContents(wrapper)).not.toContain(i18n.global.t("alerts.sloCloneDisabled"));
  });

  // Defence in depth: the disabled attribute is a UI affordance, the guard is
  // what makes a keyboard shortcut or a stale handler harmless.
  it("refuses to open the clone dialog for an SLO row", async () => {
    wrapper = await mountList([sloAlert()]);

    await (wrapper.vm as any).duplicateAlert(rowOf(wrapper, "slo-alert-1"));
    await flushPromises();

    expect(wrapper.vm.showForm).toBe(false);
    expect(alertsSvc.get_by_alert_id).not.toHaveBeenCalled();
  });

  // The containment must key on "is an SLO alert", not on "has a resolvable
  // SLO". Gating on slo_id leaves the one row cloning would most obviously
  // corrupt — an SLO alert with no SLO — fully clonable.
  it("disables Clone on an SLO row whose SLO cannot be determined", async () => {
    wrapper = await mountList([sloAlert({ condition: { type: "slo", slo_condition: null } })]);

    const cloneBtn = wrapper.find('[data-test="alert-list-slo-burn-alert-clone-alert"]');
    expect(cloneBtn.attributes("disabled")).toBeDefined();

    await (wrapper.vm as any).duplicateAlert(rowOf(wrapper, "slo-alert-1"));
    await flushPromises();
    expect(wrapper.vm.showForm).toBe(false);
  });

  // The 3am action, and the only way to free a burn-window pair slot. A blanket
  // "disable actions on SLO rows" fix must fail this test.
  it("keeps the enable/disable toggle working on an SLO row", async () => {
    wrapper = await mountList([sloAlert()]);

    const toggle = wrapper.find('[data-test="alert-list-slo-burn-alert-pause-start-alert"]');
    expect(toggle.exists()).toBe(true);
    expect(toggle.attributes("disabled")).toBeUndefined();

    await toggle.trigger("click");
    await flushPromises();

    expect(alertsSvc.toggle_state_by_alert_id).toHaveBeenCalledWith(
      expect.anything(),
      "slo-alert-1",
      false,
      expect.anything(),
    );
  });

  // Through the REAL menu item, not the hidden keyboard-shortcut proxy: the
  // proxy exists unconditionally, so clicking it would pass even if the visible
  // Delete had been removed for SLO rows.
  it("keeps delete available on an SLO row", async () => {
    wrapper = await mountList([sloAlert()]);

    const item = wrapper.find('[data-test="alert-list-slo-burn-alert-delete-alert"]');
    expect(item.exists()).toBe(true);
    expect(item.attributes("disabled")).toBeUndefined();

    await item.trigger("click");
    await flushPromises();

    expect(wrapper.vm.confirmDelete).toBe(true);
    expect(wrapper.vm.selectedDelete.alert_id).toBe("slo-alert-1");
  });

  // Export stays on: import already rejects a dangling slo_id server-side.
  it("keeps export available on an SLO row", async () => {
    wrapper = await mountList([sloAlert()]);

    const item = wrapper.find('[data-test="alert-list-slo-burn-alert-export-alert"]');
    expect(item.exists()).toBe(true);
    expect(item.attributes("disabled")).toBeUndefined();

    await item.trigger("click");
    await flushPromises();

    expect(alertsSvc.export_by_id).toHaveBeenCalledWith(expect.anything(), "slo-alert-1");
  });

  // Manually running an evaluation is diagnostic, not a creation path — it is
  // in the same family as the enable/disable toggle and stays on.
  it("keeps the manual trigger available on an SLO row", async () => {
    alertsSvc.trigger_alert = vi.fn().mockResolvedValue({ data: {} });
    wrapper = await mountList([sloAlert()]);

    const item = wrapper.find('[data-test="alert-list-slo-burn-alert-trigger-alert"]');
    expect(item.exists()).toBe(true);
    expect(item.attributes("disabled")).toBeUndefined();

    await item.trigger("click");
    await flushPromises();

    expect(alertsSvc.trigger_alert).toHaveBeenCalledWith(
      store.state.selectedOrganization.identifier,
      "slo-alert-1",
      expect.anything(),
    );
  });

  // The folder cache short-circuits `getAlertsFn` entirely
  // (`getAlertsByFolderId`), so a name resolution wired only into the fetch
  // path leaves a revisited folder showing raw ids.
  it("resolves SLO names for rows served from the folder cache", async () => {
    wrapper = await mountList([sloAlert()]);
    expect(store.state.organizationData.allAlertsListByFolderId.default?.length).toBe(1);
    wrapper.unmount();

    sloSvc.list.mockClear();
    (alertsSvc.listByFolderId as any).mockClear();

    // Fresh component, cache already warm: no refetch of the alerts happens.
    wrapper = await mountBare([sloAlert()]);
    await (wrapper.vm as any).updateActiveFolderId("default");
    await settle();

    expect(alertsSvc.listByFolderId).not.toHaveBeenCalled();
    // A module-scoped "already fetched" flag would satisfy the link assertion
    // below while leaving names permanently stale — and shared across orgs.
    expect(sloSvc.list).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="alert-list-slo-burn-alert-slo-link"]').text()).toContain(
      "checkout-availability",
    );
  });
});
