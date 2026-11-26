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
import type {
  DomainInstallation,
  DomainServingState,
  StatusPageDomain,
} from "@/services/status_pages";
import {
  builtInInstallation,
  builtInView,
  installationBody,
  offView,
  proxyView,
} from "@/test/unit/helpers/statusPageDomains";
import { nextDomainsReadSeq } from "./domainsReadSeq";

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
  mockCheckDomain,
  mockGetInstallation,
  mockCheckInstallation,
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
  mockCheckDomain: vi.fn(),
  mockGetInstallation: vi.fn(),
  mockCheckInstallation: vi.fn(),
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
    checkDomain: mockCheckDomain,
    getDomainInstallation: mockGetInstallation,
    checkDomainInstallation: mockCheckInstallation,
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

const EXPIRES_DATE = "2023-11-21 20:53"; // the fixtures' expires_at
const PROOF_FAILED_SINCE = 1_700_000_000_000_000; // 2023-11-14 22:13 UTC
const SINCE_TIME = "2023-11-14 22:13";
const WARNING_AT = 1_700_259_200_000_000; // 72 hours after PROOF_FAILED_SINCE
const WARNING_TIME = "2023-11-17 22:13";
const PROBED_AT = 1_700_100_000_000_000; // 2023-11-16 02:00 UTC
const PROBED_TIME = "2023-11-16 02:00";
const VALIDATED_AT = 1_700_050_000_000_000; // 2023-11-15 12:06 UTC
const VALIDATED_TIME = "2023-11-15 12:06";
const NOW_MS = 1_700_700_000_000; // the clock of the staleness cases
const HOUR_US = 3_600_000_000;
const CNAME_TARGET = "k7f3q9x2m4p8w6tz.domains.example.com";

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

const R = "statusPages.domains.reason.";

// A claim that holds its hostname: ownership proven.
function holder(view: StatusPageDomain, overrides: Partial<StatusPageDomain> = {}) {
  return {
    ...view,
    verification_state: 1 as const,
    verified_at: 1_700_000_000_000_000,
    is_holder: true,
    expires_at: null,
    ...overrides,
  };
}

// A serving built-in row, with the probe evidence `serving` always has.
function servingView(overrides: Partial<StatusPageDomain> = {}) {
  return holder(builtInView(), {
    serving_state: "serving",
    evidence: { ...builtInView().evidence, probe_checked_at: PROBED_AT, probe_mode: "listener" },
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

function makeWrapper(
  extraProps: { initialDomains?: StatusPageDomain[]; initialDomainsReadSeq?: number } = {},
) {
  return mount(DomainsDialog, {
    props: {
      open: true,
      orgIdentifier: "org-1",
      pageId: "page-1",
      pageName: "Acme Status",
      ...extraProps,
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
  const reasonLine = (id = "dom-1") => find(`status-page-domain-reason-${id}`).text();
  const rowText = (id = "dom-1") => find(`status-page-domain-row-${id}`).text();
  const codes = () => wrapper.findAll("code").map((c) => c.text());

  async function mountWith(...domains: StatusPageDomain[]) {
    mockListDomains.mockResolvedValue({ data: domains });
    wrapper = makeWrapper();
    await flushPromises();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockListDomains.mockResolvedValue({ data: [] });
    mockGetInstallation.mockRejectedValue({ response: { status: 403 } });
    mockConfig.isCloud = "true";
    mockStore.state.selectedOrganization = { subscription_type: "pay-as-you-go" };
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("pending, built-in TLS", () => {
    const REASONS: [string, string][] = [
      ["no_record", `${R}noRecord`],
      ["points_elsewhere", `${R}pointsElsewhere`],
      ["points_at_app_host", `${R}pointsAtAppHost`],
      ["dns_lookup_failed", `${R}dnsLookupFailed`],
      ["held_by_another_org", `${R}heldByAnotherOrgCname`],
      ["proof_lost", `${R}proofLostCname`],
      ["proof_stale", `${R}proofStale`],
    ];

    it("shows the CNAME name and value with working copy buttons", async () => {
      await mountWith(builtInView({ reason: "no_record" }));

      expect(codes()).toEqual(["status.brandname.com", CNAME_TARGET]);
      expect(find("status-page-domain-record-dom-1").text()).toContain(
        msg("statusPages.domains.cnameInstruction", {
          domain: "status.brandname.com",
          target: CNAME_TARGET,
        }),
      );
      await find("status-page-domain-copy-cname-name-dom-1").trigger("click");
      await find("status-page-domain-copy-cname-value-dom-1").trigger("click");
      expect(mockCopyToClipboard).toHaveBeenNthCalledWith(
        1,
        "status.brandname.com",
        expect.any(Function),
        { successMessage: msg("statusPages.domains.cnameNameCopied") },
      );
      expect(mockCopyToClipboard).toHaveBeenNthCalledWith(2, CNAME_TARGET, expect.any(Function), {
        successMessage: msg("statusPages.domains.cnameValueCopied"),
      });
    });

    it("shows the apex line, the expiry date, the automatic line and Verify now", async () => {
      await mountWith(builtInView({ reason: "no_record" }));

      expect(find("status-page-domain-apex-dom-1").text()).toBe(
        msg("statusPages.domains.apexNote"),
      );
      expect(find("status-page-domain-expires-dom-1").text()).toBe(
        msg("statusPages.domains.expiresAt", { date: EXPIRES_DATE }),
      );
      expect(find("status-page-domain-auto-verify-dom-1").text()).toBe(
        msg("statusPages.domains.nextStepVerify", { seconds: 30 }),
      );
      expect(exists("status-page-domain-verify-dom-1")).toBe(true);
    });

    it.each(REASONS)("renders its own line for %s", async (reason, key) => {
      await mountWith(builtInView({ reason }));

      expect(reasonLine()).toBe(msg(key, { appHost: "app.example.com", target: CNAME_TARGET }));
    });

    it("gives each of the seven reasons a different line", () => {
      expect(new Set(REASONS.map(([, key]) => msg(key))).size).toBe(7);
    });

    it("interpolates the app host and the CNAME target for points_at_app_host", async () => {
      await mountWith(builtInView({ reason: "points_at_app_host" }));

      expect(reasonLine()).toBe(
        `This domain points at app.example.com. Change the CNAME to ${CNAME_TARGET}.`,
      );
    });

    it("tells a customer behind a CDN to turn off proxying for points_elsewhere", async () => {
      await mountWith(builtInView({ reason: "points_elsewhere" }));

      expect(reasonLine()).toContain("turn off CDN proxying");
    });

    it("gives the time the CNAME was lost from the evidence, and without it the plain line", async () => {
      await mountWith(
        builtInView({
          reason: "proof_lost",
          evidence: { ...builtInView().evidence, proof_failed_since: PROOF_FAILED_SINCE },
        }),
      );
      expect(reasonLine()).toBe(msg(`${R}proofLostSinceCname`, { time: SINCE_TIME }));

      wrapper.unmount();
      await mountWith(builtInView({ reason: "proof_lost" }));
      expect(reasonLine()).toBe(msg(`${R}proofLostCname`));
    });

    it("renders no TXT record, no _o2-verify name and no token, and says nothing of TXT", async () => {
      await mountWith(builtInView({ reason: "held_by_another_org" }));

      expect(exists("status-page-domain-copy-txt-name-dom-1")).toBe(false);
      expect(exists("status-page-domain-copy-txt-value-dom-1")).toBe(false);
      expect(exists("status-page-domain-keep-record-dom-1")).toBe(false);
      expect(wrapper.text()).not.toContain("TXT");
      expect(wrapper.text()).not.toContain("_o2-verify");
    });

    it("badges the claim Pending", async () => {
      await mountWith(builtInView());

      expect(find("status-page-domain-state-dom-1").text()).toBe("Pending");
    });

    it("renders no reason line without a reason or for one this client does not know", async () => {
      await mountWith(builtInView({ reason: null }), builtInView({ id: "dom-2", reason: "new" }));

      expect(exists("status-page-domain-reason-dom-1")).toBe(false);
      expect(exists("status-page-domain-reason-dom-2")).toBe(false);
    });
  });

  describe("pending, proxy mode", () => {
    const REASONS: [string, string][] = [
      ["record_missing", `${R}recordMissing`],
      ["value_mismatch", `${R}valueMismatch`],
      ["dns_lookup_failed", `${R}dnsLookupFailed`],
      ["held_by_another_org", `${R}heldByAnotherOrg`],
      ["proof_lost", `${R}proofLost`],
    ];

    it("shows the TXT name and value with working copy buttons under the phase 1 ids", async () => {
      await mountWith(proxyView({ reason: "record_missing" }));

      expect(codes()).toEqual(["_o2-verify.status.brandname.com", "o2v_abc123"]);
      expect(find("status-page-domain-record-dom-1").text()).toContain(
        msg("statusPages.domains.recordInstructions"),
      );
      await find("status-page-domain-copy-txt-name-dom-1").trigger("click");
      await find("status-page-domain-copy-txt-value-dom-1").trigger("click");
      expect(mockCopyToClipboard).toHaveBeenNthCalledWith(
        1,
        "_o2-verify.status.brandname.com",
        expect.any(Function),
        { successMessage: msg("statusPages.domains.txtNameCopied") },
      );
      expect(mockCopyToClipboard).toHaveBeenNthCalledWith(2, "o2v_abc123", expect.any(Function), {
        successMessage: msg("statusPages.domains.txtValueCopied"),
      });
      expect(find("status-page-domain-keep-record-dom-1").text()).toBe(
        msg("statusPages.domains.keepRecord"),
      );
    });

    it.each(REASONS)("renders its own line for %s", async (reason, key) => {
      await mountWith(proxyView({ reason }));

      expect(reasonLine()).toBe(msg(key));
    });

    it("gives each of the five reasons a different line", () => {
      expect(new Set(REASONS.map(([, key]) => msg(key))).size).toBe(5);
    });

    it("tells the customer another organization's _o2-verify value may be the cause", async () => {
      await mountWith(proxyView({ reason: "held_by_another_org" }));

      expect(reasonLine()).toContain("_o2-verify");
      expect(reasonLine()).toContain("ask that organization to release it");
      expect(reasonLine()).toContain("a change of owner can take up to a day");
    });

    it("gives the time the TXT record was lost, without saying it is no longer or back", async () => {
      await mountWith(
        proxyView({
          reason: "proof_lost",
          evidence: { ...proxyView().evidence, proof_failed_since: PROOF_FAILED_SINCE },
        }),
      );

      expect(reasonLine()).toBe(msg(`${R}proofLostSince`, { time: SINCE_TIME }));
      expect(reasonLine()).not.toMatch(/no longer|it back/);
    });

    it("renders the routing line, the expiry date and Verify now, and no apex line", async () => {
      await mountWith(proxyView({ reason: "record_missing" }));

      expect(find("status-page-domain-routing-dom-1").text()).toBe(
        msg("statusPages.domains.routingNote"),
      );
      expect(exists("status-page-domain-apex-dom-1")).toBe(false);
      expect(exists("status-page-domain-expires-dom-1")).toBe(true);
      expect(exists("status-page-domain-verify-dom-1")).toBe(true);
    });

    it("renders no CNAME record and never says the word CNAME", async () => {
      await mountWith(proxyView({ reason: "held_by_another_org" }));

      expect(exists("status-page-domain-copy-cname-name-dom-1")).toBe(false);
      expect(wrapper.text()).not.toContain("CNAME");
    });

    it("renders the record for a freshly claimed domain after the list reloads", async () => {
      mockListDomains
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [proxyView()] });
      mockCreateDomain.mockResolvedValue({ data: { id: "dom-1", domain: "status.brandname.com" } });
      wrapper = makeWrapper();
      await flushPromises();

      await find("status-page-domain-input").setValue("status.brandname.com");
      await find("status-page-domain-add-btn").trigger("click");
      await flushPromises();

      expect(mockCreateDomain).toHaveBeenCalledWith("org-1", "page-1", "status.brandname.com");
      expect(codes()).toContain("o2v_abc123");
    });
  });

  describe("custom domains off", () => {
    it.each([
      ["cloud_not_enabled", `${R}cloudNotEnabled`, "true"],
      ["not_enabled", `${R}notEnabled`, "false"],
    ])(
      "tells a holder what %s means, with 72 hours and nothing to do now",
      async (reason, key, cloud) => {
        mockConfig.isCloud = cloud;
        await mountWith(holder(offView(), { serving_state: "verified", reason }));

        expect(reasonLine()).toBe(msg(key));
        expect(reasonLine()).toContain("72 hours");
        expect(reasonLine().toLowerCase()).not.toContain("do not need to do anything");
        expect(find("status-page-domain-state-dom-1").text()).toBe("Verified");
        expect(exists("status-page-domain-record-dom-1")).toBe(false);
      },
    );

    it("gives the two off wordings different sentences", () => {
      expect(msg(`${R}cloudNotEnabled`)).not.toBe(msg(`${R}notEnabled`));
      expect(msg(`${R}notEnabled`)).toContain("add or confirm one DNS record");
    });

    it.each(["cloud_not_enabled", "not_enabled"])(
      "tells a pending claim it is not verified and when it expires, for %s",
      async (reason) => {
        await mountWith(offView({ reason }));

        expect(reasonLine()).toBe(msg(`${R}pendingOff`, { date: EXPIRES_DATE }));
        expect(reasonLine()).not.toBe(
          msg(`${R}${reason === "not_enabled" ? "notEnabled" : "cloudNotEnabled"}`),
        );
        expect(exists("status-page-domain-record-dom-1")).toBe(false);
        expect(exists("status-page-domain-auto-verify-dom-1")).toBe(false);
        expect(exists("status-page-domain-expires-dom-1")).toBe(false);
        expect(exists("status-page-domain-verify-dom-1")).toBe(false);
        expect(wrapper.text()).not.toContain("Verification runs automatically");
        expect(wrapper.text()).not.toContain("Verify now");
      },
    );

    it("tells a pending claim with no expiry time that it is not verified", async () => {
      await mountWith(offView({ reason: "not_enabled", expires_at: null }));

      expect(reasonLine()).toBe(msg(`${R}pendingOffNoDate`));
    });

    it.each([
      ["org_blocked", `${R}orgBlocked`],
      ["not_licensed", `${R}notLicensed`],
      ["plan_required", `${R}planRequired`],
    ])("shows %s with its message and no record", async (reason, key) => {
      await mountWith(holder(offView(), { serving_state: "not_serving", reason }));

      expect(reasonLine()).toContain(msg(key));
      expect(exists("status-page-domain-record-dom-1")).toBe(false);
      expect(wrapper.findAll("code")).toHaveLength(0);
    });

    it("shows the API's message when the add is refused", async () => {
      await mountWith();
      mockCreateDomain.mockRejectedValue({
        response: { data: { message: "validation: custom domains are not enabled" } },
      });
      await find("status-page-domain-input").setValue("status.brandname.com");

      await find("status-page-domain-add-btn").trigger("click");
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({
        variant: "error",
        message: "validation: custom domains are not enabled",
      });
    });

    describe("releasing", () => {
      const release = async (view: StatusPageDomain) => {
        confirmMock.mockResolvedValue(false);
        await mountWith(view);
        await find("status-page-domain-delete-dom-1").trigger("click");
        await flushPromises();
      };

      it("says a row with no record cannot be added again until custom domains are available", async () => {
        await release(holder(offView(), { serving_state: "verified", reason: "not_enabled" }));

        expect(confirmMock).toHaveBeenCalledWith(
          expect.objectContaining({
            messageKeypath: "statusPages.domains.releaseBodyOff",
            messageName: "status.brandname.com",
          }),
        );
        expect(msg("statusPages.domains.releaseBodyOff")).toContain(
          "Custom domains cannot be added right now, so you cannot add this domain again until they are available.",
        );
      });

      it.each([
        ["a built-in row", builtInView()],
        ["a proxy row", proxyView()],
      ])("does not say so for %s", async (_label, view) => {
        await release(view);

        expect(confirmMock).toHaveBeenCalledWith(
          expect.objectContaining({
            messageKeypath: "statusPages.domains.releaseBody",
            confirmVariant: "destructive",
          }),
        );
        expect(msg("statusPages.domains.releaseBody")).not.toContain(
          "cannot add this domain again",
        );
      });

      it("names the DNS record the customer added, not a TXT record", () => {
        const body = msg("statusPages.domains.releaseBody", { name: "status.brandname.com" });

        expect(body).toContain("the DNS record you added");
        expect(body).not.toContain("TXT");
      });

      it("removes the row once the release is confirmed", async () => {
        confirmMock.mockResolvedValue(true);
        mockDeleteDomain.mockResolvedValue({ data: {} });
        await mountWith(builtInView());

        await find("status-page-domain-delete-dom-1").trigger("click");
        await flushPromises();

        expect(mockDeleteDomain).toHaveBeenCalledWith("org-1", "dom-1");
        expect(exists("status-page-domain-row-dom-1")).toBe(false);
      });
    });
  });

  describe("waiting_for_dns, built-in TLS", () => {
    const REASONS: [string, string][] = [
      ["no_record", `${R}noRecord`],
      ["points_elsewhere", `${R}pointsElsewhere`],
      ["points_at_app_host", `${R}pointsAtAppHost`],
    ];

    it.each(REASONS)("shows the CNAME record and the line for %s", async (reason, key) => {
      await mountWith(holder(builtInView(), { serving_state: "waiting_for_dns", reason }));

      expect(find("status-page-domain-state-dom-1").text()).toBe("Waiting for DNS");
      expect(codes()).toEqual(["status.brandname.com", CNAME_TARGET]);
      expect(reasonLine()).toBe(msg(key, { appHost: "app.example.com", target: CNAME_TARGET }));
    });

    it("warns with the time the claim can be released from the page", async () => {
      await mountWith(
        holder(builtInView(), {
          serving_state: "waiting_for_dns",
          reason: "no_record",
          warning: "cname_missing",
          warning_at: WARNING_AT,
        }),
      );

      const warning = find("status-page-domain-warning-dom-1");
      expect(warning.attributes("data-variant")).toBe("warning");
      expect(warning.text()).toBe(
        msg("statusPages.domains.cnameMissingWarning", { time: WARNING_TIME }),
      );
      expect(warning.text()).toBe(
        `Change the CNAME before ${WARNING_TIME}, or this domain is released from your page.`,
      );
    });

    it("explains the apex and flattening limits to a holder with no CNAME record", async () => {
      await mountWith(
        holder(builtInView({ domain: "brandname.com" }), {
          serving_state: "waiting_for_dns",
          reason: "no_record",
          warning: "cname_missing",
          warning_at: WARNING_AT,
        }),
      );

      expect(find("status-page-domain-apex-dom-1").text()).toBe(
        msg("statusPages.domains.apexNote"),
      );
      expect(exists("status-page-domain-warning-dom-1")).toBe(true);
    });

    it("offers no Verify now", async () => {
      await mountWith(
        holder(builtInView(), { serving_state: "waiting_for_dns", reason: "no_record" }),
      );

      expect(exists("status-page-domain-verify-dom-1")).toBe(false);
    });
  });

  describe("verified in proxy mode (row 6a)", () => {
    const row6a = (overrides: Partial<StatusPageDomain> = {}) =>
      holder(proxyView(), { serving_state: "verified", reason: "proxy_mode", ...overrides });

    it("says ownership is verified and that the administrator's proxy holds the certificate", async () => {
      await mountWith(row6a());

      expect(find("status-page-domain-state-dom-1").text()).toBe("Verified");
      expect(reasonLine()).toBe(msg(`${R}proxyMode`));
      expect(reasonLine()).toContain(
        "OpenObserve cannot check from here that the domain is reachable.",
      );
    });

    it("keeps the TXT record shown, with the line that it must stay in DNS", async () => {
      await mountWith(row6a());

      expect(codes()).toEqual(["_o2-verify.status.brandname.com", "o2v_abc123"]);
      expect(find("status-page-domain-keep-record-dom-1").text()).toBe(
        msg("statusPages.domains.keepRecord"),
      );
    });

    it("says nothing of serving or of checking HTTPS, and shows no check, evidence or verify", async () => {
      await mountWith(
        row6a({ evidence: { ...proxyView().evidence, probe_checked_at: PROBED_AT } }),
      );

      const text = wrapper.text().toLowerCase();
      expect(text).not.toContain("serves your status page");
      expect(text).not.toContain("over https");
      expect(text).not.toContain("checked at");
      expect(exists("status-page-domain-verify-dom-1")).toBe(false);
      expect(exists("status-page-domain-check-again-dom-1")).toBe(false);
      expect(exists("status-page-domain-evidence-dom-1")).toBe(false);
      expect(exists("status-page-domain-routing-dom-1")).toBe(false);
    });

    it("warns with its time when the TXT record is missing", async () => {
      await mountWith(row6a({ warning: "txt_missing", warning_at: WARNING_AT }));

      const warning = find("status-page-domain-warning-dom-1");
      expect(warning.attributes("data-variant")).toBe("warning");
      expect(warning.text()).toBe(
        `The TXT record shown is not in DNS. Add it before ${WARNING_TIME}, or this domain is released from your page.`,
      );
    });

    it("shows no warning without the warning", async () => {
      await mountWith(row6a({ warning: null, warning_at: null }));

      expect(exists("status-page-domain-warning-dom-1")).toBe(false);
    });

    it("shows no txt_missing warning on a row that is not proxy_mode", async () => {
      await mountWith(
        holder(offView(), {
          serving_state: "verified",
          reason: "cloud_not_enabled",
          warning: "txt_missing",
          warning_at: WARNING_AT,
        }),
        proxyView({ id: "dom-2", warning: "txt_missing", warning_at: WARNING_AT }),
      );

      expect(exists("status-page-domain-warning-dom-1")).toBe(false);
      expect(exists("status-page-domain-warning-dom-2")).toBe(false);
    });

    it("offers no verify action, and keeps the release action", async () => {
      await mountWith(row6a());

      expect(exists("status-page-domain-verify-dom-1")).toBe(false);
      expect(exists("status-page-domain-delete-dom-1")).toBe(true);
    });
  });

  describe("not_serving", () => {
    const ORG_REASONS: [string, string][] = [
      ["org_denied", `${R}orgDenied`],
      ["org_not_allowed", `${R}orgNotAllowed`],
      ["not_licensed", `${R}notLicensed`],
    ];

    it.each(ORG_REASONS)(
      "shows %s in proxy mode, with no certificate row and no evidence",
      async (reason, key) => {
        await mountWith(holder(proxyView(), { serving_state: "not_serving", reason }));

        expect(find("status-page-domain-state-dom-1").text()).toBe("Not serving");
        expect(reasonLine()).toBe(msg(key));
        expect(exists("status-page-domain-evidence-dom-1")).toBe(false);
        expect(exists("status-page-domain-next-try-dom-1")).toBe(false);
        expect(exists("status-page-domain-check-again-dom-1")).toBe(false);
      },
    );

    it.each(ORG_REASONS)("shows the same %s message with built-in TLS", async (reason, key) => {
      await mountWith(holder(builtInView(), { serving_state: "not_serving", reason }));

      expect(reasonLine()).toBe(msg(key));
    });

    it("says custom domains are off for the org for org_blocked and org_denied alike", () => {
      expect(msg(`${R}orgBlocked`)).toBe("Custom domains are turned off for this organization.");
      expect(msg(`${R}orgDenied`)).toBe(msg(`${R}orgBlocked`));
      expect(msg(`${R}orgNotAllowed`)).toBe(
        "Custom domains are not enabled for this organization yet.",
      );
    });

    it("asks for a paid plan on plan_required, links to billing and keeps the release action", async () => {
      await mountWith(
        holder(proxyView(), { serving_state: "not_serving", reason: "plan_required" }),
      );

      expect(reasonLine()).toContain(
        "Custom domains need a paid plan. Upgrade to serve this domain again.",
      );
      expect(exists("status-page-domain-delete-dom-1")).toBe(true);
      const link = find("status-page-domain-upgrade-btn-dom-1");
      expect(link.element.tagName).toBe("A");
      expect(link.attributes("data-to")).toBe(PLANS_ROUTE);
    });

    it.each(["org_blocked", "not_licensed", "org_denied", "org_not_allowed"])(
      "offers no billing link for %s",
      async (reason) => {
        await mountWith(holder(proxyView(), { serving_state: "not_serving", reason }));

        expect(exists("status-page-domain-upgrade-btn-dom-1")).toBe(false);
      },
    );
  });

  describe("one message per reason of rows 2, 5, 7, 8 and 11 to 16", () => {
    // [state, reason, message key, other fields of the view]
    const CASES: [DomainServingState, string | null, string, Partial<StatusPageDomain>][] = [
      ["not_serving", "org_blocked", `${R}orgBlocked`, {}],
      ["not_serving", "org_denied", `${R}orgDenied`, {}],
      ["not_serving", "org_not_allowed", `${R}orgNotAllowed`, {}],
      ["not_serving", "not_licensed", `${R}notLicensed`, {}],
      ["not_serving", "plan_required", `${R}planRequired`, {}],
      ["ready", "page_not_published", `${R}ready`, {}],
      ["not_serving", "invalid_host", `${R}invalidHost`, {}],
      ["not_serving", "caa_blocks", `${R}caaBlocks`, {}],
      ["not_serving", "ca_dns", `${R}caDns`, { can_check_again: true, acts: "customer" }],
      ["not_serving", "ca_caa", `${R}caCaa`, { can_check_again: true, acts: "customer" }],
      ["not_serving", "ca_connection", `${R}caConnection`, { can_check_again: true, acts: null }],
      ["not_serving", "ca_tls_terminated", `${R}caTlsTerminated`, { acts: null }],
      ["not_serving", "ca_rate_limited", `${R}caRateLimited`, { acts: null }],
      ["not_serving", "ca_other", `${R}caOther`, { acts: null }],
      ["setting_up", "order_running", `${R}orderRunning`, {}],
      ["setting_up", "queued", `${R}queued`, { next_action_at: PROBED_AT }],
      ["setting_up", null, `${R}settingUp`, {}],
    ];

    it.each(CASES)(
      "%s / %s renders its message and no warning banner",
      async (state, reason, key, extra) => {
        await mountWith(holder(builtInView(), { serving_state: state, reason, ...extra }));

        expect(find("status-page-domain-reason-dom-1").find("span").text()).toContain(
          msg(key, { time: PROBED_TIME }),
        );
        expect(exists("status-page-domain-warning-dom-1")).toBe(false);
        expect(wrapper.text().toLowerCase()).not.toContain("serves your status page");
      },
    );

    it.each(["caa_blocks", "ca_caa"])(
      "tells the customer to allow letsencrypt.org for %s",
      async (reason) => {
        await mountWith(
          holder(builtInView(), { serving_state: "not_serving", reason, acts: "customer" }),
        );
        expect(reasonLine()).toContain("Allow letsencrypt.org");
      },
    );

    it.each([
      ["not_serving", "certificate_mismatch", `${R}cannotServeCloud`, `${R}cannotServeSelfHosted`],
      ["not_serving", "probe_failed", `${R}cannotServeCloud`, `${R}cannotServeSelfHosted`],
      ["delayed", "installation_not_ready", `${R}delayedCloud`, `${R}delayedSelfHosted`],
    ] as const)(
      "%s / %s says its Cloud wording on Cloud and its self-hosted one elsewhere",
      async (state, reason, cloudKey, selfKey) => {
        mockConfig.isCloud = "true";
        await mountWith(holder(builtInView(), { serving_state: state, reason }));
        expect(reasonLine()).toBe(msg(cloudKey));
        expect(reasonLine()).toMatch(/our team|our side/i);
        wrapper.unmount();

        mockConfig.isCloud = "false";
        await mountWith(holder(builtInView(), { serving_state: state, reason }));
        expect(reasonLine()).toBe(msg(selfKey));
        expect(reasonLine()).toContain("Ask your administrator");
        expect(reasonLine()).not.toMatch(/our team|our side/i);
        expect(exists("status-page-domain-warning-dom-1")).toBe(false);
      },
    );

    it("says delayed Cloud setup needs nothing from a holder who already added the record", () => {
      expect(msg(`${R}delayedCloud`)).toBe(
        "Setup is delayed on our side. You do not need to do anything.",
      );
    });

    it("shows the next try time of a queued order, and a plain line when it has none", async () => {
      await mountWith(
        holder(builtInView(), {
          serving_state: "setting_up",
          reason: "queued",
          next_action_at: null,
        }),
      );

      expect(reasonLine()).toBe(msg(`${R}settingUp`));
    });

    it("badges the five new states with their own labels", async () => {
      const labels: [DomainServingState, string][] = [
        ["waiting_for_dns", "Waiting for DNS"],
        ["setting_up", "Setting up"],
        ["ready", "Ready"],
        ["serving", "Serving"],
        ["delayed", "Delayed"],
      ];
      for (const [state, label] of labels) {
        await mountWith(servingView({ serving_state: state }));
        expect(find("status-page-domain-state-dom-1").text()).toBe(label);
        wrapper.unmount();
      }
    });
  });

  describe("serving", () => {
    it("says the domain serves the page over HTTPS, with the load_balancer evidence line", async () => {
      await mountWith(
        servingView({ evidence: { ...servingView().evidence, probe_mode: "load_balancer" } }),
      );

      expect(find("status-page-domain-state-dom-1").text()).toBe("Serving");
      expect(reasonLine()).toBe("This domain serves your status page over HTTPS.");
      expect(find("status-page-domain-evidence-dom-1").text()).toBe(
        `Reachable from the internet: checked at ${PROBED_TIME}`,
      );
    });

    it("gives the listener evidence line with the CA's last validation", async () => {
      await mountWith(
        servingView({
          evidence: {
            ...servingView().evidence,
            probe_mode: "listener",
            ca_validated_at: VALIDATED_AT,
          },
        }),
      );

      expect(find("status-page-domain-evidence-dom-1").text()).toBe(
        `Certificate and page checked at ${PROBED_TIME}. Reachable from the internet: last proven on ${VALIDATED_TIME}`,
      );
    });

    it("keeps the CNAME record shown with the line that it must stay", async () => {
      await mountWith(servingView());

      expect(codes()).toEqual(["status.brandname.com", CNAME_TARGET]);
      expect(find("status-page-domain-keep-cname-dom-1").text()).toBe(
        msg("statusPages.domains.keepCnameRecord"),
      );
      expect(exists("status-page-domain-verify-dom-1")).toBe(false);
    });

    it("renders as setting up, with no serving sentence, when there is no probe evidence", async () => {
      await mountWith(
        servingView({ evidence: { ...servingView().evidence, probe_checked_at: null } }),
      );

      expect(find("status-page-domain-state-dom-1").text()).toBe("Setting up");
      expect(reasonLine()).toBe(msg(`${R}settingUp`));
      expect(exists("status-page-domain-evidence-dom-1")).toBe(false);
      expect(wrapper.text().toLowerCase()).not.toContain("serves");
    });

    it("warns with its time when renewal is failing", async () => {
      await mountWith(servingView({ warning: "renewal_failing", warning_at: WARNING_AT }));

      expect(find("status-page-domain-warning-dom-1").text()).toBe(
        msg("statusPages.domains.renewalFailingWarning", { time: WARNING_TIME }),
      );
    });

    it("shows a renewal warning only on a serving row", async () => {
      await mountWith(builtInView({ warning: "renewal_failing", warning_at: WARNING_AT }));

      expect(exists("status-page-domain-warning-dom-1")).toBe(false);
    });
  });

  describe("how old the state is", () => {
    const computedAgo = (us: number) => servingView({ state_computed_at: NOW_MS * 1000 - us });

    beforeEach(() => {
      vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
    });

    it("adds the out-of-date note at 12 hours and one minute", async () => {
      await mountWith(computedAgo(12 * HOUR_US + 60_000_000));

      expect(find("status-page-domain-stale-dom-1").text()).toBe("Status may be out of date.");
    });

    it("adds no note at 11 hours, or when the state has no time", async () => {
      await mountWith(
        computedAgo(11 * HOUR_US),
        servingView({ id: "dom-2", state_computed_at: null }),
      );

      expect(exists("status-page-domain-stale-dom-1")).toBe(false);
      expect(exists("status-page-domain-stale-dom-2")).toBe(false);
    });

    it("updates the note as the open row crosses 12 hours without reloading", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      await mountWith(computedAgo(12 * HOUR_US - 60_000_000));
      expect(exists("status-page-domain-stale-dom-1")).toBe(false);

      vi.mocked(Date.now).mockReturnValue(NOW_MS + 120_000);
      await vi.advanceTimersByTimeAsync(120_000);

      expect(find("status-page-domain-stale-dom-1").text()).toBe("Status may be out of date.");
      expect(mockListDomains).toHaveBeenCalledTimes(1);
    });
  });

  describe("Check again", () => {
    const failing = (overrides: Partial<StatusPageDomain> = {}) =>
      holder(builtInView(), {
        serving_state: "not_serving",
        reason: "ca_dns",
        can_check_again: true,
        acts: "customer",
        next_action_at: PROBED_AT,
        ...overrides,
      });

    it("shows the next try time and the button for a ca_* reason that can be checked again", async () => {
      await mountWith(failing());

      expect(find("status-page-domain-next-try-dom-1").text()).toBe(`Next try at ${PROBED_TIME}.`);
      expect(find("status-page-domain-check-again-dom-1").text()).toBe("Check again");
    });

    it.each([
      ["a ca_* reason that cannot be checked again", failing({ can_check_again: false })],
      ["a reason that is not a ca_* one", failing({ reason: "invalid_host" })],
      ["a state that never has one", servingView({ can_check_again: false })],
    ])("renders no button for %s", async (_label, view) => {
      await mountWith(view);

      expect(exists("status-page-domain-check-again-dom-1")).toBe(false);
    });

    it("calls checkDomain and replaces the row with the view it returns", async () => {
      await mountWith(failing());
      mockCheckDomain.mockResolvedValue({
        data: holder(builtInView(), { serving_state: "setting_up", reason: "order_running" }),
      });

      await find("status-page-domain-check-again-dom-1").trigger("click");
      await flushPromises();

      expect(mockCheckDomain).toHaveBeenCalledWith("org-1", "dom-1");
      expect(find("status-page-domain-state-dom-1").text()).toBe("Setting up");
      expect(reasonLine()).toBe(msg(`${R}orderRunning`));
      expect(exists("status-page-domain-check-again-dom-1")).toBe(false);
    });

    it("keeps overlapping checks independently disabled and guards duplicate clicks", async () => {
      const first = failing();
      const second = failing({ id: "dom-2" });
      const firstResponse = Promise.withResolvers<{ data: StatusPageDomain }>();
      const secondResponse = Promise.withResolvers<{ data: StatusPageDomain }>();
      mockCheckDomain
        .mockReturnValueOnce(firstResponse.promise)
        .mockReturnValueOnce(secondResponse.promise);
      await mountWith(first, second);

      const firstButton = find("status-page-domain-check-again-dom-1");
      const secondButton = find("status-page-domain-check-again-dom-2");
      await Promise.all([firstButton.trigger("click"), firstButton.trigger("click")]);
      expect(firstButton.attributes("disabled")).toBeDefined();
      expect(secondButton.attributes("disabled")).toBeUndefined();
      await secondButton.trigger("click");
      expect(firstButton.attributes("disabled")).toBeDefined();
      expect(secondButton.attributes("disabled")).toBeDefined();

      secondResponse.resolve({ data: second });
      await flushPromises();
      expect(firstButton.attributes("disabled")).toBeDefined();
      expect(secondButton.attributes("disabled")).toBeUndefined();

      firstResponse.resolve({ data: first });
      await flushPromises();
      expect(firstButton.attributes("disabled")).toBeUndefined();
      expect(mockCheckDomain.mock.calls).toEqual([
        ["org-1", "dom-1"],
        ["org-1", "dom-2"],
      ]);
    });

    it("shows the API's message when the check is refused", async () => {
      await mountWith(failing());
      mockCheckDomain.mockRejectedValue({
        response: { data: { message: "validation: too soon" } },
      });

      await find("status-page-domain-check-again-dom-1").trigger("click");
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({ variant: "error", message: "validation: too soon" });
      expect(find("status-page-domain-state-dom-1").text()).toBe("Not serving");
    });

    it.each([
      ["true", "actsOperatorCloud", /our team/i],
      ["false", "actsOperatorSelfHosted", /administrator/i],
    ])(
      "tells whose side the fault is on when the operator must act (Cloud %s)",
      async (cloud, key, side) => {
        mockConfig.isCloud = cloud;
        await mountWith(failing({ reason: "ca_dns", acts: "operator" }));

        expect(reasonLine()).toBe(`${msg(`${R}caDns`)} ${msg(`${R}${key}`)}`);
        expect(reasonLine()).toMatch(side);
        expect(reasonLine()).not.toContain("CNAME");
      },
    );

    it("keeps the cause for the customer to read when the customer must act", async () => {
      await mountWith(failing({ acts: "customer" }));

      expect(reasonLine()).toBe(`${msg(`${R}caDns`)} ${msg(`${R}fixDns`)}`);
    });

    it("says nothing to a self-hosted user of our team", async () => {
      mockConfig.isCloud = "false";
      await mountWith(failing({ reason: "ca_connection", acts: "operator" }));

      expect(wrapper.text()).not.toMatch(/our team|our side/i);
    });
  });

  describe("what the dialog never says, in every state, reason and shape", () => {
    const BUILT_IN = {
      pending: [
        "no_record",
        "points_elsewhere",
        "points_at_app_host",
        "dns_lookup_failed",
        "held_by_another_org",
        "proof_lost",
        "proof_stale",
      ],
      waiting_for_dns: ["no_record", "points_elsewhere", "points_at_app_host"],
      not_serving: [
        "org_blocked",
        "org_denied",
        "org_not_allowed",
        "not_licensed",
        "plan_required",
        "certificate_mismatch",
        "probe_failed",
        "invalid_host",
        "caa_blocks",
        "ca_dns",
        "ca_caa",
        "ca_connection",
        "ca_tls_terminated",
        "ca_rate_limited",
        "ca_other",
      ],
      ready: ["page_not_published"],
      serving: [null],
      delayed: ["installation_not_ready"],
      setting_up: ["order_running", "queued", null],
      expired: [null],
    };
    const PROXY = {
      pending: [
        "record_missing",
        "value_mismatch",
        "dns_lookup_failed",
        "held_by_another_org",
        "proof_lost",
      ],
      verified: ["proxy_mode"],
      not_serving: [
        "org_blocked",
        "org_denied",
        "org_not_allowed",
        "not_licensed",
        "plan_required",
      ],
      expired: [null],
    };
    const OFF = {
      pending: ["cloud_not_enabled", "not_enabled"],
      verified: ["cloud_not_enabled", "not_enabled"],
      not_serving: ["org_blocked", "not_licensed", "plan_required"],
      expired: [null],
    };
    const SHAPES = [
      ["built-in", builtInView, BUILT_IN],
      ["proxy", proxyView, PROXY],
      ["off", offView, OFF],
    ] as const;
    const EVERY_REASON = [
      ...new Set([
        ...Object.values(BUILT_IN).flat(),
        ...Object.values(PROXY).flat(),
        ...Object.values(OFF).flat(),
        "a_reason_from_a_newer_backend",
      ]),
    ];

    // One dialog per shape and state, one row per reason, so a row's text is its own.
    async function mountRows(
      make: typeof builtInView,
      state: DomainServingState,
      reasons: (string | null)[],
    ) {
      await mountWith(
        ...reasons.map((reason, i) =>
          make({
            id: `r${i}`,
            serving_state: state,
            reason,
            can_check_again: false,
            evidence: { ...make().evidence, probe_checked_at: PROBED_AT, probe_mode: "listener" },
          }),
        ),
      );
    }

    const CASES = SHAPES.flatMap(([shape, make]) =>
      ALL_STATES.map((state) => ({ shape, make, state })),
    );

    it.each(CASES)(
      "$shape, $state: only a serving row says it serves the page, and none says no longer or back",
      async ({ make, state }) => {
        await mountRows(make, state, EVERY_REASON);

        for (let i = 0; i < EVERY_REASON.length; i++) {
          const text = rowText(`r${i}`);
          expect(text.toLowerCase().includes("serves your status page")).toBe(state === "serving");
          expect(text).not.toMatch(/no longer|it back/i);
        }
      },
    );

    it.each(CASES)(
      "$shape, $state: no row shows both a TXT and a CNAME record",
      async ({ make, state }) => {
        await mountRows(make, state, EVERY_REASON);

        for (let i = 0; i < EVERY_REASON.length; i++) {
          const row = find(`status-page-domain-row-r${i}`);
          const txt = row.find('[data-test^="status-page-domain-copy-txt"]').exists();
          const cname = row.find('[data-test^="status-page-domain-copy-cname"]').exists();
          expect(txt && cname).toBe(false);
        }
      },
    );

    it.each(SHAPES)(
      "%s: the rows that occur there follow the shape's own words",
      async (label, make, occurs) => {
        for (const [state, reasons] of Object.entries(occurs)) {
          await mountRows(make, state as DomainServingState, reasons);

          for (let i = 0; i < reasons.length; i++) {
            const text = rowText(`r${i}`);
            if (label === "proxy") expect(text).not.toContain("CNAME");
            else {
              expect(text).not.toContain("TXT");
              expect(text).not.toContain("_o2-verify");
            }
            if (label !== "proxy") {
              expect(exists(`status-page-domain-routing-r${i}`)).toBe(false);
            }
          }
          wrapper.unmount();
        }
      },
    );

    it("never offers a record on an off row", async () => {
      for (const [state, reasons] of Object.entries(OFF)) {
        await mountRows(offView, state as DomainServingState, reasons);
        expect(wrapper.findAll("code")).toHaveLength(0);
        wrapper.unmount();
      }
    });

    it("never names an A or AAAA record as a proof", () => {
      const words = JSON.stringify(enLocale.statusPages.domains);

      expect(words).not.toMatch(/\bAAAA\b|\bA record\b/);
    });
  });

  describe("an unknown serving_state", () => {
    it("renders a neutral badge with the raw state name, no banner and no reason", async () => {
      await mountWith(offView({ serving_state: "warming_up" as DomainServingState }));

      const badge = find("status-page-domain-state-dom-1");
      expect(badge.text()).toBe("warming_up");
      expect(badge.attributes("data-variant")).toBe("default-soft");
      expect(exists("status-page-domain-warning-dom-1")).toBe(false);
      expect(exists("status-page-domain-reason-dom-1")).toBe(false);
    });

    it("does not throw for any state of the C7 contract", async () => {
      for (const state of ALL_STATES) {
        mockListDomains.mockResolvedValue({ data: [builtInView({ serving_state: state })] });
        const w = makeWrapper();
        await flushPromises();
        expect(w.find('[data-test="status-page-domain-row-dom-1"]').exists()).toBe(true);
        w.unmount();
      }
    });
  });

  describe("rows fetched by a mailed link", () => {
    it("shows them on the first open without asking again, then loads when reopened", async () => {
      wrapper = makeWrapper({ initialDomains: [builtInView({ id: "seeded" })] });
      await flushPromises();
      expect(exists("status-page-domain-row-seeded")).toBe(true);
      expect(mockListDomains).not.toHaveBeenCalled();

      mockListDomains.mockResolvedValue({ data: [builtInView({ id: "fresh" })] });
      await wrapper.setProps({ open: false });
      await wrapper.setProps({ open: true });
      await flushPromises();

      expect(mockListDomains).toHaveBeenCalledTimes(1);
      expect(exists("status-page-domain-row-fresh")).toBe(true);
      expect(exists("status-page-domain-row-seeded")).toBe(false);
    });

    it("applies fresher rows from a second link while the dialog is already open", async () => {
      const setting = builtInView({ serving_state: "setting_up", reason: "order_running" });
      wrapper = makeWrapper({ initialDomains: [setting] });
      await flushPromises();
      expect(find("status-page-domain-state-dom-1").text()).toBe("Setting up");

      await wrapper.setProps({ initialDomains: [servingView()] });

      expect(find("status-page-domain-state-dom-1").text()).toBe("Serving");
      expect(mockListDomains).not.toHaveBeenCalled();
    });

    it("is not overwritten by an older list read that answers after the link's rows", async () => {
      const older = Promise.withResolvers<{ data: StatusPageDomain[] }>();
      mockListDomains.mockReturnValueOnce(older.promise);
      wrapper = makeWrapper();
      await flushPromises();

      await wrapper.setProps({
        initialDomains: [builtInView({ serving_state: "waiting_for_dns", reason: "no_record" })],
      });
      expect(find("status-page-domain-state-dom-1").text()).toBe("Waiting for DNS");
      older.resolve({ data: [servingView()] });
      await flushPromises();

      expect(find("status-page-domain-state-dom-1").text()).toBe("Waiting for DNS");
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("shows no load-failed toast for an older read that fails after the link's rows", async () => {
      const older = Promise.withResolvers<{ data: StatusPageDomain[] }>();
      mockListDomains.mockReturnValueOnce(older.promise);
      vi.spyOn(console, "error").mockImplementation(() => {});
      wrapper = makeWrapper();
      await flushPromises();

      await wrapper.setProps({ initialDomains: [servingView()] });
      older.reject(new Error("late"));
      await flushPromises();

      expect(mockToast).not.toHaveBeenCalled();
      expect(find("status-page-domain-state-dom-1").text()).toBe("Serving");
    });

    describe("after a successful add", () => {
      const added = builtInView({ id: "added", domain: "new.brandname.com" });

      // The create call answers when `whileCreating` has run, so a test can act in between.
      async function addWhileOpen(whileCreating: () => void = () => {}) {
        const created = Promise.withResolvers<{ data: { id: string } }>();
        const reload = Promise.withResolvers<{ data: StatusPageDomain[] }>();
        mockCreateDomain.mockReturnValue(created.promise);
        mockListDomains.mockReturnValueOnce(reload.promise);
        await find("status-page-domain-input").setValue("new.brandname.com");
        // Real clock: Vue drops events stamped before a mocked Date.now.
        await find("status-page-domain-add-btn").trigger("click");
        whileCreating();
        created.resolve({ data: { id: "added" } });
        await flushPromises();
        return reload;
      }

      it("keeps the reload over a link read that started before the add", async () => {
        wrapper = makeWrapper({ initialDomains: [], initialDomainsReadSeq: nextDomainsReadSeq() });
        await flushPromises();
        const secondRead = nextDomainsReadSeq();
        const reload = await addWhileOpen();

        await wrapper.setProps({ initialDomains: [], initialDomainsReadSeq: secondRead });
        reload.resolve({ data: [added] });
        await flushPromises();

        expect(exists("status-page-domain-row-added")).toBe(true);
      });

      it("keeps the reload when the clock steps backward between the link read and the add", async () => {
        wrapper = makeWrapper({ initialDomains: [], initialDomainsReadSeq: nextDomainsReadSeq() });
        await flushPromises();
        const secondRead = nextDomainsReadSeq();
        const before = Date.now();
        const clock = vi.spyOn(Date, "now");
        const reload = await addWhileOpen(() => clock.mockReturnValue(before - 3_600_000));
        expect(Date.now()).toBeLessThan(before);
        clock.mockRestore();

        await wrapper.setProps({ initialDomains: [], initialDomainsReadSeq: secondRead });
        reload.resolve({ data: [added] });
        await flushPromises();

        expect(exists("status-page-domain-row-added")).toBe(true);
      });

      it("still applies a link read that started after the add", async () => {
        wrapper = makeWrapper({ initialDomains: [], initialDomainsReadSeq: nextDomainsReadSeq() });
        await flushPromises();
        const reload = await addWhileOpen();

        await wrapper.setProps({
          initialDomains: [added],
          initialDomainsReadSeq: nextDomainsReadSeq(),
        });
        reload.resolve({ data: [] });
        await flushPromises();

        expect(exists("status-page-domain-row-added")).toBe(true);
      });
    });
  });

  describe("expired", () => {
    beforeEach(async () => {
      await mountWith(proxyView({ serving_state: "expired", released_at: 1_700_600_000_000_000 }));
    });

    it("renders the sentence under an Expired badge, with no record", () => {
      expect(find("status-page-domain-state-dom-1").text()).toBe("Expired");
      expect(find("status-page-domain-expired-dom-1").text()).toBe("Expired. Add it again.");
      expect(wrapper.findAll("code")).toHaveLength(0);
      expect(exists("status-page-domain-keep-record-dom-1")).toBe(false);
    });

    it("offers no verify and no delete action", () => {
      expect(exists("status-page-domain-verify-dom-1")).toBe(false);
      expect(exists("status-page-domain-delete-dom-1")).toBe(false);
    });
  });

  describe("verify now", () => {
    it.each(ALL_STATES)(
      "is offered for %s only when pending and a record is shown",
      async (state) => {
        await mountWith(builtInView({ serving_state: state }));

        expect(exists("status-page-domain-verify-dom-1")).toBe(state === "pending");
      },
    );

    it("is offered to a proxy-mode pending claim too", async () => {
      await mountWith(proxyView());

      expect(exists("status-page-domain-verify-dom-1")).toBe(true);
    });

    it("replaces the row with the view the server returns", async () => {
      await mountWith(proxyView({ reason: "record_missing" }));
      mockVerifyDomain.mockResolvedValue({
        data: holder(proxyView(), { serving_state: "verified", reason: "proxy_mode" }),
      });

      await find("status-page-domain-verify-dom-1").trigger("click");
      await flushPromises();

      expect(mockVerifyDomain).toHaveBeenCalledWith("org-1", "dom-1");
      expect(find("status-page-domain-state-dom-1").text()).toBe("Verified");
      expect(reasonLine()).toBe(msg(`${R}proxyMode`));
      expect(exists("status-page-domain-verify-dom-1")).toBe(false);
      expect(exists("status-page-domain-expires-dom-1")).toBe(false);
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
      await mountWith(holder(offView(), { serving_state: "not_serving", reason: "plan_required" }));

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

  describe("the installation line", () => {
    const line = () => find("status-page-domain-installation");
    const bodyOf = (id: string) => find(`status-page-domain-installation-${id}`).text();

    async function mountAsRoot(body: DomainInstallation) {
      mockGetInstallation.mockResolvedValue({ data: body });
      await mountWith();
    }

    it("asks for the installation of the org, once", async () => {
      await mountAsRoot(installationBody());

      expect(mockGetInstallation).toHaveBeenCalledTimes(1);
      expect(mockGetInstallation).toHaveBeenCalledWith("org-1");
    });

    it("shows every field of a built-in installation", async () => {
      await mountAsRoot(builtInInstallation());

      expect(bodyOf("target")).toBe("domains.example.com");
      expect(bodyOf("target-resolves")).toBe("Yes");
      expect(bodyOf("wildcard-resolves")).toBe("Yes");
      expect(bodyOf("certificate")).toBe("2024-03-09 16:00");
      expect(bodyOf("key-check")).toBe("Key matches");
      expect(bodyOf("listeners")).toBe("1 reporting, last sync 2023-11-14 22:15");
      expect(bodyOf("last-validation")).toBe("2023-11-14 22:18");
      expect(bodyOf("last-ca-error")).toBe("2023-11-14 22:20: rate limited");
      expect(bodyOf("visitor-addresses")).toBe("Yes");
      expect(exists("status-page-domain-installation-not-ready")).toBe(false);
      expect(wrapper.text()).not.toContain("Proxy mode");
    });

    it("says why it is not ready, and shows the failed checks", async () => {
      await mountAsRoot(
        builtInInstallation({
          not_ready_reason: "wildcard_missing",
          wildcard_resolves: false,
          key_check: "mismatch",
          listeners: [],
        }),
      );

      expect(find("status-page-domain-installation-not-ready").text()).toBe(
        `Not ready: ${msg("statusPages.domains.installation.notReadyReason.wildcardMissing")}`,
      );
      expect(bodyOf("wildcard-resolves")).toBe("No");
      expect(bodyOf("key-check")).toBe("Key does not match");
      expect(bodyOf("listeners")).toBe("None reporting");
    });

    it("calls checkDomainInstallation from Check again and shows the body it returns", async () => {
      await mountAsRoot(builtInInstallation({ target_resolves: false }));
      mockCheckInstallation.mockResolvedValue({
        data: builtInInstallation({ target_resolves: true }),
      });
      expect(bodyOf("target-resolves")).toBe("No");

      await find("status-page-domain-installation-check").trigger("click");
      await flushPromises();

      expect(mockCheckInstallation).toHaveBeenCalledWith("org-1");
      expect(bodyOf("target-resolves")).toBe("Yes");
    });

    it("shows the API's message when the installation check is refused", async () => {
      await mountAsRoot(builtInInstallation());
      mockCheckInstallation.mockRejectedValue({
        response: { data: { message: "validation: this action needs built-in TLS" } },
      });

      await find("status-page-domain-installation-check").trigger("click");
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({
        variant: "error",
        message: "validation: this action needs built-in TLS",
      });
    });

    it("shows one sentence and no action for proxy mode, whose other fields are null", async () => {
      await mountAsRoot(installationBody({ enabled: true, tls: "proxy" }));

      expect(find("status-page-domain-installation-proxy").text()).toBe(
        "Proxy mode: your proxy terminates HTTPS. OpenObserve verifies ownership by TXT record and does not check certificates or reachability.",
      );
      expect(exists("status-page-domain-installation-check")).toBe(false);
      expect(line().findAll("dd")).toHaveLength(0);
    });

    it.each(["built_in", "proxy"] as const)(
      "shows the off sentence, naming both settings, and no action when disabled with tls %s",
      async (tls) => {
        await mountAsRoot(installationBody({ enabled: false, tls }));

        const sentence = find("status-page-domain-installation-off").text();
        expect(sentence).toBe(msg("statusPages.domains.installation.off"));
        expect(sentence).toContain("ZO_STATUS_PAGE_DOMAIN_TARGET");
        expect(sentence).toContain("ZO_STATUS_PAGE_DOMAIN_TLS=proxy");
        expect(sentence).toContain("always off in a super cluster");
        expect(exists("status-page-domain-installation-proxy")).toBe(false);
        expect(exists("status-page-domain-installation-check")).toBe(false);
      },
    );

    it("renders nothing and shows no toast for a 403", async () => {
      mockGetInstallation.mockRejectedValue({ response: { status: 403 } });
      await mountWith(builtInView());

      expect(line().exists()).toBe(false);
      expect(mockToast).not.toHaveBeenCalled();
      expect(exists("status-page-domain-row-dom-1")).toBe(true);
    });

    it("renders nothing, with no toast, when the request fails some other way", async () => {
      mockGetInstallation.mockRejectedValue(new Error("network"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      await mountWith();

      expect(line().exists()).toBe(false);
      expect(mockToast).not.toHaveBeenCalled();
    });
  });
});
