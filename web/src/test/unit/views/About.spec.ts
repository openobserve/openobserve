// Copyright 2022 Zinc Labs Inc. and Contributors

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License. 

import { mount } from "@vue/test-utils";
import About from "../../../views/About.vue";
import { Quasar, Dialog, Notify } from "quasar";
import { expect, it } from "vitest";
import i18n from "../../../locales";

import { installQuasar } from "../helpers/install-quasar-plugin";

installQuasar();

it("should mount About view", async () => {
  const wrapper = mount(About, {
    shallow: false,
    components: {
      Notify,
      Dialog,
    },
    global: {
      plugins: [i18n],
    },
  });
  expect(About).toBeTruthy();
});
