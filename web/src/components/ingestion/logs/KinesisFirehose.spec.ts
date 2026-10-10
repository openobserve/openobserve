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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import KinesisFirehose from "./KinesisFirehose.vue";

vi.mock("@/utils/zincutils", () => ({
  getEndPoint: vi.fn(() => ({
    url: "https://test.example.com:5080",
    host: "test.example.com",
    port: "5080",
    protocol: "https",
    tls: true,
  })),
  getIngestionURL: vi.fn(() => "https://test.example.com:5080"),
}));

vi.mock("@/components/ingestion/CredentialCodeBlock.vue", () => ({
  default: {
    name: "CredentialCodeBlock",
    props: ["content"],
    template: "<div class='copy-content'>{{ content }}</div>",
  },
}));

describe("KinesisFirehose.vue", () => {
  let wrapper: any;

  beforeEach(() => {
    const store = createStore({
      state: {
        selectedOrganization: {
          identifier: "test-org",
        },
      },
    });

    wrapper = mount(KinesisFirehose, {
      global: {
        plugins: [store],
      },
      props: {
        currOrgIdentifier: "test-org",
        currUserEmail: "test@example.com",
      },
    });
  });

  it("has the expected component name", () => {
    expect(wrapper.vm.$options.name).toBe("KinesisFirehose");
  });

  it("shows the org's Kinesis Firehose HTTP endpoint", () => {
    expect(wrapper.find(".copy-content").text()).toContain(
      "HTTP Endpoint: https://test.example.com:5080/aws/test-org/default/_kinesis_firehose",
    );
  });

  it("uses the basic passcode placeholder as the access key", () => {
    expect(wrapper.vm.content).toContain("Access Key: [BASIC_PASSCODE]");
  });
});
