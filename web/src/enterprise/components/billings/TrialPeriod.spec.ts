import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { reactive } from "vue";
import TrialPeriod from "@/enterprise/components/billings/TrialPeriod.vue";
import i18n from "@/locales";

const awsConfig = vi.hoisted(() => ({ isCloud: "true" }));
vi.mock("@/aws-exports", () => ({ default: awsConfig }));

vi.mock("@/constants/config", () => ({
  siteURL: { contactSupport: "https://openobserve.ai/contactus/" },
}));

vi.mock("@/services/billings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list_subscription: vi.fn() },
  });
});
import BillingService from "@/services/billings";

const mockRouter = { push: vi.fn() };
vi.mock("vue-router", () => ({ useRouter: () => mockRouter }));

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-07T12:00:00Z").getTime();

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString(i18n.global.locale as unknown as string, {
    month: "short",
    day: "numeric",
  });

describe("TrialPeriod.vue", () => {
  let wrapper: ReturnType<typeof mount> | undefined;
  let store: any;
  let openSpy: ReturnType<typeof vi.fn>;

  const storeWith = (expiry: unknown) =>
    reactive({
      state: {
        organizationData: { organizationSettings: { free_trial_expiry: expiry } },
        selectedOrganization: { identifier: "acme_prod", label: "acme-prod" },
      },
    });

  const mountStrip = async (props: Record<string, unknown> = {}) => {
    wrapper = mount(TrialPeriod, {
      props,
      global: { plugins: [i18n], provide: { store } },
    });
    await flushPromises();
    return wrapper;
  };
  const strip = () => wrapper!.find('[data-test="trial-period-container"]');
  const expiryInDays = (days: number) => (NOW + days * DAY_MS) * 1000;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    awsConfig.isCloud = "true";
    vi.mocked(BillingService.list_subscription).mockResolvedValue({
      data: { provider: "stripe" },
    } as any);
    openSpy = vi.fn();
    Object.defineProperty(window, "open", { value: openSpy, writable: true });
    store = storeWith(expiryInDays(9.5));
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.useRealTimers();
  });

  describe("tone and text", () => {
    it("reads 'Trial period · N days left · ends <date>' in info tone above 3 days", async () => {
      await mountStrip({ currentPage: "usage" });

      expect(strip().attributes("data-tone")).toBe("info");
      expect(strip().text()).toContain("Trial period");
      expect(strip().text()).toContain("9 days left");
      expect(strip().text()).toContain(`ends ${shortDate(NOW + 9.5 * DAY_MS)}`);
    });

    it("turns warning at 3 days or fewer", async () => {
      store = storeWith(expiryInDays(3.5));
      await mountStrip({ currentPage: "usage" });

      expect(strip().attributes("data-tone")).toBe("warning");
      expect(strip().text()).toContain("3 days left");
    });

    it("uses the singular for one day", async () => {
      store = storeWith(expiryInDays(1.5));
      await mountStrip({ currentPage: "usage" });

      expect(strip().text()).toContain("1 day left");
    });

    it("reads 'ended <date>' in warning tone after expiry, naming the org", async () => {
      store = storeWith(expiryInDays(-2));
      await mountStrip({ currentPage: "billing" });

      expect(strip().attributes("data-tone")).toBe("warning");
      expect(strip().text()).toContain(`ended ${shortDate(NOW - 2 * DAY_MS)}`);
      expect(strip().text()).toContain("keep using acme-prod");
      expect(strip().text()).not.toContain("days left");
    });

    it("keeps 'ends <date>' while time remains under one day, and says ended only after expiry", async () => {
      store = storeWith(expiryInDays(0.5));
      await mountStrip({ currentPage: "usage" });

      expect(strip().attributes("data-tone")).toBe("warning");
      expect(strip().text()).toContain("less than a day left");
      expect(strip().text()).toContain(`ends ${shortDate(NOW + 0.5 * DAY_MS)}`);
      expect(strip().text()).not.toContain("ended");
    });
  });

  describe("reactive clock", () => {
    it("moves to the warning tone at the day boundary without a remount", async () => {
      store = storeWith(expiryInDays(4) + 60_000 * 1000);
      await mountStrip({ currentPage: "usage" });
      expect(strip().attributes("data-tone")).toBe("info");
      expect(strip().text()).toContain("4 days left");

      vi.advanceTimersByTime(60_001);
      await flushPromises();

      expect(strip().attributes("data-tone")).toBe("warning");
      expect(strip().text()).toContain("3 days left");
    });

    it("switches to the ended text when the trial runs out while open, not a day early", async () => {
      store = storeWith(expiryInDays(1) + 1000 * 1000);
      await mountStrip({ currentPage: "usage" });
      expect(strip().text()).toContain("1 day left");

      vi.advanceTimersByTime(1001);
      await flushPromises();
      expect(strip().text()).toContain("less than a day left");
      expect(strip().text()).not.toContain("ended");

      vi.advanceTimersByTime(DAY_MS);
      await flushPromises();
      expect(strip().text()).toContain("ended");
    });
  });

  describe("actions per page", () => {
    it("on Usage carries Compare plans and the end-of-trial line", async () => {
      await mountStrip({ currentPage: "usage" });

      expect(wrapper!.find('[data-test="trial-period-end-rule"]').text()).toBe(
        "When the trial ends, only Plans and settings open until you choose a plan.",
      );
      expect(wrapper!.find('[data-test="trial-period-contact-support-btn"]').exists()).toBe(false);
      await wrapper!.find('[data-test="trial-period-compare-plans-btn"]').trigger("click");
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "plans",
        query: { org_identifier: "acme_prod" },
      });
    });

    it("on Home > Usage (no page given) carries Compare plans, never Contact support", async () => {
      await mountStrip({});

      expect(wrapper!.find('[data-test="trial-period-end-rule"]').exists()).toBe(false);
      expect(wrapper!.find('[data-test="trial-period-contact-support-btn"]').exists()).toBe(false);
      await wrapper!.find('[data-test="trial-period-compare-plans-btn"]').trigger("click");
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "plans",
        query: { org_identifier: "acme_prod" },
      });
    });

    it("on Plans carries Contact support and no end-of-trial line", async () => {
      await mountStrip({ currentPage: "billing" });

      expect(wrapper!.find('[data-test="trial-period-end-rule"]').exists()).toBe(false);
      expect(wrapper!.find('[data-test="trial-period-compare-plans-btn"]').exists()).toBe(false);
      await wrapper!.find('[data-test="trial-period-contact-support-btn"]').trigger("click");
      expect(openSpy).toHaveBeenCalledWith("https://openobserve.ai/contactus/", "_blank");
    });
  });

  describe("who sees the strip", () => {
    it.each([
      ["missing", undefined],
      ["null", null],
      ["empty", ""],
    ])("shows nothing when free_trial_expiry is %s", async (_label, expiry) => {
      store = storeWith(expiry);
      await mountStrip({ currentPage: "usage" });

      expect(strip().exists()).toBe(false);
    });

    it("shows nothing when organizationSettings is absent", async () => {
      store = reactive({ state: { organizationData: {}, selectedOrganization: {} } });
      await mountStrip();

      expect(strip().exists()).toBe(false);
    });

    it("hides the strip for an AWS-billed org it looked up itself", async () => {
      vi.mocked(BillingService.list_subscription).mockResolvedValue({
        data: { provider: "aws" },
      } as any);
      await mountStrip({ currentPage: "billing" });

      expect(BillingService.list_subscription).toHaveBeenCalledWith("acme_prod");
      expect(strip().exists()).toBe(false);
    });

    it("trusts a provider handed in by the parent and skips its own lookup", async () => {
      await mountStrip({ currentPage: "usage", provider: "aws" });

      expect(BillingService.list_subscription).not.toHaveBeenCalled();
      expect(strip().exists()).toBe(false);
    });

    it("does not look up the provider outside Cloud", async () => {
      awsConfig.isCloud = "false";
      await mountStrip({ currentPage: "billing" });

      expect(BillingService.list_subscription).not.toHaveBeenCalled();
      expect(strip().exists()).toBe(true);
    });

    it("keeps the strip and logs a failed lookup that is not a 401", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(BillingService.list_subscription).mockRejectedValue({
        response: { status: 500 },
      });
      await mountStrip({ currentPage: "billing" });

      expect(strip().exists()).toBe(true);
      expect(error).toHaveBeenCalledTimes(1);
      error.mockRestore();
    });

    it("does not log a 401, which http.ts already handles", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(BillingService.list_subscription).mockRejectedValue({
        response: { status: 401 },
      });
      await mountStrip({ currentPage: "billing" });

      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
    });
  });
});
