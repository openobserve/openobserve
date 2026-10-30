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

import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

const copyMock = vi.fn();
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (...args: unknown[]) => copyMock(...args),
}));

const downloadMock = vi.fn(() => true);
vi.mock("@/utils/dom", () => ({ downloadFile: (...args: unknown[]) => downloadMock(...args) }));

import ExportResourceDialog from "./ExportResourceDialog.vue";
import { raw } from "@/types/i18n";

const i18n = createI18n({
  locale: "en",
  messages: {
    en: {
      common: {
        download: "Download",
        close: "Close",
        copy: "Copy",
        copySuccess: "Copied",
        copyContentError: "Copy failed",
        exportTerraformTabTooltip: "Works with either tool",
        exportTerraformEmpty: "No Terraform resource exists",
        exportTerraformSkipped: "Not included: {names}",
        exportTerraformDropped: "Left out: {fields}",
      },
    },
  },
});

// Records what the Monaco wrapper is handed, which is the whole contract here.
// `readOnly` is declared with its type, as the real component does: a valueless
// attribute only casts to `true` for a Boolean prop.
const QueryEditorStub = {
  name: "QueryEditor",
  props: {
    query: { type: String, default: "" },
    language: { type: String, default: "" },
    editorId: { type: String, default: "" },
    readOnly: { type: Boolean, default: false },
  },
  template:
    '<div class="editor" :data-language="language" :data-readonly="String(readOnly)">{{ query }}</div>',
};

const stubs = {
  // reka-ui's dialog portals to <body>; a passthrough keeps the body inspectable.
  ODialog: { template: "<div><slot /></div>" },
  QueryEditor: QueryEditorStub,
  OTooltip: true,
};

const terraform = {
  hcl: 'resource "openobserve_alert" "x" {}\n',
  unsupported: [],
  droppedFields: [],
};

const mountDialog = (props: Record<string, unknown> = {}) =>
  mount(ExportResourceDialog, {
    props: {
      open: true,
      items: [{ name: "high error rate" }],
      terraform,
      title: raw("Export alert"),
      subTitle: raw("Review it"),
      ...props,
    } as any,
    global: { plugins: [i18n], stubs },
  });

const editor = (w: any) => w.find(".editor");

describe("ExportResourceDialog", () => {
  beforeEach(() => {
    copyMock.mockClear();
    downloadMock.mockClear();
  });

  it("opens on JSON, read-only, with the payload as the editor's content", () => {
    const wrapper = mountDialog();

    expect(editor(wrapper).attributes("data-language")).toBe("json");
    expect(editor(wrapper).attributes("data-readonly")).toBe("true");
    expect(editor(wrapper).text()).toContain('"name": "high error rate"');
  });

  it("switches the editor to hcl on the Terraform tab", async () => {
    const wrapper = mountDialog();
    (wrapper.vm as any).format = "terraform";
    await wrapper.vm.$nextTick();

    expect(editor(wrapper).attributes("data-language")).toBe("hcl");
    expect(editor(wrapper).text()).toContain('resource "openobserve_alert"');
  });

  it("names the file after the item, by format", async () => {
    const wrapper = mountDialog();
    expect(wrapper.text()).toContain("high-error-rate.json");

    (wrapper.vm as any).format = "terraform";
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("high-error-rate.tf");
  });

  it("copies the format currently shown", async () => {
    const wrapper = mountDialog();

    await wrapper.find('[data-test="export-resource-dialog-copy-btn"]').trigger("click");
    expect(copyMock.mock.calls[0][0]).toContain('"name": "high error rate"');

    (wrapper.vm as any).format = "terraform";
    await wrapper.vm.$nextTick();
    await wrapper.find('[data-test="export-resource-dialog-copy-btn"]').trigger("click");
    expect(copyMock.mock.calls[1][0]).toContain('resource "openobserve_alert"');
  });

  it("reports an unconvertible selection instead of showing an empty editor", async () => {
    const wrapper = mountDialog({
      terraform: {
        hcl: "",
        unsupported: [{ name: "traffic anomaly", reason: "anomaly" }],
        droppedFields: [],
      },
    });
    (wrapper.vm as any).format = "terraform";
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-test="export-resource-dialog-terraform-empty"]').exists()).toBe(
      true,
    );
    expect(editor(wrapper).exists()).toBe(false);
  });

  it("surfaces skipped items and dropped fields alongside the config", async () => {
    const wrapper = mountDialog({
      terraform: {
        ...terraform,
        unsupported: [{ name: "traffic anomaly", reason: "anomaly" }],
        droppedFields: ["having.ignore_case"],
      },
    });
    (wrapper.vm as any).format = "terraform";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("traffic anomaly");
    expect(wrapper.text()).toContain("having.ignore_case");
    expect(editor(wrapper).exists()).toBe(true);
  });
});
