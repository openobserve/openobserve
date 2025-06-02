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

import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import HighLight from "@/components/HighLight.vue";

installQuasar();

// const init = vi.fn()

describe("HighLight", async () => {
  let wrapper: any = null;
  beforeEach(() => {
    // render the component
    wrapper = mount(HighLight, {
      shallow: false,
      props: {
        content: "Content Data",
        queryString: "",
      },
    });
  });
  afterEach(() => {
    wrapper.unmount();
  });

  it("should mount HighLight component", async () => {
    expect(wrapper).toBeTruthy();
  });
  it("watcher - content", async () => {
    const localThis = {
      init: vi.fn(),
    };
    // await HighLight.watch.content.handler.call(localThis)

    // const init = vi.spyOn(HighLight.methods, 'init')
    // expect(HighLight.methods.init).toBeCalled()
  });
  it("watcher - queryString", () => {
    // const getKeywords = vi.fn()
    const localThis = {
      getKeywords: vi.fn(),
      init: vi.fn(),
    };
    // HighLight.watch.queryString.handler.call(localThis)
  });
});
