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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { HttpRejection } from "@/services/workflows";
import WorkflowHttpRejections from "./WorkflowHttpRejections.vue";

const t = (k: string, v?: Record<string, unknown>) => i18n.global.t(k, v ?? {});
const HOUR_US = 3_600_000_000;
const rej = (
  count: number,
  last = 1_792_575_542_000_000,
  windowStart = Date.now() * 1000 - HOUR_US,
): HttpRejection => ({
  count_24h: count,
  last_at: last,
  last_ip: "10.0.0.7",
  window_start: windowStart,
});

const mountRejections = (props: Record<string, unknown> = {}) =>
  mount(WorkflowHttpRejections, {
    props: {
      rejections: {
        invalid_token: rej(3),
        rate_limited: rej(9),
        credential_in_url: rej(1),
      },
      triggerLimit: 60,
      orgBudget: 1200,
      maxBodyBytes: 1_048_576,
      loading: false,
      error: false,
      canRaise: true,
      canRotate: true,
      ...props,
    },
    global: { plugins: [i18n, store] },
  });

const byTest = (w: ReturnType<typeof mountRejections>, id: string) => w.find(`[data-test="${id}"]`);
const open = async (w: ReturnType<typeof mountRejections>) =>
  byTest(w, "workflow-http-rejections-show").trigger("click");

describe("WorkflowHttpRejections", () => {
  it("summarises the total and the latest reason", () => {
    const w = mountRejections();
    const line = byTest(w, "workflow-http-rejections-line").text();
    expect(line).toContain("13");
    expect(line).toContain(t("workflow.http.reason.invalid_token.title"));
  });

  it("renders nothing at zero", () => {
    const w = mountRejections({ rejections: {} });
    expect(byTest(w, "workflow-http-rejections-line").exists()).toBe(false);
  });

  it("rows sort by count", async () => {
    const w = mountRejections();
    await open(w);
    const ids = w
      .findAll("[data-test^='workflow-http-rejection-']")
      .map((r) => r.attributes("data-test"))
      .filter((id) => !id?.endsWith("raise-limit") && !id?.endsWith("rotate"));
    expect(ids).toEqual([
      "workflow-http-rejection-rate_limited",
      "workflow-http-rejection-invalid_token",
      "workflow-http-rejection-credential_in_url",
    ]);
    expect(byTest(w, "workflow-http-rejection-rate_limited").text()).toContain("429");
    expect(byTest(w, "workflow-http-rejection-rate_limited").text()).toContain("10.0.0.7");
  });

  it("raise limit is hidden at the org budget", async () => {
    const below = mountRejections();
    await open(below);
    await byTest(below, "workflow-http-rejection-raise-limit").trigger("click");
    expect(below.emitted("raise-limit")).toHaveLength(1);
    const at = mountRejections({ triggerLimit: 1200 });
    await open(at);
    expect(byTest(at, "workflow-http-rejection-raise-limit").exists()).toBe(false);
  });

  it("credential_in_url links to rotate", async () => {
    const w = mountRejections();
    await open(w);
    await byTest(w, "workflow-http-rejection-rotate").trigger("click");
    expect(w.emitted("rotate")).toHaveLength(1);
  });

  it("a window that started 24 h ago or more counts nothing", async () => {
    const w = mountRejections({
      rejections: {
        invalid_token: rej(30, 1, Date.now() * 1000 - 25 * HOUR_US),
        rate_limited: rej(2),
      },
    });
    expect(byTest(w, "workflow-http-rejections-line").text()).toContain("2");
    expect(byTest(w, "workflow-http-rejections-line").text()).not.toContain("30");
    await open(w);
    expect(byTest(w, "workflow-http-rejection-invalid_token").exists()).toBe(false);
    const stale = mountRejections({
      rejections: { invalid_token: rej(30, 1, Date.now() * 1000 - 25 * HOUR_US) },
    });
    expect(byTest(stale, "workflow-http-rejections-line").exists()).toBe(false);
  });

  it("hides Raise limit and Rotate from a user who cannot do them", async () => {
    const w = mountRejections({ canRaise: false, canRotate: false });
    await open(w);
    expect(byTest(w, "workflow-http-rejection-rate_limited").exists()).toBe(true);
    expect(byTest(w, "workflow-http-rejection-raise-limit").exists()).toBe(false);
    expect(byTest(w, "workflow-http-rejection-rotate").exists()).toBe(false);
  });

  it("refresh refetches", async () => {
    const w = mountRejections();
    await open(w);
    await byTest(w, "workflow-http-rejections-refresh").trigger("click");
    expect(w.emitted("refresh")).toHaveLength(1);
  });

  it("loading shows 3 skeleton rows and an error shows Retry", async () => {
    const loading = mountRejections({ loading: true });
    await open(loading);
    expect(loading.findAll("[data-test='workflow-http-rejections-skeleton']")).toHaveLength(3);
    const failed = mountRejections({ error: true });
    await open(failed);
    expect(failed.text()).toContain(t("workflow.http.rejectionsLoadError"));
    await byTest(failed, "workflow-http-rejections-retry").trigger("click");
    expect(failed.emitted("refresh")).toHaveLength(1);
  });
});
