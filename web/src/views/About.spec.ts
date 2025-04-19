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
import About from "@/views/About.vue";
import { Quasar, Dialog, Notify } from "quasar";
import { expect, it } from "vitest";
import i18n from "@/locales";
import { createStore } from "vuex";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

installQuasar();
const store = createStore({
  state: {
    zoConfig: {
      version: "1",
      commit_hash: "test",
      build_date: "01-01-23",
    },
    API_ENDPOINT: "test",
  },
});
it("should mount About view", async () => {
  const wrapper = mount(About, {
    shallow: false,
    components: {
      Notify,
      Dialog,
    },
    global: {
      plugins: [i18n],
      provide: {
        store: store,
      },
    },
  });
  expect(About).toBeTruthy();
});
