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

import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach } from "vitest";
import { installQuasar } from "../helpers/install-quasar-plugin";
import ConfirmDialog from "../../../components/ConfirmDialog.vue";
import i18n from "../../../locales";
import { Dialog } from "quasar";

installQuasar({
  plugins: [Dialog],
});

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("ConfirmDialog", async () => {
  let wrapper: any = null;
  beforeEach(() => {
    // render the component
    wrapper = mount(ConfirmDialog, {
      attachTo: "#app",
      shallow: false,
      props: {
        title: "Dialog Title",
        message: "Dialog Message",
        confirmDelete: true,
        modelValue: true,
      },
      global: {
        plugins: [i18n],
      },
    });
  });

  it("should mount ConfirmDialog component", async () => {
    const documentWrapper = new DOMWrapper(document.body);
    const dialog = documentWrapper.find(".q-dialog");
    expect(dialog.exists()).toBeTruthy();
  });
});
