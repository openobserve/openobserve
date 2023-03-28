import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { installQuasar } from "../helpers/install-quasar-plugin";
import MenuLink from "../../../components/MenuLink.vue";

installQuasar();

describe("MenuLink", async () => {
  let wrapper: any = null;
  beforeEach(() => {
    // render the component
    wrapper = mount(MenuLink, {
      shallow: false,
      props: {
        title: "Menu Title",
        caption: "",
        link: "#",
        icon: "",
        mini: false,
      },
    });
  });

  afterEach(() => {
    wrapper.unmount();
  });
  it("should mount MenuLink component", async () => {
    expect(wrapper).toBeTruthy();
  });
});
