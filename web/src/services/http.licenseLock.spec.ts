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

vi.unmock("@/services/http.ts");
vi.mock("../stores", () => ({
  default: { state: { API_ENDPOINT: "http://localhost:5080", zoConfig: {} }, dispatch: vi.fn() },
}));
vi.mock("../aws-exports", () => ({ default: { isCloud: "false", isEnterprise: "true" } }));
vi.mock("@/utils/zincutils", () => ({ useLocalCurrentUser: vi.fn(), useLocalUserInfo: vi.fn() }));
vi.mock("axios");
// Spy on toast but keep the real store, so error-toast dedupe is still exercised.
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>();
  return { ...actual, toast: vi.fn(actual.toast) };
});

import axios from "axios";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import http from "./http";
import { installFetchLicenseReceiver } from "./licenseDenialReceiver";
import { raw } from "@/types/i18n";
import { provideFeatureLock } from "@/composables/useFeatureLock";
import { dismissAll, toast, toastRecords } from "@/lib/feedback/Toast/useToast";
import { clearLicenseDenials } from "@/composables/useLicenseDenials";

// Sends the request config through the instance's request interceptor, then fails it with `error`.
const sendAndFail = (error: any, beforeResponse: () => void = () => {}) => {
  const onRequest = vi.fn();
  const onResponse = vi.fn();
  vi.mocked(axios.create).mockReturnValue({
    interceptors: { request: { use: onRequest }, response: { use: onResponse } },
  } as any);
  http();
  error.config = onRequest.mock.calls[0][0](error.config);
  beforeResponse();
  return onResponse.mock.calls[0][1](error) as Promise<unknown>;
};

const denial = (features: string, message: string) => ({
  response: { status: 403, data: { code: 40001, error_detail: features, message } },
  request: { responseURL: "http://localhost:5080/api/org/x" },
  config: { url: "/api/org/x" },
});

const serverError = (message: string) => ({
  response: { status: 500, data: { message } },
  request: { responseURL: "http://localhost:5080/api/org/x" },
  config: { url: "/api/org/x" },
});

// Most catch sites toast a fixed or generic message, not the server's.
const genericToast = () =>
  toast({ variant: "error", message: raw("Request failed with status code 403") });

const failAndToast = (error: any, beforeResponse?: () => void) =>
  sendAndFail(error, beforeResponse).catch(genericToast);

// A path change between the request starting and its response.
const navigate = () => {
  vi.setSystemTime(Date.now() + 1);
  clearLicenseDenials();
};

const denialToasts = () => vi.mocked(toast).mock.calls.filter(([o]) => o.variant === "warning");
// Record-store view of the error toasts only; the denial warning also lands there.
const errorRecords = () => toastRecords.filter((r) => r.variant === "error");

const feature = ref<string | null>("workflows");
let wrapper: VueWrapper | undefined;

let now = 0;
// Each test starts past the previous one's toast window.
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: (now += 5000) }));

afterEach(() => {
  // Clear while the fake clock runs, or pageChangedAt lands in real time and rejects every later request.
  clearLicenseDenials();
  vi.useRealTimers();
  wrapper?.unmount();
  wrapper = undefined;
  dismissAll();
  vi.mocked(toast).mockClear();
});

describe("http on a license-locked page", () => {
  beforeEach(() => {
    feature.value = "workflows";
    wrapper = mount(
      defineComponent({
        setup() {
          provideFeatureLock(feature);
          return () => null;
        },
      }),
    );
  });

  it("keeps a denial of the locked feature without a denial toast and out of error toasts", async () => {
    await failAndToast(denial("workflows", "Workflows is not in your license"));
    expect(errorRecords()).toHaveLength(0);
    expect(denialToasts()).toHaveLength(0);
  });

  it("still toasts a non-license error when no denial preceded it", async () => {
    await sendAndFail(serverError("Header lookup failed")).catch(() =>
      toast({ variant: "error", message: raw("A new version is available, refresh") }),
    );
    expect(errorRecords().map((r) => r.message)).toEqual(["A new version is available, refresh"]);
  });

  it("keeps a denial of another feature without a denial toast and out of error toasts", async () => {
    await failAndToast(denial("ai_assistant", "AI assistant is not in your license"));
    expect(denialToasts()).toHaveLength(0);
    expect(errorRecords()).toHaveLength(0);
  });

  it("keeps a denial naming the locked feature and another without a denial toast", async () => {
    await failAndToast(denial("workflows, oncall", "Not in your license"));
    expect(denialToasts()).toHaveLength(0);
  });
});

describe("http with no page locked", () => {
  it("shows one denial warning and drops the catch site's generic toast", async () => {
    await failAndToast(denial("workflows", "Workflows needs a license"));
    expect(denialToasts()).toHaveLength(1);
    expect(denialToasts()[0][0].variant).toBe("warning");
    expect(errorRecords()).toHaveLength(0);
  });

  it("warns once per feature set until the page changes, and again for a different set", async () => {
    await failAndToast(denial("workflows", "Workflows needs a license"));
    await failAndToast(denial("workflows", "Workflows needs a license"));
    expect(denialToasts()).toHaveLength(1);
    await failAndToast(denial("oncall", "Oncall needs a license"));
    expect(denialToasts()).toHaveLength(2);
    navigate();
    await failAndToast(denial("workflows", "Workflows needs a license"));
    expect(denialToasts()).toHaveLength(3);
  });

  it("toasts again once the denial's window has passed", async () => {
    await failAndToast(denial("workflows", "Workflows needs a license"));
    vi.setSystemTime(Date.now() + 2000);
    genericToast();
    expect(errorRecords()).toHaveLength(1);
  });

  it("still toasts a non-license error", async () => {
    await sendAndFail(serverError("Header lookup failed")).catch((err: any) =>
      toast({ variant: "error", message: raw(err.response.data.message) }),
    );
    expect(errorRecords().map((r) => r.message)).toEqual(["Header lookup failed"]);
  });

  it("keeps a denial of a request the previous page started without a denial toast, and out of error toasts", async () => {
    await failAndToast(denial("workflows", "Workflows needs a license"), navigate);
    expect(denialToasts()).toHaveLength(0);
    expect(errorRecords()).toHaveLength(0);
  });
});

describe("fetch license receiver", () => {
  const nativeFetch = window.fetch;
  const respond = (url: string, status: number, body: string, beforeResponse = () => {}) => {
    const response = new Response(body, { status });
    Object.defineProperty(response, "url", { value: url });
    window.fetch = vi.fn(async () => {
      beforeResponse();
      return response;
    });
    installFetchLicenseReceiver();
    return response;
  };
  const licenseBody = JSON.stringify({
    code: 40001,
    message: "Features not included in your license: oncall",
    error_detail: "oncall",
  });

  afterEach(() => {
    window.fetch = nativeFetch;
  });

  it("sends a 403 + 40001 from the API to a warning toast and returns the response untouched", async () => {
    const response = respond("http://localhost:5080/api/org/oncall", 403, licenseBody);
    const got = await fetch("http://localhost:5080/api/org/oncall");
    expect(got).toBe(response);
    expect(denialToasts()).toHaveLength(1);
    genericToast();
    expect(errorRecords()).toHaveLength(0);
  });

  it("keeps a denial of a request the previous page started without a denial toast, and out of error toasts", async () => {
    respond("http://localhost:5080/api/org/oncall", 403, licenseBody, navigate);
    await fetch("http://localhost:5080/api/org/oncall");
    expect(denialToasts()).toHaveLength(0);
    genericToast();
    expect(errorRecords()).toHaveLength(0);
  });

  it("ignores a 403 that is not a license denial", async () => {
    respond("http://localhost:5080/api/org/x", 403, JSON.stringify({ code: 403 }));
    await fetch("http://localhost:5080/api/org/x");
    expect(denialToasts()).toHaveLength(0);
  });

  it("ignores a license-shaped 403 from another origin", async () => {
    respond("https://elsewhere.example/api/org/oncall", 403, licenseBody);
    await fetch("https://elsewhere.example/api/org/oncall");
    expect(denialToasts()).toHaveLength(0);
  });

  it("returns a 403 whose body is not JSON without throwing", async () => {
    const response = respond("http://localhost:5080/api/org/x", 403, "<html>forbidden</html>");
    await expect(fetch("http://localhost:5080/api/org/x")).resolves.toBe(response);
    expect(await response.text()).toBe("<html>forbidden</html>");
    expect(denialToasts()).toHaveLength(0);
  });
});
