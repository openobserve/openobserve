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
