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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import TemplatePreviewPanel from "./TemplatePreviewPanel.vue";
import templateService from "@/services/alert_templates";
import { emptyContentSpec } from "./contentSpec";

function makeStore() {
  return createStore({
    state: { selectedOrganization: { identifier: "test-org" } },
  });
}

function makePreviewResponse(overrides: Record<string, any> = {}) {
  return {
    data: {
      payload: { text: "hello" },
      preview_model: {
        title: "Alert fired",
        body_html: "<p>body</p>",
        fields: [{ label: "Stream", value: "default" }],
        links: [{ label: "View alert", url: "https://example.com" }],
        color: "#ff0000",
        severity: null,
        footer: null,
        chart_placeholder: null,
      },
      unknown_variables: [],
      ...overrides,
    },
  };
}

async function mountPanel(spec = emptyContentSpec()) {
  const w = mount(TemplatePreviewPanel, {
    props: { spec },
    global: {
      plugins: [i18n, makeStore()],
    },
  });
  await flushPromises();
  return w;
}

describe("TemplatePreviewPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("debounces two spec mutations within 300ms into one preview request", async () => {
    const previewSpy = vi
      .spyOn(templateService, "preview")
      .mockResolvedValue(makePreviewResponse() as any);

    const spec = emptyContentSpec();
    const w = mount(TemplatePreviewPanel, {
      props: { spec },
      global: { plugins: [i18n, makeStore()] },
    });

    // Let the initial mount's immediate-watch call resolve first.
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    previewSpy.mockClear();

    // Two mutations 100ms apart, both inside one 300ms debounce window —
    // must collapse into exactly one request.
    await w.setProps({ spec: { ...spec, title: "a" } });
    await vi.advanceTimersByTimeAsync(100);
    await w.setProps({ spec: { ...spec, title: "ab" } });
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();

    expect(previewSpy).toHaveBeenCalledTimes(1);
  });

  it("maps single_level severity to a null severity in the request", async () => {
    const previewSpy = vi
      .spyOn(templateService, "preview")
      .mockResolvedValue(makePreviewResponse() as any);

    await mountPanel();
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();

    expect(previewSpy).toHaveBeenCalled();
    const call = previewSpy.mock.calls[0][0] as any;
    expect(call.data.severity).toBeNull();
  });

  it("sends the selected non-single-level severity verbatim", async () => {
    const previewSpy = vi
      .spyOn(templateService, "preview")
      .mockResolvedValue(makePreviewResponse() as any);

    const w = await mountPanel();
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    previewSpy.mockClear();

    // Drive the internal severity ref directly via defineExpose (OSelect
    // interaction is exercised elsewhere; this isolates the mapping logic).
    (w.vm as any).severity = "critical";
    await flushPromises();
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();

    expect(previewSpy).toHaveBeenCalled();
    const call = previewSpy.mock.calls[0][0] as any;
    expect(call.data.severity).toBe("critical");
  });

  it("renders the raw payload tab as pretty-printed JSON", async () => {
    vi.spyOn(templateService, "preview").mockResolvedValue(makePreviewResponse() as any);

    const w = await mountPanel();
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();

    (w.vm as any).view = "raw";
    await flushPromises();

    const raw = w.find('[data-test="template-preview-panel-raw-json"]');
    expect(raw.exists()).toBe(true);
    expect(raw.text()).toContain('"text": "hello"');
  });

  it("renders the unknown-variables warning chip when non-empty", async () => {
    vi.spyOn(templateService, "preview").mockResolvedValue(
      makePreviewResponse({ unknown_variables: ["foo_bar"] }) as any,
    );

    const w = await mountPanel();
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();

    const chip = w.find('[data-test="template-preview-panel-unknown-variables-chip"]');
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("foo_bar");
  });

  it("names the previewed channel on the card, so switching Channel is visibly acknowledged", async () => {
    // The backend returns an IDENTICAL preview_model for every channel — only
    // `payload` differs. Without this badge the card does not change at all
    // when Channel changes, and the control looks broken. Reported from the
    // live UI: "the preview doesnt change when I change channel".
    vi.spyOn(templateService, "preview").mockResolvedValue(makePreviewResponse() as any);

    const w = await mountPanel();
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();

    const badge = w.find('[data-test="template-preview-panel-channel-badge"]');
    expect(badge.exists()).toBe(true);
    const slackLabel = badge.text();
    expect(slackLabel.length).toBeGreaterThan(0);

    // Switch to webhook: the badge must follow, and the caption must change to
    // the machine-consumer wording.
    const before = w.find('[data-test="template-preview-panel-fidelity-note"]').text();
    (w.vm as any).channel = "webhook";
    await flushPromises();
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();

    expect(w.find('[data-test="template-preview-panel-channel-badge"]').text()).not.toBe(
      slackLabel,
    );
    expect(w.find('[data-test="template-preview-panel-fidelity-note"]').text()).not.toBe(before);
  });

  it("does not render an unknown-variables chip when the list is empty", async () => {
    vi.spyOn(templateService, "preview").mockResolvedValue(makePreviewResponse() as any);

    const w = await mountPanel();
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();

    expect(w.find('[data-test="template-preview-panel-unknown-variables-warning"]').exists()).toBe(
      false,
    );
  });

  it("sanitizes body_html with DOMPurify before v-html — strips a <script> tag", async () => {
    vi.spyOn(templateService, "preview").mockResolvedValue(
      makePreviewResponse({
        preview_model: {
          title: "Alert fired",
          body_html: "<p>hello</p><script>window.__pwned = true;</script>",
          fields: [],
          links: [],
          color: "#ff0000",
          severity: null,
          footer: null,
          chart_placeholder: null,
        },
      }) as any,
    );

    const w = await mountPanel();
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();

    const body = w.find('[data-test="template-preview-panel-body"]');
    expect(body.exists()).toBe(true);
    expect(body.html()).not.toContain("<script");
    expect(body.html()).toContain("hello");
  });

  it("renders the default alert-URL link (footer) as a labeled button, not plain text", async () => {
    vi.spyOn(templateService, "preview").mockResolvedValue(
      makePreviewResponse({
        preview_model: {
          title: "Alert fired",
          body_html: "<p>body</p>",
          fields: [],
          links: [],
          color: "#ff0000",
          severity: null,
          footer: "https://o2.example/short/abc",
          chart_placeholder: null,
        },
      }) as any,
    );

    const w = await mountPanel();
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();

    // Old behavior rendered `footer` as bare text
    // (`template-preview-panel-footer`) — every real channel shows the
    // default alert-URL link as a styled button, so the preview must match.
    expect(w.find('[data-test="template-preview-panel-footer"]').exists()).toBe(false);
    const button = w.find('[data-test="template-preview-panel-default-link"]');
    expect(button.exists()).toBe(true);
    expect(button.text()).toBe("View in OpenObserve");
  });
});
