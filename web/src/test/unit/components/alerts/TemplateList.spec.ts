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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "../../helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import TemplateList from "@/components/alerts/TemplateList.vue";
import i18n from "@/locales";
import store from "../../helpers/store";
import routes from "@/router/routes";
import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes,
});

installQuasar({
  plugins: [Dialog, Notify],
});

describe("Template List", async () => {
  let wrapper: any;
  beforeEach(() => {
    wrapper = mount(TemplateList, {
      global: {
        provide: {
          store: store,
        },
        plugins: [i18n, router],
      },
    });
  });

  // afterEach(() => {
  //   wrapper.unmount();
  // });

  it("Should render alerts title", () => {
    expect(wrapper.find('[data-test="alerts-list-title"]').text()).toBe(
      "Templates"
    );
  });
});
