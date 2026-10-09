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
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import enLocale from "@/locales/languages/en-US.json";
import GetStarted from "./GetStarted.vue";
import { makeGetStartedSchema } from "./GetStarted.schema";
import { FIRST_SOURCE_PREFILL_KEY } from "./firstSourceOptions";
import { gt } from "@/types/i18n";

const submitNewUserInfo = vi.fn();
vi.mock("@/services/billings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { submit_new_user_info: (...args: unknown[]) => submitNewUserInfo(...args) },
  });
});

const httpCalls = vi.fn();
vi.mock("@/services/http", () => ({
  default: () =>
    new Proxy(
      {},
      {
        get:
          (_target, method) =>
          (...args: unknown[]) => {
            httpCalls(method, ...args);
            return Promise.resolve({ status: 200, data: {} });
          },
      },
    ),
}));

const toastMock = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

const track = vi.fn();
vi.mock("@/services/product_analytics", () => ({
  default: { track: (...args: unknown[]) => track(...args) },
}));

const ORG = "test-org";
const EMAIL = "test@example.com";
const OPTION_IDS = [
  "kubernetes",
  "linux",
  "windows",
  "webserver",
  "otel",
  "http",
  "cloud",
  "rum",
  "llm",
  "agent",
  "unsure",
];

const makeStore = () =>
  createStore({
    state: {
      selectedOrganization: { identifier: ORG, name: "Test Organization" },
      theme: "light",
      userInfo: { email: EMAIL },
    },
  });

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: enLocale } });

const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/logs", name: "logs", component: { template: "<div />" } },
      { path: "/guide/:name", name: "guide", component: { template: "<div />" } },
      ...[
        "ingestFromKubernetes",
        "ingestFromLinux",
        "ingestFromWindows",
        "nginx",
        "otelCollector",
        "curl",
        "AWSConfig",
        "frontendMonitoring",
        "ai-integrations",
        "recommendedMcp",
      ].map((name) => ({ path: `/ingestion/${name}`, name, component: { template: "<div />" } })),
    ],
  });

const flush = async () => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
};

describe("GetStarted.vue", () => {
  let wrapper: VueWrapper | undefined;
  let router: Router;

  const mountAt = async (path = "/") => {
    router = makeRouter();
    await router.push(path);
    await router.isReady();
    wrapper = mount(GetStarted, { global: { plugins: [i18n, makeStore(), router] } });
    await flush();
    return wrapper;
  };

  const byTest = (id: string) => wrapper!.find(`[data-test="${id}"]`);

  const fillInputs = async () => {
    const inputs = wrapper!.findAllComponents({ name: "OInput" });
    await inputs[0].vm.$emit("update:modelValue", "From a friend");
    await inputs[1].vm.$emit("update:modelValue", "Company Inc");
  };

  const tickTerms = async () => {
    await wrapper!.findComponent({ name: "OCheckbox" }).vm.$emit("update:modelValue", true);
    await flush();
  };

  const pick = async (id: string) => {
    await wrapper!.findComponent({ name: "ORadioGroup" }).vm.$emit("update:modelValue", id);
    await flush();
  };

  const pickedValue = () =>
    wrapper!.findComponent({ name: "ORadioGroup" }).props("modelValue") as string | undefined;

  const pushSpy = () => vi.spyOn(router, "push");

  beforeEach(() => {
    submitNewUserInfo.mockReset();
    submitNewUserInfo.mockResolvedValue({ status: 200 });
    httpCalls.mockClear();
    toastMock.mockClear();
    track.mockClear();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("isFirstTimeLogin", "true");
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.restoreAllMocks();
  });

  describe("schema", () => {
    const schema = makeGetStartedSchema(gt);
    const valid = { hearAboutUs: "A friend", whereDoYouWork: "Acme", isAgree: true };

    it("requires both text answers, trimmed", () => {
      expect(schema.safeParse({ ...valid, hearAboutUs: "  " }).success).toBe(false);
      expect(schema.safeParse({ ...valid, whereDoYouWork: "" }).success).toBe(false);
      expect(schema.safeParse(valid).success).toBe(true);
    });

    it("requires Terms", () => {
      expect(schema.safeParse({ ...valid, isAgree: false }).success).toBe(false);
    });

    it("keeps the first source optional", () => {
      expect(schema.safeParse({ ...valid, firstSource: undefined }).success).toBe(true);
      expect(schema.safeParse({ ...valid, firstSource: "kubernetes" }).success).toBe(true);
    });
  });

  describe("content", () => {
    it("shows the welcome title and the trial subtitle", async () => {
      await mountAt();
      expect(byTest("onboarding-get-started-title").text()).toBe("Welcome to OpenObserve");
      expect(byTest("onboarding-get-started-subtitle").text()).toContain(
        "Your 14-day trial has started",
      );
    });

    it("matches a2: placeholders, the Terms wording and the hint under Terms", async () => {
      await mountAt();
      const inputs = wrapper!.findAllComponents({ name: "OInput" });
      expect(inputs.map((i) => i.find("input").attributes("placeholder"))).toEqual([
        "For example, a colleague or a blog post",
        "Company or team",
      ]);
      expect(byTest("onboarding-get-started-terms-link").text()).toBe("Terms of service");
      expect(byTest("onboarding-get-started-privacy-link").text()).toBe("Privacy policy");
      expect(byTest("onboarding-get-started-agree-hint").text()).toBe(
        "Needed to continue, even if you skip the questions.",
      );
    });

    it("offers exactly 11 sources in the approved order with their labels", async () => {
      await mountAt();
      const grid = byTest("onboarding-get-started-source-grid");
      expect(grid.exists()).toBe(true);
      const ids = grid
        .findAll('[data-test^="onboarding-get-started-source-"]')
        .map((el) => el.attributes("data-test")!.replace("onboarding-get-started-source-", ""));
      expect(ids).toEqual(OPTION_IDS);
      expect(grid.text()).toContain("Kubernetes");
      expect(grid.text()).toContain("Linux or VM host");
      expect(grid.text()).toContain("Logs over HTTP");
      expect(grid.text()).toContain("Let an AI agent set it up");
      expect(grid.text()).toContain("Not sure yet");
    });

    it("uses the data sources page's logos and a glyph where none exists", async () => {
      await mountAt();
      const srcs = wrapper!.findAll("img").map((img) => img.attributes("src") ?? "");
      for (const logo of [
        "kubernetes.svg",
        "linux.svg",
        "windows.svg",
        "nginx.svg",
        "otlp.svg",
        "aws.svg",
        "ai_icon.svg",
      ]) {
        expect(srcs.some((src) => src.includes(logo))).toBe(true);
      }
      expect(wrapper!.findAllComponents({ name: "OIcon" }).length).toBeGreaterThanOrEqual(4);
    });

    it("renders the grid as card radios", async () => {
      await mountAt();
      const radios = wrapper!.findAllComponents({ name: "ORadio" });
      expect(radios).toHaveLength(11);
      for (const radio of radios) expect(radio.props("variant")).toBe("card");
    });
  });

  describe("Terms gate, Skip and the pick", () => {
    it("disables Continue and Skip until Terms is ticked", async () => {
      await mountAt();
      expect(byTest("onboarding-get-started-submit-btn").attributes("disabled")).toBeDefined();
      expect(byTest("onboarding-get-started-skip-btn").attributes("disabled")).toBeDefined();
      await tickTerms();
      expect(byTest("onboarding-get-started-submit-btn").attributes("disabled")).toBeUndefined();
      expect(byTest("onboarding-get-started-skip-btn").attributes("disabled")).toBeUndefined();
    });

    it("never calls the API when Skip is forced while Terms is unticked", async () => {
      await mountAt();
      await (wrapper!.vm as unknown as { skip: () => Promise<void> }).skip();
      expect(submitNewUserInfo).not.toHaveBeenCalled();
    });

    it("skips with empty profiling answers, the pick and skipped true, and fires onboarding_questions_skipped", async () => {
      await mountAt();
      await fillInputs();
      await pick("linux");
      await tickTerms();
      await byTest("onboarding-get-started-skip-btn").trigger("click");
      await flush();
      expect(submitNewUserInfo).toHaveBeenCalledTimes(1);
      expect(submitNewUserInfo).toHaveBeenCalledWith(ORG, {
        from: "",
        company: "",
        first_source: "linux",
        skipped: true,
      });
      expect(track).toHaveBeenCalledWith("onboarding_questions_skipped", { first_source: "linux" });
      expect(track).toHaveBeenCalledWith("onboarding_get_started_submitted", {
        first_source: "linux",
        skipped: true,
      });
    });

    it("skips without the two text answers filled", async () => {
      await mountAt();
      await tickTerms();
      await byTest("onboarding-get-started-skip-btn").trigger("click");
      await flush();
      expect(submitNewUserInfo).toHaveBeenCalledWith(ORG, {
        from: "",
        company: "",
        first_source: undefined,
        skipped: true,
      });
      expect(track).toHaveBeenCalledWith("onboarding_questions_skipped", { first_source: null });
    });

    it("continues with the answers, the pick and skipped false", async () => {
      await mountAt();
      await fillInputs();
      await pick("kubernetes");
      await tickTerms();
      await byTest("onboarding-get-started-submit-btn").trigger("submit");
      await flush();
      expect(submitNewUserInfo).toHaveBeenCalledWith(ORG, {
        from: "From a friend",
        company: "Company Inc",
        first_source: "kubernetes",
        skipped: false,
      });
      expect(track).toHaveBeenCalledWith("onboarding_get_started_submitted", {
        first_source: "kubernetes",
        skipped: false,
      });
      expect(track).not.toHaveBeenCalledWith("onboarding_questions_skipped", expect.anything());
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    });

    it("does not submit Continue with Terms unticked", async () => {
      await mountAt();
      await fillInputs();
      await (
        wrapper!.findComponent({ name: "OForm" }).vm as unknown as {
          submit: () => void;
        }
      ).submit();
      await flush();
      expect(submitNewUserInfo).not.toHaveBeenCalled();
    });

    it("writes the pick only to localStorage o2.onboarding.firstSource.<org> and makes no other API call", async () => {
      await mountAt();
      const before = new Set(Object.keys(localStorage));
      await pick("otel");
      await tickTerms();
      await byTest("onboarding-get-started-skip-btn").trigger("click");
      await flush();
      expect(localStorage.getItem(`o2.onboarding.firstSource.${ORG}`)).toBe("otel");
      const added = Object.keys(localStorage).filter((key) => !before.has(key));
      expect(added).toEqual([`o2.onboarding.firstSource.${ORG}`]);
      expect(httpCalls).not.toHaveBeenCalled();
      expect(submitNewUserInfo).toHaveBeenCalledTimes(1);
    });

    it("stores no pick when none was chosen", async () => {
      await mountAt();
      await tickTerms();
      await byTest("onboarding-get-started-skip-btn").trigger("click");
      await flush();
      expect(localStorage.getItem(`o2.onboarding.firstSource.${ORG}`)).toBeNull();
    });

    it("clears the first-login flag and closes on success", async () => {
      await mountAt();
      await tickTerms();
      await byTest("onboarding-get-started-skip-btn").trigger("click");
      await flush();
      expect(localStorage.getItem("isFirstTimeLogin")).toBeNull();
      expect(wrapper!.emitted("removeFirstTimeLogin")).toEqual([[false]]);
    });
  });

  describe("a3/a4: in flight and failure", () => {
    it("locks every control while the call is in flight", async () => {
      let resolve: (value: { status: number }) => void = () => {};
      submitNewUserInfo.mockReturnValue(new Promise((r) => (resolve = r)));
      await mountAt();
      await tickTerms();
      await byTest("onboarding-get-started-skip-btn").trigger("click");
      await flushPromises();
      expect(byTest("onboarding-get-started-submit-btn").attributes("disabled")).toBeDefined();
      expect(byTest("onboarding-get-started-skip-btn").attributes("disabled")).toBeDefined();
      for (const input of wrapper!.findAllComponents({ name: "OInput" })) {
        expect(input.props("disabled")).toBe(true);
      }
      expect(wrapper!.findComponent({ name: "ORadioGroup" }).props("disabled")).toBe(true);
      resolve({ status: 200 });
      await flush();
    });

    it("shows today's error toast on a non-200 answer and keeps every answer", async () => {
      submitNewUserInfo.mockResolvedValue({ status: 500 });
      await mountAt();
      await fillInputs();
      await pick("webserver");
      await tickTerms();
      await byTest("onboarding-get-started-submit-btn").trigger("submit");
      await flush();
      expect(toastMock).toHaveBeenCalledWith({ message: "Something went wrong", variant: "error" });
      expect(wrapper!.emitted("removeFirstTimeLogin")).toBeUndefined();
      expect(localStorage.getItem("isFirstTimeLogin")).toBe("true");
      expect(pickedValue()).toBe("webserver");
      const inputs = wrapper!.findAllComponents({ name: "OInput" });
      expect(inputs[0].props("modelValue")).toBe("From a friend");
      expect(byTest("onboarding-get-started-submit-btn").attributes("disabled")).toBeUndefined();
    });

    it("shows the same toast when the call rejects, and Continue retries", async () => {
      submitNewUserInfo.mockRejectedValueOnce(new Error("network"));
      await mountAt();
      await fillInputs();
      await tickTerms();
      await byTest("onboarding-get-started-submit-btn").trigger("submit");
      await flush();
      expect(toastMock).toHaveBeenCalledWith({ message: "Something went wrong", variant: "error" });
      await byTest("onboarding-get-started-submit-btn").trigger("submit");
      await flush();
      expect(submitNewUserInfo).toHaveBeenCalledTimes(2);
      expect(wrapper!.emitted("removeFirstTimeLogin")).toEqual([[false]]);
    });
  });

  describe("routing after submit", () => {
    const skipWith = async (id?: string) => {
      if (id) await pick(id);
      await tickTerms();
      await byTest("onboarding-get-started-skip-btn").trigger("click");
      await flush();
    };

    it("opens the picked guide with the org and suppresses the connect-data-source popup", async () => {
      localStorage.setItem("connectDataSourcePromptPending", "true");
      await mountAt();
      const push = pushSpy();
      await skipWith("webserver");
      expect(push).toHaveBeenCalledWith({ name: "nginx", query: { org_identifier: ORG } });
      expect(sessionStorage.getItem(`connectDataSourcePromptShown:${EMAIL}`)).toBe("true");
      expect(localStorage.getItem("connectDataSourcePromptPending")).toBeNull();
    });

    it.each([
      ["kubernetes", "ingestFromKubernetes"],
      ["linux", "ingestFromLinux"],
      ["windows", "ingestFromWindows"],
      ["otel", "otelCollector"],
      ["http", "curl"],
      ["cloud", "AWSConfig"],
      ["rum", "frontendMonitoring"],
      ["llm", "ai-integrations"],
      ["agent", "recommendedMcp"],
    ])("routes %s to %s", async (id, route) => {
      await mountAt();
      const push = pushSpy();
      await skipWith(id);
      expect(push).toHaveBeenCalledWith({ name: route, query: { org_identifier: ORG } });
    });

    it("stays on today's landing for Not sure yet or no pick, and leaves the popup alone", async () => {
      for (const id of ["unsure", undefined]) {
        sessionStorage.clear();
        await mountAt();
        const push = pushSpy();
        await skipWith(id);
        expect(push).not.toHaveBeenCalled();
        expect(sessionStorage.getItem(`connectDataSourcePromptShown:${EMAIL}`)).toBeNull();
        wrapper!.unmount();
        wrapper = undefined;
      }
    });

    it("lets a followed redirectURI win: no guide route when the dialog is not on Home", async () => {
      await mountAt("/logs");
      const push = pushSpy();
      await skipWith("kubernetes");
      expect(push).not.toHaveBeenCalled();
      expect(localStorage.getItem(`o2.onboarding.firstSource.${ORG}`)).toBe("kubernetes");
    });

    it("lets a pending redirectURI or marketplace flow win", async () => {
      for (const [key, value] of [
        ["redirectURI", "/web/dashboards?x=1"],
        ["azure_marketplace_token", "tok"],
      ]) {
        sessionStorage.clear();
        sessionStorage.setItem(key, value);
        await mountAt();
        const push = pushSpy();
        await skipWith("kubernetes");
        expect(push).not.toHaveBeenCalled();
        wrapper!.unmount();
        wrapper = undefined;
      }
    });

    it("dispatches o2:onboarding-complete after the suppression is in place", async () => {
      await mountAt();
      let suppressedAtEvent: string | null = "unset";
      const listener = () => {
        suppressedAtEvent = sessionStorage.getItem(`connectDataSourcePromptShown:${EMAIL}`);
      };
      window.addEventListener("o2:onboarding-complete", listener);
      await skipWith("kubernetes");
      window.removeEventListener("o2:onboarding-complete", listener);
      expect(suppressedAtEvent).toBe("true");
    });
  });

  describe("prefill", () => {
    it("preselects the option named by utm_content", async () => {
      sessionStorage.setItem(FIRST_SOURCE_PREFILL_KEY, JSON.stringify({ utm_content: "rum" }));
      await mountAt();
      expect(pickedValue()).toBe("rum");
    });

    it("preselects from a mapped docs referrer", async () => {
      sessionStorage.setItem(
        FIRST_SOURCE_PREFILL_KEY,
        JSON.stringify({ referrer: "https://openobserve.ai/docs/ingestion/logs/kubernetes/" }),
      );
      await mountAt();
      expect(pickedValue()).toBe("kubernetes");
    });

    it("leaves no pick for an unknown value", async () => {
      sessionStorage.setItem(FIRST_SOURCE_PREFILL_KEY, JSON.stringify({ utm_content: "banner" }));
      await mountAt();
      expect(pickedValue()).toBeUndefined();
    });

    it("lets the user change a prefilled pick before Continue, and clears the prefill after", async () => {
      sessionStorage.setItem(
        FIRST_SOURCE_PREFILL_KEY,
        JSON.stringify({ utm_content: "kubernetes" }),
      );
      await mountAt();
      await fillInputs();
      await pick("windows");
      await tickTerms();
      await byTest("onboarding-get-started-submit-btn").trigger("submit");
      await flush();
      expect(submitNewUserInfo).toHaveBeenCalledWith(
        ORG,
        expect.objectContaining({ first_source: "windows" }),
      );
      expect(sessionStorage.getItem(FIRST_SOURCE_PREFILL_KEY)).toBeNull();
    });
  });

  describe("Terms and privacy links", () => {
    it("open the legal documents in a new tab", async () => {
      await mountAt();
      const terms = byTest("onboarding-get-started-terms-link");
      const privacy = byTest("onboarding-get-started-privacy-link");
      expect(terms.attributes("href")).toBe("https://openobserve.ai/legal/terms-of-service/");
      expect(privacy.attributes("href")).toBe("https://openobserve.ai/legal/privacy-policy/");
      expect(terms.attributes("target")).toBe("_blank");
    });
  });
});
