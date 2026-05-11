import { describe, it } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import ColumnOrderPopUp from "@/components/dashboards/addPanel/ColumnOrderPopUp.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

const ODialogStub = {
  name: "ODialog",
  props: ["open","size","title","primaryButtonLabel","secondaryButtonLabel"],
  template: `<div data-test="o-dialog-stub"><slot /></div>`,
};

describe("debug", () => {
  it("dump", () => {
    const wrapper = mount(ColumnOrderPopUp, {
      props: { open: true, columnOrder: [], availableColumns: ["a"] },
      global: { plugins: [i18n, store], stubs: { ODialog: ODialogStub } },
    });
    console.log("HTML:", wrapper.html());
    const c = wrapper.findComponent({ name: "ODialog" });
    console.log("Found ODialog comp:", c.exists());
    console.log("Stub find:", wrapper.find('[data-test="o-dialog-stub"]').exists());
  });
});
