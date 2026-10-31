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

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ search: vi.fn(), push: vi.fn(), toast: vi.fn() }));

vi.mock("@/services/search", () => ({ default: { search: h.search } }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("vuex", () => ({
  useStore: () => ({
    state: { selectedOrganization: { identifier: "org1" }, zoConfig: {} },
  }),
}));
vi.mock("@/types/i18n", () => ({ useI18nTyped: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: h.toast }));

import useSessionHeatmap from "./useSessionHeatmap";
import { PA_ROUTES } from "@/utils/rum/productAnalyticsRoutes";

describe("useSessionHeatmap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.push.mockResolvedValue(undefined);
  });

  it("opens the heatmap on the session's first page view in the same app", async () => {
    h.search.mockResolvedValue({ data: { hits: [{ app: "web", url: "https://x.test/home" }] } });
    const { openSessionHeatmap } = useSessionHeatmap();

    await openSessionHeatmap("s1", Date.now() * 1000);

    expect(String(h.search.mock.calls[0][0].query.query.sql)).toContain("session_id = 's1'");
    const target = h.push.mock.calls[0][0];
    expect(target.name).toBe(PA_ROUTES.heatmaps);
    expect(target.query).toMatchObject({
      org_identifier: "org1",
      app: "web",
      page_url: "https://x.test/home",
    });
  });

  it("reaches back to an old session so its page is inside the window", async () => {
    h.search.mockResolvedValue({ data: { hits: [{ app: "web", url: "/p" }] } });
    const old = (Date.now() - 30 * 86_400_000) * 1000;
    await useSessionHeatmap().openSessionHeatmap("s1", old);

    expect(Number(h.push.mock.calls[0][0].query.from)).toBe(old);
  });

  it("warns and stays put when the session has no page view", async () => {
    h.search.mockResolvedValue({ data: { hits: [] } });
    await useSessionHeatmap().openSessionHeatmap("s1", 1);

    expect(h.push).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
  });

  it("reports a failed lookup without navigating", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.search.mockRejectedValue(new Error("boom"));
    await useSessionHeatmap().openSessionHeatmap("s1", 1);

    expect(h.push).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });
});
