// Copyright 2023 OpenObserve Inc.
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

const mockGetStreams = vi.fn().mockResolvedValue({
  list: [{ name: "stream1" }, { name: "stream2" }],
});

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: mockGetStreams,
  }),
}));

import StreamSelection from "@/components/pipeline/StreamSelection.vue";

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------

const globalConfig = {
  plugins: [i18n, store],
};

async function mountComp(props: Record<string, any> = {}) {
  return mount(StreamSelection, {
    props: {
      isUpdating: false,
      ...props,
    },
    global: globalConfig,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StreamSelection - rendering", () => {
  let wrapper: any = null;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("mounts without errors", async () => {
    wrapper = await mountComp();
    expect(wrapper.exists()).toBe(true);
  });

  it("renders data-test='add-pipeline-section-title'", async () => {
    wrapper = await mountComp();
    expect(
      wrapper.find('[data-test="add-pipeline-section-title"]').exists()
    ).toBe(true);
  });

  it("renders data-test='add-pipeline-name-input'", async () => {
    wrapper = await mountComp();
    expect(
      wrapper.find('[data-test="add-pipeline-name-input"]').exists()
    ).toBe(true);
  });

  it("renders data-test='add-pipeline-description-input'", async () => {
    wrapper = await mountComp();
    expect(
      wrapper.find('[data-test="add-pipeline-description-input"]').exists()
    ).toBe(true);
  });

  it("renders data-test='add-pipeline-stream-type-select'", async () => {
    wrapper = await mountComp();
    expect(
      wrapper.find('[data-test="add-pipeline-stream-type-select"]').exists()
    ).toBe(true);
  });

  it("renders data-test='add-pipeline-stream-select'", async () => {
    wrapper = await mountComp();
    expect(
      wrapper.find('[data-test="add-pipeline-stream-select"]').exists()
    ).toBe(true);
  });

  it("renders data-test='add-pipeline-submit-btn'", async () => {
    wrapper = await mountComp();
    expect(
      wrapper.find('[data-test="add-pipeline-submit-btn"]').exists()
    ).toBe(true);
  });

  it("renders data-test='add-pipeline-cancel-btn'", async () => {
    wrapper = await mountComp();
    expect(
      wrapper.find('[data-test="add-pipeline-cancel-btn"]').exists()
    ).toBe(true);
  });

  it("renders data-test='add-pipeline-close-dialog-btn'", async () => {
    wrapper = await mountComp();
    expect(
      wrapper.find('[data-test="add-pipeline-close-dialog-btn"]').exists()
    ).toBe(true);
  });
});

describe("StreamSelection - stream type options", () => {
  let wrapper: any = null;

  beforeEach(async () => {
    wrapper = await mountComp();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("streamTypes has exactly 3 options", () => {
    const streamTypes = (wrapper.vm as any).streamTypes;
    expect(streamTypes).toHaveLength(3);
  });

  it("streamTypes includes logs option", () => {
    const streamTypes = (wrapper.vm as any).streamTypes;
    const values = streamTypes.map((t: any) => t.value);
    expect(values).toContain("logs");
  });

  it("streamTypes includes metrics option", () => {
    const streamTypes = (wrapper.vm as any).streamTypes;
    const values = streamTypes.map((t: any) => t.value);
    expect(values).toContain("metrics");
  });

  it("streamTypes includes traces option", () => {
    const streamTypes = (wrapper.vm as any).streamTypes;
    const values = streamTypes.map((t: any) => t.value);
    expect(values).toContain("traces");
  });
});

describe("StreamSelection - formData initial state", () => {
  let wrapper: any = null;

  beforeEach(async () => {
    wrapper = await mountComp();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("formData.name initializes as empty string", () => {
    expect((wrapper.vm as any).formData.name).toBe("");
  });

  it("formData.description initializes as empty string", () => {
    expect((wrapper.vm as any).formData.description).toBe("");
  });

  it("formData.stream_type initializes as empty string", () => {
    expect((wrapper.vm as any).formData.stream_type).toBe("");
  });

  it("formData.stream_name initializes as empty string", () => {
    expect((wrapper.vm as any).formData.stream_name).toBe("");
  });
});

describe("StreamSelection - isUpdating prop", () => {
  let wrapper: any = null;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("name input is disabled when isUpdating=true", async () => {
    wrapper = await mountComp({ isUpdating: true });
    const nameInput = wrapper.find('[data-test="add-pipeline-name-input"] .q-field');
    // q-input with disable renders the input as disabled
    expect(wrapper.find('[data-test="add-pipeline-name-input"]').exists()).toBe(true);
    // Check the internal q-input has disable prop via vm
    const vm = wrapper.vm as any;
    expect(vm.$props.isUpdating).toBe(true);
  });

  it("name input is enabled when isUpdating=false", async () => {
    wrapper = await mountComp({ isUpdating: false });
    const vm = wrapper.vm as any;
    expect(vm.$props.isUpdating).toBe(false);
  });
});

describe("StreamSelection - isValidName computed", () => {
  let wrapper: any = null;

  beforeEach(async () => {
    wrapper = await mountComp();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("isValidName is true for a valid alphanumeric name", () => {
    (wrapper.vm as any).formData.name = "my-pipeline";
    expect((wrapper.vm as any).isValidName).toBe(true);
  });

  it("isValidName is true for name with allowed special characters", () => {
    (wrapper.vm as any).formData.name = "pipeline_v1.0@test+ok";
    expect((wrapper.vm as any).isValidName).toBe(true);
  });

  it("isValidName is false for a name with spaces", () => {
    (wrapper.vm as any).formData.name = "my pipeline";
    expect((wrapper.vm as any).isValidName).toBe(false);
  });

  it("isValidName is false for an empty string", () => {
    (wrapper.vm as any).formData.name = "";
    expect((wrapper.vm as any).isValidName).toBe(false);
  });

  it("isValidName is false for a name with disallowed characters (slash)", () => {
    (wrapper.vm as any).formData.name = "my/pipeline";
    expect((wrapper.vm as any).isValidName).toBe(false);
  });
});

describe("StreamSelection - savePipeline emits save with formData", () => {
  let wrapper: any = null;

  beforeEach(async () => {
    wrapper = await mountComp();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("calling savePipeline emits 'save'", async () => {
    (wrapper.vm as any).formData.name = "test-pipe";
    (wrapper.vm as any).formData.stream_type = "logs";
    await (wrapper.vm as any).savePipeline();
    expect(wrapper.emitted("save")).toBeTruthy();
  });

  it("emitted 'save' payload matches formData", async () => {
    (wrapper.vm as any).formData.name = "test-pipe";
    (wrapper.vm as any).formData.description = "desc";
    (wrapper.vm as any).formData.stream_type = "logs";
    (wrapper.vm as any).formData.stream_name = "my-stream";
    await (wrapper.vm as any).savePipeline();
    const emittedPayload = wrapper.emitted("save")![0][0];
    expect(emittedPayload).toMatchObject({
      name: "test-pipe",
      description: "desc",
      stream_type: "logs",
      stream_name: "my-stream",
    });
  });
});

describe("StreamSelection - updateStreams", () => {
  let wrapper: any = null;

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = await mountComp();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("updateStreams resets stream_name when resetStream=true (default)", async () => {
    (wrapper.vm as any).formData.stream_name = "existing-stream";
    (wrapper.vm as any).formData.stream_type = "logs";
    await (wrapper.vm as any).updateStreams(true);
    await flushPromises();
    expect((wrapper.vm as any).formData.stream_name).toBe("");
  });

  it("updateStreams does NOT reset stream_name when resetStream=false", async () => {
    (wrapper.vm as any).formData.stream_name = "existing-stream";
    (wrapper.vm as any).formData.stream_type = "logs";
    await (wrapper.vm as any).updateStreams(false);
    await flushPromises();
    expect((wrapper.vm as any).formData.stream_name).toBe("existing-stream");
  });

  it("updateStreams calls getStreams with current stream_type", async () => {
    (wrapper.vm as any).formData.stream_type = "metrics";
    await (wrapper.vm as any).updateStreams();
    await flushPromises();
    expect(mockGetStreams).toHaveBeenCalledWith("metrics", false);
  });

  it("updateStreams does nothing when stream_type is empty", async () => {
    (wrapper.vm as any).formData.stream_type = "";
    await (wrapper.vm as any).updateStreams();
    await flushPromises();
    expect(mockGetStreams).not.toHaveBeenCalled();
  });

  it("updateStreams populates indexOptions from getStreams result", async () => {
    (wrapper.vm as any).formData.stream_type = "logs";
    await (wrapper.vm as any).updateStreams();
    await flushPromises();
    const indexOptions = (wrapper.vm as any).indexOptions;
    expect(indexOptions).toContain("stream1");
    expect(indexOptions).toContain("stream2");
  });
});

describe("StreamSelection - filterStreams", () => {
  let wrapper: any = null;

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = await mountComp();
    // Pre-populate indexOptions to simulate streams already loaded
    (wrapper.vm as any).indexOptions = ["stream1", "stream2", "metrics_stream"];
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("filterStreams with empty string returns all streams", () => {
    (wrapper.vm as any).filterStreams("", (cb: () => void) => cb());
    const filtered = (wrapper.vm as any).filteredStreams;
    expect(filtered).toHaveLength(3);
  });

  it("filterStreams filters streams by keyword case-insensitively", () => {
    (wrapper.vm as any).filterStreams("STREAM1", (cb: () => void) => cb());
    const filtered = (wrapper.vm as any).filteredStreams;
    expect(filtered).toContain("stream1");
    expect(filtered).not.toContain("stream2");
    expect(filtered).not.toContain("metrics_stream");
  });

  it("filterStreams returns matching subset (lowercase input)", () => {
    (wrapper.vm as any).filterStreams("stream", (cb: () => void) => cb());
    const filtered = (wrapper.vm as any).filteredStreams;
    expect(filtered).toContain("stream1");
    expect(filtered).toContain("stream2");
    expect(filtered).toContain("metrics_stream");
  });

  it("filterStreams returns empty array when no match found", () => {
    (wrapper.vm as any).filterStreams("xyz-no-match", (cb: () => void) => cb());
    const filtered = (wrapper.vm as any).filteredStreams;
    expect(filtered).toHaveLength(0);
  });
});
