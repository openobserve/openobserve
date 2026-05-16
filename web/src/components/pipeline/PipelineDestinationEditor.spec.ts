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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useRoute: () => ({ query: {}, params: {} }),
}));

import PipelineDestinationEditor from "@/components/pipeline/PipelineDestinationEditor.vue";

// ---------------------------------------------------------------------------
// Stub for the heavy child component
// ---------------------------------------------------------------------------

const CreateDestinationFormStub = {
  name: "CreateDestinationForm",
  template: '<div data-test="create-destination-form-stub"></div>',
  props: ["destination"],
  emits: ["created", "updated", "cancel"],
};

const globalConfig = {
  plugins: [i18n, store],
  stubs: {
    CreateDestinationForm: CreateDestinationFormStub,
  },
};

async function mountComp(props: Record<string, any> = {}) {
  return mount(PipelineDestinationEditor, {
    props,
    global: globalConfig,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PipelineDestinationEditor - rendering", () => {
  let wrapper: any = null;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("mounts without errors when no destination prop is given", async () => {
    wrapper = await mountComp();
    expect(wrapper.exists()).toBe(true);
  });

  it("data-test='pipeline-destination-editor-title' exists", async () => {
    wrapper = await mountComp();
    expect(
      wrapper.find('[data-test="pipeline-destination-editor-title"]').exists()
    ).toBe(true);
  });

  it("shows addTitle text (v-else branch) when no destination prop is passed", async () => {
    wrapper = await mountComp();
    const titleEl = wrapper.find('[data-test="pipeline-destination-editor-title"]');
    // t("alert_destinations.addTitle") => "New Destination"
    expect(titleEl.text()).toContain("New Destination");
  });

  it("shows updateTitle + destination.name (v-if branch) when destination prop is provided", async () => {
    wrapper = await mountComp({ destination: { name: "my-dest" } });
    await flushPromises();
    const titleEl = wrapper.find('[data-test="pipeline-destination-editor-title"]');
    // t("alert_destinations.updateTitle") => "Update Destination"
    expect(titleEl.text()).toContain("Update Destination");
    expect(titleEl.text()).toContain("my-dest");
  });

  it("renders the CreateDestinationForm stub", async () => {
    wrapper = await mountComp();
    expect(
      wrapper.find('[data-test="create-destination-form-stub"]').exists()
    ).toBe(true);
  });

  it("renders the back arrow icon", async () => {
    wrapper = await mountComp();
    expect(wrapper.find(".OIcon").exists()).toBe(true);
  });
});

describe("PipelineDestinationEditor - back arrow click emits cancel", () => {
  let wrapper: any = null;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("emits 'cancel' when back arrow container is clicked", async () => {
    wrapper = await mountComp();
    // The clickable wrapper div is the parent of the OIcon
    const backDiv = wrapper.find(".cursor-pointer");
    expect(backDiv.exists()).toBe(true);
    await backDiv.trigger("click");
    expect(wrapper.emitted("cancel")).toBeTruthy();
    expect(wrapper.emitted("cancel")!.length).toBe(1);
  });
});

describe("PipelineDestinationEditor - CreateDestinationForm event forwarding", () => {
  let wrapper: any = null;

  beforeEach(async () => {
    wrapper = await mountComp({ destination: { name: "dest-x" } });
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("emits 'created' with destination name when CreateDestinationForm emits 'created'", async () => {
    const form = wrapper.findComponent(CreateDestinationFormStub);
    await form.vm.$emit("created", "new-dest");
    expect(wrapper.emitted("created")).toBeTruthy();
    expect(wrapper.emitted("created")![0]).toEqual(["new-dest"]);
  });

  it("emits 'updated' with destination name when CreateDestinationForm emits 'updated'", async () => {
    const form = wrapper.findComponent(CreateDestinationFormStub);
    await form.vm.$emit("updated", "updated-dest");
    expect(wrapper.emitted("updated")).toBeTruthy();
    expect(wrapper.emitted("updated")![0]).toEqual(["updated-dest"]);
  });

  it("emits 'cancel' when CreateDestinationForm emits 'cancel'", async () => {
    const form = wrapper.findComponent(CreateDestinationFormStub);
    await form.vm.$emit("cancel");
    expect(wrapper.emitted("cancel")).toBeTruthy();
    expect(wrapper.emitted("cancel")!.length).toBe(1);
  });
});

describe("PipelineDestinationEditor - CreateDestinationForm receives correct props", () => {
  let wrapper: any = null;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("passes destination prop to CreateDestinationForm when destination is provided", async () => {
    const dest = { name: "my-dest", url: "https://example.com" };
    wrapper = await mountComp({ destination: dest });
    await flushPromises();
    const form = wrapper.findComponent(CreateDestinationFormStub);
    expect(form.props("destination")).toEqual(dest);
  });

  it("passes undefined destination to CreateDestinationForm when no destination prop", async () => {
    wrapper = await mountComp();
    const form = wrapper.findComponent(CreateDestinationFormStub);
    expect(form.props("destination")).toBeUndefined();
  });
});

describe("PipelineDestinationEditor - v-if / v-else title branches", () => {
  let wrapper: any = null;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("v-if branch contains destination name for different destination objects", async () => {
    wrapper = await mountComp({ destination: { name: "pipeline-output-1" } });
    await flushPromises();
    const titleEl = wrapper.find('[data-test="pipeline-destination-editor-title"]');
    expect(titleEl.text()).toContain("pipeline-output-1");
  });

  it("v-else branch does NOT contain a destination name when prop is absent", async () => {
    wrapper = await mountComp();
    const titleEl = wrapper.find('[data-test="pipeline-destination-editor-title"]');
    expect(titleEl.text()).not.toContain("-");
  });
});
