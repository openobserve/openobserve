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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import Invitations from "./Invitations.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createRouter, createWebHistory } from "vue-router";
import { createStore } from "vuex";
import InvitationList from "@/components/iam/users/InvitationList.vue";

installQuasar();

describe("Invitations", () => {
  let store: any;
  let router: any;

  beforeEach(() => {
    store = createStore({
      state: {
        userInfo: {
          email: "test@example.com",
        },
      },
    });

    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", name: "home", component: { template: "<div>Home</div>" } },
        { path: "/users", name: "users", component: { template: "<div>Users</div>" } },
      ],
    });
  });

  it("should render the Invitations component", () => {
    const wrapper = mount(Invitations, {
      global: {
        plugins: [store, router],
        stubs: {
          InvitationList: true,
        },
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should render InvitationList component", () => {
    const wrapper = mount(Invitations, {
      global: {
        plugins: [store, router],
        stubs: {
          InvitationList: true,
        },
      },
    });

    const invitationList = wrapper.findComponent({ name: "InvitationList" });
    expect(invitationList.exists()).toBe(true);
  });

  it("should pass userEmail prop to InvitationList", () => {
    const wrapper = mount(Invitations, {
      global: {
        plugins: [store, router],
        stubs: {
          InvitationList: true,
        },
      },
    });

    const invitationList = wrapper.findComponent({ name: "InvitationList" });
    expect(invitationList.props("userEmail")).toBe("test@example.com");
  });

  it("should handle invitations-processed event and navigate to users page", async () => {
    const routerPushSpy = vi.spyOn(router, "push");

    const wrapper = mount(Invitations, {
      global: {
        plugins: [store, router],
      },
    });

    const invitationList = wrapper.findComponent(InvitationList);

    // Emit the invitations-processed event with mock data
    await invitationList.vm.$emit("invitations-processed", {
      accepted: true,
      organization: {
        identifier: "org123",
      },
    });

    await flushPromises();

    expect(routerPushSpy).toHaveBeenCalledWith({
      name: "users",
      query: {
        org_identifier: "org123",
      },
    });
  });

  it("should not navigate if accepted is false", async () => {
    const routerPushSpy = vi.spyOn(router, "push");

    const wrapper = mount(Invitations, {
      global: {
        plugins: [store, router],
      },
    });

    const invitationList = wrapper.findComponent(InvitationList);

    // Emit event with accepted: false
    await invitationList.vm.$emit("invitations-processed", {
      accepted: false,
      organization: {
        identifier: "org123",
      },
    });

    await flushPromises();

    expect(routerPushSpy).not.toHaveBeenCalled();
  });

  it("should handle empty userEmail", () => {
    const emptyStore = createStore({
      state: {
        userInfo: {},
      },
    });

    const wrapper = mount(Invitations, {
      global: {
        plugins: [emptyStore, router],
        stubs: {
          InvitationList: true,
        },
      },
    });

    const invitationList = wrapper.findComponent({ name: "InvitationList" });
    expect(invitationList.props("userEmail")).toBe("");
  });
});
