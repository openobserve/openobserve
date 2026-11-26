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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import AssistantAttachmentBlock, { attachmentKey } from "./AssistantAttachmentBlock.vue";

describe("AssistantAttachmentBlock", () => {
  it("labels today's block names and shows an unknown name as written (`30` §2.4)", () => {
    expect(attachmentKey("Log Entry")).toBe("assistant.attachment.logEntry");
    expect(attachmentKey(" query error ")).toBe("assistant.attachment.queryError");
    expect(attachmentKey("Widget")).toBeNull();
    const wrapper = mount(AssistantAttachmentBlock, { props: { name: "Widget", body: "x" } });
    expect(wrapper.text()).toContain("Widget");
  });

  it("is a collapsed row with the byte count that opens to the JSON as code", async () => {
    const wrapper = mount(AssistantAttachmentBlock, {
      props: { name: "Log Entry", body: '{"level":"error","msg":"<b>x</b>"}' },
    });
    expect(wrapper.text()).toContain("Log entry");
    expect(wrapper.text()).toMatch(/\d+ B/);
    expect(wrapper.find('[data-test="assistant-attachment"]').exists()).toBe(false);
    await wrapper.get("button").trigger("click");
    await flushPromises();
    const code = wrapper.get('[data-test="assistant-attachment"]');
    expect(code.text()).toContain('"level": "error"');
    expect(code.element.querySelector("b")).toBeNull();
  });

  it("renders the hidden chip instead when a share hid attachments (CT-13 AC 3)", () => {
    const wrapper = mount(AssistantAttachmentBlock, {
      props: { name: "Cell", body: "1", hidden: true },
    });
    expect(wrapper.get('[data-test="assistant-attachment-hidden"]').text()).toBe(
      "Attachment hidden",
    );
    expect(wrapper.find('[data-test="assistant-attachment-block"]').exists()).toBe(false);
  });
});
