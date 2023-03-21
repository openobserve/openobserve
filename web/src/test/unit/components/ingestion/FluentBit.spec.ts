import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "../../helpers/install-quasar-plugin";

import FluentBit from "../../../../components/ingestion/FluentBit.vue";

installQuasar();

describe("FluentBit", async () => {
  it("should mount FluentBit", async () => {
    const wrapper = mount(FluentBit, {
      shallow: false,
      props: {
        currOrgIdentifier: "zinc_next",
        currUserEmail: "tulsiraval2828@gmail.com",
      },
    });

    expect(wrapper.vm.currOrgIdentifier).not.toBe("");
    expect(wrapper.vm.currUserEmail).not.toBe("");
  });
});
