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
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import PlaylistDialog from "./PlaylistDialog.vue";
import type { PlaylistDialogEntry } from "@/utils/dashboard/playlist";

const { listMock, copyMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  copyMock: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/services/dashboards", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, default: { ...actual.default, list: listMock } };
});

vi.mock("@/utils/clipboard", () => ({ copyToClipboard: copyMock }));

vi.mock("vue-router", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useRouter: () => ({
      resolve: ({ path, query }: { path: string; query: Record<string, string> }) => ({
        href: `/web${path}?${new URLSearchParams(query).toString()}`,
      }),
    }),
  };
});

const row = (id: string, title: string, folderId: string, folderName: string) => ({
  dashboard_id: id,
  title,
  folder_id: folderId,
  folder_name: folderName,
  version: 8,
  hash: "1",
});

const entries: PlaylistDialogEntry[] = [
  { dashboardId: "d1", folderId: "default", title: "Overview", folderName: "Default" },
  { dashboardId: "d2", folderId: "ops", title: "Payments", folderName: "Ops" },
];

const body = () => document.body;
const q = (testId: string) => body().querySelector<HTMLElement>(`[data-test="${testId}"]`);
const click = async (testId: string) => {
  q(testId)!.click();
  await flushPromises();
};
const itemTitles = () =>
  [...body().querySelectorAll('[data-test^="dashboard-playlist-item-"]')].map((li) =>
    li.textContent?.replace(/\s+/g, " ").trim(),
  );

describe("PlaylistDialog", () => {
  let wrapper: VueWrapper<any> | null = null;

  const mountDialog = async (props: Record<string, unknown> = {}) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = mount(PlaylistDialog, {
      props: { open: true, entries, ...props },
      attachTo: document.body,
      global: { plugins: [i18n, store, [VueQueryPlugin, { queryClient }]] },
    });
    await flushPromises();
    return wrapper;
  };

  beforeEach(() => {
    store.state.selectedOrganization = { ...store.state.selectedOrganization, identifier: "acme" };
    listMock.mockReset();
    copyMock.mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("lists the selected dashboards in order and keeps explanations behind info icons", async () => {
    await mountDialog();

    expect(q("dashboard-playlist-count")!.textContent).toContain("2 of 50");
    expect(itemTitles()[0]).toContain("Overview");
    expect(itemTitles()[1]).toContain("Payments");
    expect(itemTitles()[1]).toContain("Ops");
    expect(q("dashboard-playlist-summary")).toBeNull();
    expect(body().textContent).not.toContain("Each dashboard opens on its first tab");
    const tips = wrapper!.findAllComponents(OTooltip).map((tip) => String(tip.props("content")));
    expect(tips).toEqual(
      expect.arrayContaining([
        "Searches every folder; each result shows its folder",
        "Each dashboard opens on its first tab with its own variable defaults",
        "One range for all dashboards",
        "Shrinks panels to the screen height so nothing scrolls.",
      ]),
    );
  });

  it("reorders and removes rows, then opens with the edited order and settings", async () => {
    await mountDialog();

    await click("dashboard-playlist-down-0");
    expect(itemTitles()[0]).toContain("Payments");
    await click("dashboard-playlist-remove-1");
    expect(itemTitles()).toHaveLength(1);

    await click("dashboard-playlist-theme-dark");
    await click("o-dialog-primary-btn");

    const [[config]] = wrapper!.emitted("open") as any[];
    expect(config).toMatchObject({
      org: "acme",
      entries: [{ dashboardId: "d2", folderId: "ops" }],
      intervalSeconds: 60,
      slideIndex: 0,
      period: "1h",
      theme: "dark",
      fit: false,
    });
    expect(wrapper!.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("adds dashboards from any folder through the search and marks those already added", async () => {
    listMock.mockResolvedValue({
      data: {
        dashboards: [
          row("d2", "Payments", "ops", "Ops"),
          row("d9", "Revenue", "finance", "Finance"),
        ],
      },
    });
    await mountDialog();

    const input = body().querySelector<HTMLInputElement>(
      '[data-test="dashboard-playlist-search"] input',
    )!;
    input.value = "re";
    input.dispatchEvent(new Event("input"));
    await new Promise((resolve) => setTimeout(resolve, 450));
    await flushPromises();

    expect(listMock).toHaveBeenCalledWith(0, 100, "name", false, "", "acme", "", "re");
    expect(q("dashboard-playlist-result-d2")!.textContent).toContain("Added");
    await click("dashboard-playlist-add-d9");

    expect(itemTitles()).toHaveLength(3);
    expect(itemTitles()[2]).toContain("Revenue");
    expect(itemTitles()[2]).toContain("Finance");
  });

  it("stops adding at 50 dashboards", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      dashboardId: `d${i}`,
      folderId: "default",
      title: `Dash ${i}`,
      folderName: "Default",
    }));
    await mountDialog({ entries: many });

    expect(q("dashboard-playlist-count")!.textContent).toContain("50 of 50");
    const input = body().querySelector<HTMLInputElement>(
      '[data-test="dashboard-playlist-search"] input',
    )!;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toContain("50 max");
  });

  it("copies a TV player link that encodes the whole playlist", async () => {
    await mountDialog();
    await click("o-dialog-secondary-btn");

    const [href] = copyMock.mock.calls[0];
    const url = new URL(href);
    expect(url.pathname).toBe("/web/dashboards/tv");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      org_identifier: "acme",
      playlist: "d1:default,d2:ops",
      interval: "1m",
      slide: "1",
      period: "1h",
    });
  });

  it("confirms the copy on the button itself", async () => {
    await mountDialog();
    await click("o-dialog-secondary-btn");
    expect(q("o-dialog-secondary-btn")!.textContent).toContain("Copied");
  });

  it("offers short slides and labels the cross-folder add", async () => {
    await mountDialog();
    expect(body().textContent).toContain("Add dashboards");
    expect(q("dashboard-playlist-add-info")).not.toBeNull();
    const values = (wrapper!.findComponent({ name: "OSelect" }).props("options") as any[]).map(
      (option) => option.value,
    );
    expect(values.slice(0, 4)).toEqual([10, 15, 20, 30]);
  });

  it("disables both actions while the playlist is empty", async () => {
    await mountDialog({ entries: [] });
    expect(q("dashboard-playlist-empty")).not.toBeNull();
    expect((q("o-dialog-primary-btn") as HTMLButtonElement).disabled).toBe(true);
    expect((q("o-dialog-secondary-btn") as HTMLButtonElement).disabled).toBe(true);
  });

  it("names rows that carry only ids from their folder and flags gone ones", async () => {
    listMock.mockResolvedValue({
      data: { dashboards: [row("d1", "Overview", "default", "Default")] },
    });
    await mountDialog({
      entries: [
        { dashboardId: "d1", folderId: "default" },
        { dashboardId: "gone", folderId: "default" },
      ],
    });
    await flushPromises();

    expect(itemTitles()[0]).toContain("Overview");
    expect(q("dashboard-playlist-missing-1")!.textContent).toContain("Not found");
  });
});
