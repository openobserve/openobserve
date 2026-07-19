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

// The Danger Zone needs `isCloud === "true"` to render at all, and aws-exports is
// mocked at module scope — so it cannot share General.spec.ts's non-cloud mock and
// lives in its own file.
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import General from "./General.vue";
import i18n, { loadLocaleMessages } from "@/locales";
import { createRouter, createWebHistory } from "vue-router";

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
  useToast: () => ({ toast: vi.fn(), toasts: [] }),
}));
vi.mock("@/services/settings", () => ({ default: {} }));
vi.mock("@/services/config", () => ({ default: { get_config: vi.fn() } }));
vi.mock("@/composables/useLoading", () => ({
  useLoading: (fn: Function) => ({ execute: fn, isLoading: { value: false } }),
}));
vi.mock("dompurify", () => ({ default: { sanitize: vi.fn((t) => t) } }));

// isCloud gate must be on for the Danger Zone to render at all.
vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "true", isCloud: "true" },
}));

const summarySpy = vi.fn().mockResolvedValue({
  data: {
    total_dashboards: 32,
    streams: { num_streams: 18, total_storage_size: 4.2 * 1024 * 1024 },
  },
});
vi.mock("@/services/organizations", () => ({
  default: {
    post_organization_settings: vi.fn(),
    get_organization_summary: (...a: any[]) => summarySpy(...a),
  },
}));

// Default: two humans + one service account -> "Affects 2 members", caller is an
// admin. Individual tests override to exercise the role gate.
const ADMIN_MEMBERS = [
  { email: "me@o2.ai", role: "admin" },
  { email: "other@o2.ai", role: "member" },
  { email: "svc@o2.ai", role: "admin", is_system: true },
];
const orgUsersSpy = vi.fn();
vi.mock("@/services/users", () => ({
  default: { orgUsers: (...a: any[]) => orgUsersSpy(...a) },
}));

const mockStore = {
  state: {
    theme: "light",
    defaultThemeColors: { light: "#3F7994", dark: "#5B9FBE" },
    tempThemeColors: { light: null, dark: null },
    selectedOrganization: { identifier: "test-org", label: "Acme Production" },
    userInfo: { email: "me@o2.ai" },
    organizationData: { organizationSettings: { scrape_interval: 30 } },
    zoConfig: {
      meta_org: "test-org",
      custom_logo_text: "Test Logo Text",
      custom_logo_img: "base64imagedata",
    },
    organizations: [{ identifier: "test-org", type: "regular" }],
  },
  dispatch: vi.fn(),
  commit: vi.fn(),
};

vi.mock("vuex", () => ({ useStore: () => mockStore }));

const mountGeneral = async () => {
  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: "/", component: General }],
  });
  await router.push("/");
  const wrapper = mount(General, {
    global: { plugins: [i18n, router], mocks: { $store: mockStore } },
  });
  await flushPromises();
  return wrapper;
};

describe("General settings Danger Zone", () => {
  beforeEach(() => {
    summarySpy.mockClear();
    orgUsersSpy.mockReset();
    orgUsersSpy.mockResolvedValue({ data: { data: ADMIN_MEMBERS } });
  });

  // The backend gate is `is_root_user(email) || role-in-this-org == Admin`
  // (initiate_org_deletion). The UI must not offer the action to anyone the API
  // would reject with a 403.
  describe("who may see it", () => {
    const zone = (w: any) =>
      w.find('[data-test="general-settings-danger-zone"]').exists();

    it("shows it to an admin of this org", async () => {
      expect(zone(await mountGeneral())).toBe(true);
    });

    it.each(["editor", "viewer", "user", "member"])(
      "hides it from a %s",
      async (role) => {
        orgUsersSpy.mockResolvedValue({
          data: { data: [{ email: "me@o2.ai", role }] },
        });
        expect(zone(await mountGeneral())).toBe(false);
      },
    );

    it("hides it when the caller is not in the member list at all", async () => {
      orgUsersSpy.mockResolvedValue({
        data: { data: [{ email: "someone-else@o2.ai", role: "admin" }] },
      });
      expect(zone(await mountGeneral())).toBe(false);
    });

    // Fails closed: a non-admin is typically denied the user list outright, and an
    // unreadable role must never be treated as permission.
    it("hides it when the member list cannot be read", async () => {
      orgUsersSpy.mockRejectedValue({ response: { status: 403 } });
      expect(zone(await mountGeneral())).toBe(false);
    });
  });

  // Every string in the panel resolves through t()/i18n-t, so a non-en locale must
  // render fully translated rather than falling back to English. Guards against a
  // repeat of #13092, which added these keys to en.json only.
  describe("localisation", () => {
    afterEach(() => {
      i18n.global.locale.value = "en";
    });

    it.each([
      ["zh-cn", "危险区域", "仅限管理员"],
      ["ja", "危険ゾーン", "管理者のみ"],
      ["de", "Gefahrenzone", "Nur Administratoren"],
    ])("renders the panel in %s", async (locale, header, ownerFact) => {
      // Only en-us is bundled; every other locale is a lazy chunk. main.ts awaits
      // this before mounting, so mirror that here rather than assuming the
      // messages are already registered.
      await loadLocaleMessages(locale);
      i18n.global.locale.value = locale;
      const wrapper = await mountGeneral();
      const text = wrapper
        .find('[data-test="general-settings-danger-zone"]')
        .text();

      expect(text).toContain(header);
      expect(text).toContain(ownerFact);
      // No English fallback leaking through.
      expect(text).not.toContain("Danger Zone");
      expect(text).not.toContain("Admins only");
      // The plural must still resolve after translation.
      expect(text).not.toContain("|");
      expect(text).not.toContain("{n}");
    });

    it("resolves the member plural in a locale with no plural distinction", async () => {
      await loadLocaleMessages("zh-cn");
      i18n.global.locale.value = "zh-cn";
      const wrapper = await mountGeneral();
      expect(
        wrapper.find('[data-test="general-settings-delete-org-fact-members"]').text(),
      ).toContain("影响 2 位成员");
    });
  });

  it("renders one consequence tile per fact", async () => {
    const wrapper = await mountGeneral();
    expect(
      wrapper.find('[data-test="general-settings-danger-zone"]').exists(),
    ).toBe(true);
    expect(
      wrapper.findAll('[data-test^="general-settings-delete-org-fact-"]'),
    ).toHaveLength(4);
  });

  it("names the org in the description and counts only human members", async () => {
    const wrapper = await mountGeneral();
    const text = wrapper
      .find('[data-test="general-settings-danger-zone"]')
      .text();

    expect(text).toContain("Acme Production");
    // Two humans + one service account -> service account is not a member.
    expect(text).toContain("Affects 2 members");
    // The plural form must resolve, not leak its raw message.
    expect(text).not.toContain("|");
    expect(text).not.toContain("{n}");
  });

  it("states the grace period without inventing a duration", async () => {
    const wrapper = await mountGeneral();
    const text = wrapper
      .find('[data-test="general-settings-delete-org-fact-grace"]')
      .text();

    expect(text).toContain("Grace period");
    // The real value lives in enterprise config and is not exposed to the
    // frontend, so no day count may appear here.
    expect(text).not.toMatch(/\d+\s*(day|days)/i);
  });

  // initiate_org_deletion allows root or UserRole::Admin in this org — and there
  // is no Owner role in UserRole at all. The copy must name the real requirement,
  // otherwise it invents a role the user cannot find anywhere in IAM.
  it("describes the permission as Admin, not a non-existent Owner role", async () => {
    const wrapper = await mountGeneral();
    const text = wrapper
      .find('[data-test="general-settings-delete-org-fact-owner"]')
      .text();

    expect(text).toMatch(/admin/i);
    expect(text).not.toMatch(/owner/i);
  });

  // Resurrect is _meta-only, and org_blocking locks the actor out of their own
  // org the moment deletion starts — so the panel must never promise the reader
  // a self-service restore.
  it("does not promise a self-service restore the API cannot deliver", async () => {
    const wrapper = await mountGeneral();
    const text = wrapper
      .find('[data-test="general-settings-danger-zone"]')
      .text();

    expect(text).not.toMatch(/you can (cancel and )?restore/i);
    expect(text).toMatch(/support/i);
  });

  it("defers the expensive /summary call until the confirm dialog opens", async () => {
    const wrapper = await mountGeneral();
    expect(summarySpy).not.toHaveBeenCalled();

    await wrapper
      .find('[data-test="general-settings-delete-org-btn"]')
      .trigger("click");
    await flushPromises();

    expect(summarySpy).toHaveBeenCalledTimes(1);
    expect((wrapper.vm as any).orgScope).toBe(
      "32 dashboards · 18 streams · 4.20 TB data",
    );
  });

  it("keeps the delete flow usable when /summary fails", async () => {
    summarySpy.mockRejectedValueOnce(new Error("boom"));
    const wrapper = await mountGeneral();

    await wrapper
      .find('[data-test="general-settings-delete-org-btn"]')
      .trigger("click");
    await flushPromises();

    expect((wrapper.vm as any).confirmDeleteOrg).toBe(true);
    expect((wrapper.vm as any).orgScope).toBe("");
    expect((wrapper.vm as any).orgScopeLoading).toBe(false);
  });
});
