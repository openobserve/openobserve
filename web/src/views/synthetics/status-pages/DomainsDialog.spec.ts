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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import enLocale from "@/locales/languages/en-US.json";
import type { DomainServingState, StatusPageDomain } from "@/services/status_pages";

// ── Mocks (hoisted by Vitest) ──────────────────────────────────────────────

// `t` resolves real en-US text, so specs assert what a customer reads and a missing key
// throws. The factory runs before static imports, so it loads the locale dynamically.
vi.mock("vue-i18n", async () => {
  const en = (await import("@/locales/languages/en-US.json")).default;
  const t = (key: string, named: Record<string, unknown> = {}) => {
    const message = key
      .split(".")
      .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
    if (typeof message !== "string") throw new Error(`missing locale key ${key}`);
    return message.replace(/\{(\w+)\}/g, (_, name) => String(named[name] ?? `{${name}}`));
  };
  return { useI18n: vi.fn(() => ({ t })) };
});

const {
  mockCopyToClipboard,
  mockListDomains,
  mockCreateDomain,
  mockDeleteDomain,
  mockVerifyDomain,
  mockToast,
  mockConfig,
  mockStore,
  confirmMock,
} = vi.hoisted(() => ({
  mockCopyToClipboard: vi.fn(),
  mockListDomains: vi.fn(),
  mockCreateDomain: vi.fn(),
  mockDeleteDomain: vi.fn(),
  mockVerifyDomain: vi.fn(),
  mockToast: vi.fn(() => vi.fn()),
  mockConfig: { isCloud: "true", freePlan: "free" } as Record<string, string>,
  mockStore: {
    state: {
      timezone: "UTC",
      selectedOrganization: { subscription_type: "pay-as-you-go" } as Record<string, string>,
    },
  },
  confirmMock: vi.fn(),
}));

vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: mockCopyToClipboard,
}));

vi.mock("@/services/status_pages", () => ({
  default: {
    listDomains: mockListDomains,
    createDomain: mockCreateDomain,
    deleteDomain: mockDeleteDomain,
    verifyDomain: mockVerifyDomain,
  },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

vi.mock("@/aws-exports", () => ({
  default: mockConfig,
}));

// ── Component under test ───────────────────────────────────────────────────

import DomainsDialog from "./DomainsDialog.vue";

// ── Helpers ────────────────────────────────────────────────────────────────

const EXPIRES_AT = 1_700_600_000_000_000; // 2023-11-21 20:53 UTC
const PROOF_FAILED_SINCE = 1_700_000_000_000_000; // 2023-11-14 22:13 UTC

// The en-US text of a key, built the same way the mocked `t` builds it.
function msg(key: string, named: Record<string, unknown> = {}): string {
  const message = key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      enLocale,
    );
  return String(message).replace(/\{(\w+)\}/g, (_, name) => String(named[name] ?? `{${name}}`));
}

function makeDomain(overrides: Partial<StatusPageDomain> = {}): StatusPageDomain {
  return {
    id: "dom-1",
    domain: "status.brandname.com",
    verification_state: 0,
    verification_failure_reason: null,
    verified_at: null,
    last_checked_at: null,
    created_at: 1_700_000_000_000_000,
    txt_name: "_o2-verify.status.brandname.com",
    verification_token: "o2v_abc123",
    cname_target: null,
    app_host: null,
    is_holder: false,
    serving_state: "pending",
    reason: null,
    warning: null,
    warning_at: null,
    expires_at: EXPIRES_AT,
    released_at: null,
    certificate_expires_at: null,
    next_action_at: null,
    state_computed_at: null,
    evidence: {
      proof_checked_at: null,
      proof_failed_since: null,
      dns_checked_at: null,
      probe_checked_at: null,
      ca_validated_at: null,
      probe_mode: null,
    },
    can_check_again: false,
    acts: null,
    ...overrides,
  };
}

// A claim that holds its hostname: ownership proven, nothing about serving.
function makeHolder(overrides: Partial<StatusPageDomain> = {}): StatusPageDomain {
  return makeDomain({
    verification_state: 1,
    verified_at: 1_700_000_000_000_000,
    is_holder: true,
    serving_state: "verified",
    reason: "proxy_mode",
    expires_at: null,
    ...overrides,
  });
}

const ODialogStub = {
  template: "<div :data-test=\"$attrs['data-test']\"><slot /></div>",
  props: ["open", "size", "title", "secondaryButtonLabel"],
};

const OButtonStub = {
  template:
    '<button :data-test="$attrs[\'data-test\']" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  props: ["variant", "size", "iconLeft", "disabled", "title"],
  emits: ["click"],
};

const OInputStub = {
  template:
    '<input :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  props: ["modelValue", "label", "placeholder", "disabled"],
  emits: ["update:modelValue"],
};

const OBadgeStub = {
  template: '<span class="obadge-stub" :data-variant="variant"><slot /></span>',
  props: ["variant", "size"],
};

const OBannerStub = {
  template: '<div :data-test="$attrs[\'data-test\']" :data-variant="variant"><slot /></div>',
  props: ["variant", "icon", "dense", "content"],
};

const OCodeStub = {
  template: "<code :data-test=\"$attrs['data-test']\"><slot /></code>",
  props: ["block", "copyable", "truncate"],
};

const OTooltipStub = {
  template: '<span class="otooltip-stub" :data-content="content"><slot /></span>',
  props: ["content", "side"],
};

// A router link renders as an anchor carrying its route, so the spec can read the target.
const RouterLinkStub = {
  template: '<a :data-to="JSON.stringify(to)"><slot /></a>',
  props: ["to"],
};

const PLANS_ROUTE = JSON.stringify({ name: "plans", query: { org_identifier: "org-1" } });

function makeWrapper() {
  return mount(DomainsDialog, {
    props: {
      open: true,
      orgIdentifier: "org-1",
      pageId: "page-1",
      pageName: "Acme Status",
    },
    global: {
      stubs: {
        ODialog: ODialogStub,
        OButton: OButtonStub,
        OInput: OInputStub,
        OBadge: OBadgeStub,
        OBanner: OBannerStub,
        OCode: OCodeStub,
        OTooltip: OTooltipStub,
        RouterLink: RouterLinkStub,
        OSpinner: true,
        OIcon: true,
      },
    },
  });
}

const ALL_STATES: DomainServingState[] = [
  "pending",
  "verified",
  "waiting_for_dns",
  "setting_up",
  "ready",
  "serving",
  "delayed",
  "not_serving",
  "expired",
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe("DomainsDialog", () => {
  let wrapper: VueWrapper;

  const find = (testId: string) => wrapper.find(`[data-test="${testId}"]`);
  const exists = (testId: string) => find(testId).exists();

  async function mountWith(...domains: StatusPageDomain[]) {
    mockListDomains.mockResolvedValue({ data: domains });
    wrapper = makeWrapper();
    await flushPromises();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockListDomains.mockResolvedValue({ data: [] });
    mockConfig.isCloud = "true";
    mockStore.state.selectedOrganization = { subscription_type: "pay-as-you-go" };
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("TXT record", () => {
    const WITH_RECORD: [string, Partial<StatusPageDomain>][] = [
      ["pending", { serving_state: "pending", reason: "record_missing" }],
      ["verified, cloud_not_enabled", { serving_state: "verified", reason: "cloud_not_enabled" }],
      ["verified, proxy_mode", { serving_state: "verified", reason: "proxy_mode" }],
      ["not_serving", { serving_state: "not_serving", reason: "plan_required" }],
    ];

    it.each(WITH_RECORD)(
      "shows the name, the value, both copy buttons and the keep line for %s",
      async (_label, overrides) => {
        await mountWith(makeHolder(overrides));

        const values = wrapper.findAll("code").map((c) => c.text());
        expect(values).toContain("_o2-verify.status.brandname.com");
        expect(values).toContain("o2v_abc123");
        expect(exists("status-page-domain-copy-txt-name-dom-1")).toBe(true);
        expect(exists("status-page-domain-copy-txt-value-dom-1")).toBe(true);
        expect(find("status-page-domain-keep-record-dom-1").text()).toBe(
          msg("statusPages.domains.keepRecord"),
        );
      },
    );

    it("shows no record, no copy button and no keep line for an expired claim", async () => {
      await mountWith(makeDomain({ serving_state: "expired", released_at: EXPIRES_AT }));

      expect(wrapper.findAll("code")).toHaveLength(0);
      expect(exists("status-page-domain-copy-txt-name-dom-1")).toBe(false);
      expect(exists("status-page-domain-copy-txt-value-dom-1")).toBe(false);
      expect(exists("status-page-domain-keep-record-dom-1")).toBe(false);
    });

    it("copies the TXT name through the shared clipboard helper", async () => {
      await mountWith(makeDomain());

      await find("status-page-domain-copy-txt-name-dom-1").trigger("click");

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "_o2-verify.status.brandname.com",
        expect.any(Function),
        expect.objectContaining({ successMessage: expect.anything() }),
      );
    });

    it("copies the TXT value through the shared clipboard helper", async () => {
      await mountWith(makeDomain());

      await find("status-page-domain-copy-txt-value-dom-1").trigger("click");

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "o2v_abc123",
        expect.any(Function),
        expect.objectContaining({ successMessage: expect.anything() }),
      );
    });

    it("renders the record for a freshly claimed domain after the list reloads", async () => {
      mockListDomains.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({
        data: [makeDomain()],
      });
      mockCreateDomain.mockResolvedValue({
        data: { id: "dom-1", domain: "status.brandname.com" },
      });
      wrapper = makeWrapper();
      await flushPromises();

      await find("status-page-domain-input").setValue("status.brandname.com");
      await find("status-page-domain-add-btn").trigger("click");
      await flushPromises();

      expect(mockCreateDomain).toHaveBeenCalledWith("org-1", "page-1", "status.brandname.com");
      expect(wrapper.findAll("code").map((c) => c.text())).toContain("o2v_abc123");
    });
  });

  describe("pending", () => {
    const REASONS: [string, string][] = [
      ["record_missing", "statusPages.domains.reason.recordMissing"],
      ["value_mismatch", "statusPages.domains.reason.valueMismatch"],
      ["dns_lookup_failed", "statusPages.domains.reason.dnsLookupFailed"],
      ["held_by_another_org", "statusPages.domains.reason.heldByAnotherOrg"],
      ["proof_lost", "statusPages.domains.reason.proofLost"],
    ];

    it.each(REASONS)("renders its own line for %s", async (reason, key) => {
      await mountWith(makeDomain({ reason }));

      expect(find("status-page-domain-reason-dom-1").text()).toBe(msg(key));
    });

    it("gives each of the five reasons a different line", async () => {
      const lines = new Set(REASONS.map(([, key]) => msg(key)));

      expect(lines.size).toBe(5);
    });

    it("renders no reason line when the reason is null", async () => {
      await mountWith(makeDomain({ reason: null }));

      expect(exists("status-page-domain-reason-dom-1")).toBe(false);
    });

    it("renders no reason line for a reason this client does not know", async () => {
      await mountWith(makeDomain({ reason: "something_new" }));

      expect(exists("status-page-domain-reason-dom-1")).toBe(false);
    });

    it("names the _o2-verify step when another organization holds the domain", async () => {
      await mountWith(makeDomain({ reason: "held_by_another_org" }));

      const line = find("status-page-domain-reason-dom-1").text();
      expect(line).toContain("_o2-verify");
      expect(line).toContain("ask the other organization to release");
    });

    it("gives the time the proof was lost from the evidence", async () => {
      await mountWith(
        makeDomain({
          reason: "proof_lost",
          evidence: { ...makeDomain().evidence, proof_failed_since: PROOF_FAILED_SINCE },
        }),
      );

      expect(find("status-page-domain-reason-dom-1").text()).toBe(
        msg("statusPages.domains.reason.proofLostSince", { time: "2023-11-14 22:13" }),
      );
    });

    it("shows the date the claim expires", async () => {
      await mountWith(makeDomain());

      expect(find("status-page-domain-expires-dom-1").text()).toBe(
        msg("statusPages.domains.expiresAt", { date: "2023-11-21 20:53" }),
      );
    });

    it("shows no expiry line without an expiry time", async () => {
      await mountWith(makeDomain({ expires_at: null }));

      expect(exists("status-page-domain-expires-dom-1")).toBe(false);
    });

    it("badges the claim Pending", async () => {
      await mountWith(makeDomain());

      expect(find("status-page-domain-state-dom-1").text()).toBe("Pending");
    });
  });

  describe("verified", () => {
    it("tells a Cloud customer the region is being set up and that nothing is needed", async () => {
      await mountWith(makeHolder({ reason: "cloud_not_enabled" }));

      expect(find("status-page-domain-state-dom-1").text()).toBe("Verified");
      expect(find("status-page-domain-reason-dom-1").text()).toBe(
        "Custom domains are being set up for this region. Your claim is kept. You do not need to do anything.",
      );
    });

    it("tells a self-hosted customer to point the domain at their reverse proxy", async () => {
      await mountWith(makeHolder({ reason: "proxy_mode" }));

      expect(find("status-page-domain-state-dom-1").text()).toBe("Verified");
      expect(find("status-page-domain-reason-dom-1").text()).toBe(
        "Point this domain at your reverse proxy. OpenObserve cannot check whether it serves.",
      );
    });

    it("warns about a missing TXT record on proxy_mode only", async () => {
      await mountWith(makeHolder({ reason: "proxy_mode", warning: "txt_missing" }));

      const warning = find("status-page-domain-warning-dom-1");
      expect(warning.exists()).toBe(true);
      expect(warning.attributes("data-variant")).toBe("warning");
      expect(warning.text()).toBe(msg("statusPages.domains.txtMissingWarning"));
    });

    it("shows no warning on proxy_mode when the record is present", async () => {
      await mountWith(makeHolder({ reason: "proxy_mode", warning: null }));

      expect(exists("status-page-domain-warning-dom-1")).toBe(false);
    });

    it("shows no warning on cloud_not_enabled even if txt_missing is set", async () => {
      await mountWith(makeHolder({ reason: "cloud_not_enabled", warning: "txt_missing" }));

      expect(exists("status-page-domain-warning-dom-1")).toBe(false);
    });

    it("shows no warning on a pending claim carrying txt_missing", async () => {
      await mountWith(makeDomain({ warning: "txt_missing" }));

      expect(exists("status-page-domain-warning-dom-1")).toBe(false);
    });

    it("offers no verify action, and keeps the release action", async () => {
      await mountWith(makeHolder());

      expect(exists("status-page-domain-verify-dom-1")).toBe(false);
      expect(exists("status-page-domain-delete-dom-1")).toBe(true);
    });
  });

  describe("not_serving", () => {
    it("asks for a paid plan on plan_required, links to billing and keeps the release action", async () => {
      await mountWith(makeHolder({ serving_state: "not_serving", reason: "plan_required" }));

      expect(find("status-page-domain-state-dom-1").text()).toBe("Not serving");
      expect(find("status-page-domain-reason-dom-1").text()).toContain(
        "Custom domains need a paid plan. Upgrade to serve this domain again.",
      );
      expect(exists("status-page-domain-delete-dom-1")).toBe(true);

      const link = find("status-page-domain-upgrade-btn-dom-1");
      expect(link.element.tagName).toBe("A");
      expect(link.attributes("data-to")).toBe(PLANS_ROUTE);
    });

    it.each([
      ["org_blocked", "statusPages.domains.reason.orgBlocked"],
      ["not_licensed", "statusPages.domains.reason.notLicensed"],
    ])("renders the %s reason with no billing link", async (reason, key) => {
      await mountWith(makeHolder({ serving_state: "not_serving", reason }));

      expect(find("status-page-domain-reason-dom-1").text()).toBe(msg(key));
      expect(exists("status-page-domain-upgrade-btn-dom-1")).toBe(false);
    });
  });

  describe("expired", () => {
    beforeEach(async () => {
      await mountWith(makeDomain({ serving_state: "expired", released_at: EXPIRES_AT }));
    });

    it("renders the sentence under an Expired badge", () => {
      expect(find("status-page-domain-state-dom-1").text()).toBe("Expired");
      expect(find("status-page-domain-expired-dom-1").text()).toBe("Expired. Add it again.");
    });

    it("offers no verify and no delete action", () => {
      expect(exists("status-page-domain-verify-dom-1")).toBe(false);
      expect(exists("status-page-domain-delete-dom-1")).toBe(false);
    });
  });

  describe("an unknown serving_state", () => {
    it("renders a neutral badge with the raw state name, no banner and no reason", async () => {
      await mountWith(makeDomain({ serving_state: "warming_up" as DomainServingState }));

      const badge = find("status-page-domain-state-dom-1");
      expect(badge.text()).toBe("warming_up");
      expect(badge.attributes("data-variant")).toBe("default-soft");
      expect(exists("status-page-domain-warning-dom-1")).toBe(false);
      expect(exists("status-page-domain-reason-dom-1")).toBe(false);
    });

    it("does not throw for any state of the C7 contract", async () => {
      for (const state of ALL_STATES) {
        mockListDomains.mockResolvedValue({ data: [makeDomain({ serving_state: state })] });
        const w = makeWrapper();
        await flushPromises();
        expect(w.find('[data-test="status-page-domain-row-dom-1"]').exists()).toBe(true);
        w.unmount();
      }
    });
  });

  describe("what the dialog never says", () => {
    it.each(ALL_STATES)(
      "renders no serving banner and no serving sentence in %s",
      async (state) => {
        await mountWith(
          makeDomain({ serving_state: state, reason: "proxy_mode", warning: "txt_missing" }),
          makeDomain({ id: "dom-2", serving_state: state, reason: "cloud_not_enabled" }),
        );

        expect(wrapper.html()).not.toContain("status-page-domain-serving-");
        expect(wrapper.text().toLowerCase()).not.toContain("serves your status page");
      },
    );

    it("says nothing of serving for a verified claim", async () => {
      await mountWith(makeHolder());

      expect(wrapper.html()).not.toContain("status-page-domain-serving-");
      expect(wrapper.text().toLowerCase()).not.toContain("serves your status page");
    });
  });

  describe("verify now", () => {
    it.each(ALL_STATES)("is offered for %s only when pending", async (state) => {
      await mountWith(makeDomain({ serving_state: state }));

      expect(exists("status-page-domain-verify-dom-1")).toBe(state === "pending");
    });

    it("replaces the row with the view the server returns", async () => {
      await mountWith(makeDomain({ reason: "record_missing" }));
      mockVerifyDomain.mockResolvedValue({ data: makeHolder({ reason: "proxy_mode" }) });

      await find("status-page-domain-verify-dom-1").trigger("click");
      await flushPromises();

      expect(mockVerifyDomain).toHaveBeenCalledWith("org-1", "dom-1");
      expect(find("status-page-domain-state-dom-1").text()).toBe("Verified");
      expect(find("status-page-domain-reason-dom-1").text()).toBe(
        msg("statusPages.domains.reason.proxyMode"),
      );
      expect(exists("status-page-domain-verify-dom-1")).toBe(false);
      expect(exists("status-page-domain-expires-dom-1")).toBe(false);
    });
  });

  describe("CNAME instruction", () => {
    it("is absent while cname_target is null", async () => {
      await mountWith(makeDomain({ cname_target: null }));

      expect(exists("status-page-domain-cname-dom-1")).toBe(false);
    });

    it("names the target when cname_target is set", async () => {
      await mountWith(makeDomain({ cname_target: "abc123.domains.example.com" }));

      expect(find("status-page-domain-cname-dom-1").text()).toBe(
        msg("statusPages.domains.cnameInstruction", {
          domain: "status.brandname.com",
          target: "abc123.domains.example.com",
        }),
      );
    });
  });

  describe("adding a domain", () => {
    const addButton = () => find("status-page-domain-add-btn").element as HTMLButtonElement;
    const input = () => find("status-page-domain-input").element as HTMLInputElement;

    async function mountAs(isCloud: string, subscriptionType: string) {
      mockConfig.isCloud = isCloud;
      mockStore.state.selectedOrganization = { subscription_type: subscriptionType };
      await mountWith();
      await find("status-page-domain-input").setValue("status.brandname.com");
    }

    it("disables the input and Add, with the upgrade sentence, on the Cloud free plan", async () => {
      await mountAs("true", "free");

      expect(addButton().disabled).toBe(true);
      expect(input().disabled).toBe(true);
      expect(find("status-page-domain-add-upgrade").text()).toContain(
        "Custom domains need a paid plan. Upgrade to add a domain.",
      );

      await find("status-page-domain-add-btn").trigger("click");
      expect(mockCreateDomain).not.toHaveBeenCalled();
    });

    it("links the upgrade sentence to billing", async () => {
      await mountAs("true", "free");

      const link = find("status-page-domain-add-upgrade-btn");
      expect(link.element.tagName).toBe("A");
      expect(link.attributes("data-to")).toBe(PLANS_ROUTE);
    });

    it.each(["pay-as-you-go", "enterprise", "external-contract", ""])(
      "leaves Add enabled on Cloud for subscription_type %j",
      async (subscriptionType) => {
        await mountAs("true", subscriptionType);

        expect(addButton().disabled).toBe(false);
        expect(input().disabled).toBe(false);
        expect(exists("status-page-domain-add-upgrade")).toBe(false);
      },
    );

    it("leaves Add enabled on the free plan when the build is not Cloud", async () => {
      await mountAs("false", "free");

      expect(addButton().disabled).toBe(false);
      expect(input().disabled).toBe(false);
      expect(exists("status-page-domain-add-upgrade")).toBe(false);
    });

    it("leaves Add enabled when the org has no billing object", async () => {
      mockConfig.isCloud = "true";
      mockStore.state.selectedOrganization = {};
      await mountWith();
      await find("status-page-domain-input").setValue("status.brandname.com");

      expect(addButton().disabled).toBe(false);
    });

    it("lists and releases existing claims on the Cloud free plan", async () => {
      mockConfig.isCloud = "true";
      mockStore.state.selectedOrganization = { subscription_type: "free" };
      await mountWith(makeHolder({ serving_state: "not_serving", reason: "plan_required" }));

      expect(exists("status-page-domain-row-dom-1")).toBe(true);
      expect(exists("status-page-domain-delete-dom-1")).toBe(true);
    });

    it("shows the server's message when the create is refused", async () => {
      await mountAs("true", "");
      mockCreateDomain.mockRejectedValue({
        response: { data: { message: "validation: custom domains need an active subscription" } },
      });

      await find("status-page-domain-add-btn").trigger("click");
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({
        variant: "error",
        message: "validation: custom domains need an active subscription",
      });
    });
  });

  describe("delete confirm", () => {
    it("names the domain and asks with the release message and a destructive confirm", async () => {
      confirmMock.mockResolvedValue(false);
      await mountWith(makeDomain());

      await find("status-page-domain-delete-dom-1").trigger("click");
      await flushPromises();

      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messageKeypath: "statusPages.domains.releaseBody",
          messageName: "status.brandname.com",
          confirmVariant: "destructive",
        }),
      );
      expect(mockDeleteDomain).not.toHaveBeenCalled();
    });

    it("says the released domain is free for any organization to claim", () => {
      expect(msg("statusPages.domains.releaseBody", { name: "status.brandname.com" })).toBe(
        "Releasing status.brandname.com frees it for any organization to claim with a new TXT record.",
      );
    });

    it("removes the row once the release is confirmed", async () => {
      confirmMock.mockResolvedValue(true);
      mockDeleteDomain.mockResolvedValue({ data: {} });
      await mountWith(makeDomain());

      await find("status-page-domain-delete-dom-1").trigger("click");
      await flushPromises();

      expect(mockDeleteDomain).toHaveBeenCalledWith("org-1", "dom-1");
      expect(exists("status-page-domain-row-dom-1")).toBe(false);
    });
  });
});
