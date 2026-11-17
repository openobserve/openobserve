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

// The real interceptor and the real access store, so a refused lookup is judged where the app records denials.
vi.unmock("@/services/http.ts");
vi.mock("@/aws-exports", () => ({ default: { isCloud: "false", isEnterprise: "true" } }));
vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  const create = () => {
    const onRequest: Array<(c: any) => any> = [];
    const onRejected: Array<(e: any) => any> = [];
    return {
      interceptors: {
        request: { use: (fn: (c: any) => any) => onRequest.push(fn) },
        response: { use: (_ok: unknown, fn: (e: any) => any) => onRejected.push(fn) },
      },
      get: (url: string, config: Record<string, unknown> = {}) => {
        const sent = onRequest.reduce((c, fn) => fn(c), { url, method: "get", ...config });
        const refused = {
          response: { status: 403, data: {} },
          request: { responseURL: `http://localhost:5080${url}` },
          config: sent,
        };
        return onRejected.reduce((p, fn) => p.catch(fn), Promise.reject(refused));
      },
    };
  };
  return { ...actual, default: { ...actual.default, create } };
});

import { defineComponent, h, reactive } from "vue";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { queryClient } from "@/composables/query/queryClient";
import { resetAccess, useAccessBoundary } from "@/composables/useAccessStore";
import alertsService from "@/services/alerts";
import { alertFolderOf, editAlertRoute } from "./alertEditorLink";

const state = reactive({ selectedOrganization: { identifier: "demo-org" }, userInfo: {} });
let access: ReturnType<typeof useAccessBoundary>;

const onDigestPage = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/alert-calibration/digests/:start/:end",
        name: "alertCalibrationDigest",
        component: { render: () => h("div") },
      },
    ],
  });
  await router.push("/alert-calibration/digests/1/2");
  const Host = defineComponent({
    setup() {
      access = useAccessBoundary();
      return () => h("div");
    },
  });
  mount(Host, { global: { plugins: [router], provide: { store: { state } } } });
};

describe("the folder lookup on a refusal", () => {
  beforeEach(async () => {
    queryClient.clear();
    resetAccess();
    await onDigestPage();
  });

  afterEach(() => {
    resetAccess();
  });

  it("a refused folder lookup records no access denial, and the link falls back as today", async () => {
    const folder = await alertFolderOf("demo-org", "a1", "ops_quiet");
    expect(folder).toBeUndefined();
    expect(editAlertRoute("demo-org", "a1", folder).query).toStrictEqual({
      org_identifier: "demo-org",
      prefill: "calibration",
    });
    expect(access.sectionEntries.value).toEqual([]);
    expect(access.pageDenied.value).toBeFalsy();
    expect(access.actionNotice.value).toBeFalsy();
  });

  it("the same refusal on an ordinary list read is recorded, so the check above can fail", async () => {
    await alertsService
      .listByFolderId(1, 1000, "name", false, "", "demo-org", "", "ops_quiet", "")
      .catch(() => undefined);
    expect(access.sectionEntries.value.map((e) => [e.resource.key, e.permission])).toEqual([
      ["alert_folders", "list"],
    ]);
  });
});
