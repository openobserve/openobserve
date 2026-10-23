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

import axios from "axios";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import http from "./http";
import { raw } from "@/types/i18n";
import { provideFeatureLock } from "@/composables/useFeatureLock";
import { dismissAll, toast, toastRecords } from "@/lib/feedback/Toast/useToast";
import { useLicenseDeniedDialog } from "@/composables/useUnauthorizedErrorGrouper";

const errorHandler = () => {
  const use = vi.fn();
  vi.mocked(axios.create).mockReturnValue({ interceptors: { response: { use } } } as any);
  http();
  return use.mock.calls[0][1] as (error: unknown) => Promise<unknown>;
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

// What a gated page's catch site does: it toasts the server message, never the error itself.
const failAndToast = async (error: any) => {
  await errorHandler()(error).catch((err: any) => {
    toast({ variant: "error", message: raw(err?.response?.data?.message) });
  });
};

const feature = ref<string | null>("workflows");
let wrapper: VueWrapper | undefined;

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

afterEach(() => {
  wrapper?.unmount();
  dismissAll();
  useLicenseDeniedDialog().close();
});

describe("http on a license-locked page", () => {
  it("tags a denial of the locked feature and keeps its toast and dialog quiet", async () => {
    const error: any = denial("workflows", "Workflows is not in your license");
    await failAndToast(error);
    expect(error.licenseLocked).toBe(true);
    expect(toastRecords).toHaveLength(0);
    expect(useLicenseDeniedDialog().features.value).toBeNull();
  });

  it("still toasts a non-license error while the page is locked", async () => {
    await failAndToast(serverError("Header lookup failed"));
    expect(toastRecords.map((r) => r.message)).toEqual(["Header lookup failed"]);
  });

  it("still opens the dialog and toasts for a denial of another feature", async () => {
    const error: any = denial("ai_assistant", "AI assistant is not in your license");
    await failAndToast(error);
    expect(error.licenseLocked).toBeUndefined();
    expect(useLicenseDeniedDialog().features.value).toEqual(["ai_assistant"]);
    expect(toastRecords).toHaveLength(1);
  });

  it("opens the dialog when a denial names the locked feature and another one", async () => {
    await failAndToast(denial("workflows, oncall", "Not in your license"));
    expect(useLicenseDeniedDialog().features.value).toEqual(["workflows", "oncall"]);
  });

  it("toasts the same denial again once the page is no longer locked", async () => {
    await failAndToast(denial("workflows", "Workflows is not in your license"));
    feature.value = null;
    toast({ variant: "error", message: raw("Workflows is not in your license") });
    expect(toastRecords).toHaveLength(1);
  });
});
