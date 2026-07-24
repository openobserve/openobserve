// Copyright 2026 OpenObserve Inc.
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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import PlayerEventsSidebar from "@/components/rum/PlayerEventsSidebar.vue";
import i18n from "@/locales";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

vi.mock("@/components/common/AppTabs.vue", () => ({
  default: {
    name: "AppTabs",
    template: `
      <div data-test="app-tabs">
        <div v-for="tab in tabs" :key="tab.value"
             @click="$emit('update:active-tab', tab.value)"
             data-test="tab-button">
          {{ tab.label }}
        </div>
      </div>
    `,
    props: ["tabs", "activeTab"],
    emits: ["update:active-tab"],
  },
}));

const stubs = {
  OInput: {
    template: `
      <div data-test="search-input">
        <input :value="modelValue" @input="$emit('update:model-value', $event.target.value)" />
      </div>
    `,
    props: [
      "modelValue",
      "size",
      "filled",
      "borderless",
      "dense",
      "clearable",
      "debounce",
      "placeholder",
    ],
    emits: ["update:model-value"],
  },
  OSelect: {
    template: `
      <div v-bind="$attrs">
        <select :value="modelValue" @change="$emit('update:model-value', Array.from($event.target.selectedOptions, o => o.value))">
          <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </div>
    `,
    inheritAttrs: false,
    props: [
      "modelValue",
      "options",
      "behavior",
      "multiple",
      "filled",
      "borderless",
      "dense",
      "emit-value",
      "size",
      "labelKey",
      "valueKey",
    ],
    emits: ["update:model-value"],
  },
  OSeparator: {
    template: '<hr data-test="separator" />',
  },
  OIcon: {
    template: '<i data-test="OIcon" :class="name"></i>',
    props: ["name", "size"],
  },
};

describe("PlayerEventsSidebar", () => {
  let wrapper: any;

  const mockEvents = [
    {
      id: "event1",
      type: "error",
      name: "TypeError: Cannot read property 'foo'",
      displayTime: "10:30",
      relativeTime: 1000,
    },
    {
      id: "event2",
      type: "action",
      name: "Button click on submit",
      displayTime: "10:32",
      relativeTime: 2000,
    },
    {
      id: "event3",
      type: "view",
      name: "Page navigation to /dashboard",
      displayTime: "10:35",
      relativeTime: 5000,
    },
  ];

  const mockSessionDetails = {
    user_email: "test@example.com",
    date: "2024-01-01 10:00:00",
    browser: "Chrome 120",
    os: "Windows 10",
    ip: "192.168.1.1",
    city: "New York",
    country: "USA",
  };

  function mountComponent(props: Record<string, any> = {}) {
    return mount(PlayerEventsSidebar, {
      attachTo: "#app",
      props: {
        events: mockEvents,
        sessionDetails: mockSessionDetails,
        ...props,
      },
      global: {
        plugins: [i18n],
        stubs,
      },
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // COMPONENT MOUNTING
  // ==========================================================================

  describe("Component Mounting", () => {
    it("should mount successfully without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render AppTabs component on mount", () => {
      expect(wrapper.find('[data-test="app-tabs"]').exists()).toBe(true);
    });

    it("should accept events, sessionDetails and trace-related props", () => {
      const propKeys = Object.keys(wrapper.vm.$props);
      expect(propKeys).toContain("events");
      expect(propKeys).toContain("sessionDetails");
      expect(propKeys).toContain("sessionId");
      expect(propKeys).toContain("currentTime");
      expect(propKeys).toContain("startTime");
      expect(propKeys).toContain("endTime");
    });
  });

  // ==========================================================================
  // TABS INTEGRATION
  // ==========================================================================

  describe("Tabs Integration", () => {
    it("should render AppTabs component", () => {
      expect(wrapper.findComponent({ name: "AppTabs" }).exists()).toBe(true);
    });

    it("should pass exactly 3 tabs to AppTabs with labels Breadcrumbs, Tags, and Traces", () => {
      const appTabs = wrapper.findComponent({ name: "AppTabs" });
      const tabs = appTabs.props("tabs");

      expect(tabs).toHaveLength(3);
      expect(tabs[0].value).toBe("breadcrumbs");
      expect(tabs[1].value).toBe("tags");
      expect(tabs[2].value).toBe("traces");
    });

    it("should include a traces tab in the tabs list", () => {
      const appTabs = wrapper.findComponent({ name: "AppTabs" });
      const tabs = appTabs.props("tabs");
      const traceTab = tabs.find((t: any) => t.value === "traces");

      expect(traceTab).toBeDefined();
      expect(traceTab.value).toBe("traces");
    });

    it("should show breadcrumbs content by default when component mounts", () => {
      expect(wrapper.find('[data-test="search-input"]').exists()).toBe(true);
    });

    it("should switch to tags tab content when AppTabs emits update:active-tab with tags", async () => {
      const appTabs = wrapper.findComponent({ name: "AppTabs" });

      await appTabs.vm.$emit("update:active-tab", "tags");
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="event-metadata"]').exists()).toBe(true);
    });

    it("should switch back to breadcrumbs content when AppTabs emits update:active-tab with breadcrumbs", async () => {
      const appTabs = wrapper.findComponent({ name: "AppTabs" });
      await appTabs.vm.$emit("update:active-tab", "tags");
      await wrapper.vm.$nextTick();

      await appTabs.vm.$emit("update:active-tab", "breadcrumbs");
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="search-input"]').exists()).toBe(true);
    });

    it("should not render event-metadata when breadcrumbs tab is active", () => {
      expect(wrapper.find('[data-test="event-metadata"]').exists()).toBe(false);
    });

    it("should not render search input when tags tab is active", async () => {
      const appTabs = wrapper.findComponent({ name: "AppTabs" });

      await appTabs.vm.$emit("update:active-tab", "tags");
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="search-input"]').exists()).toBe(false);
    });
  });

  // ==========================================================================
  // TAGS TAB CONTENT
  // ==========================================================================

  describe("Tags Tab Content", () => {
    beforeEach(async () => {
      const appTabs = wrapper.findComponent({ name: "AppTabs" });
      await appTabs.vm.$emit("update:active-tab", "tags");
      await wrapper.vm.$nextTick();
    });

    it("should display event-metadata section when tags tab is active", () => {
      expect(wrapper.find('[data-test="event-metadata"]').exists()).toBe(true);
    });

    it("should display user email text in metadata when sessionDetails has user_email", () => {
      expect(wrapper.find('[data-test="event-metadata"]').text()).toContain("test@example.com");
    });

    it("should render mail icon in metadata when tags tab is active", () => {
      const metadata = wrapper.find('[data-test="event-metadata"]');

      expect(metadata.find('[data-test="OIcon"].mail').exists()).toBe(true);
    });

    it("should display date text in metadata when sessionDetails has date", () => {
      expect(wrapper.find('[data-test="event-metadata"]').text()).toContain("2024-01-01 10:00:00");
    });

    it("should render schedule icon in metadata when tags tab is active", () => {
      const metadata = wrapper.find('[data-test="event-metadata"]');

      expect(metadata.find('[data-test="OIcon"].schedule').exists()).toBe(true);
    });

    it("should display browser and OS text in metadata", () => {
      expect(wrapper.find('[data-test="event-metadata"]').text()).toContain(
        "Chrome 120, Windows 10",
      );
    });

    it("should render settings icon in metadata when tags tab is active", () => {
      const metadata = wrapper.find('[data-test="event-metadata"]');

      expect(metadata.find('[data-test="OIcon"].settings').exists()).toBe(true);
    });

    it("should display IP address text in metadata when sessionDetails has ip", () => {
      expect(wrapper.find('[data-test="event-metadata"]').text()).toContain("192.168.1.1");
    });

    it("should render language icon in metadata when tags tab is active", () => {
      const metadata = wrapper.find('[data-test="event-metadata"]');

      expect(metadata.find('[data-test="OIcon"].language').exists()).toBe(true);
    });

    it("should display city and country text in metadata when sessionDetails has location", () => {
      expect(wrapper.find('[data-test="event-metadata"]').text()).toContain("New York, USA");
    });

    it("should display Unknown User when sessionDetails has null user_email", async () => {
      await wrapper.setProps({
        sessionDetails: { ...mockSessionDetails, user_email: null },
      });
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="event-metadata"]').text()).toContain("Unknown User");
    });
  });

  // ==========================================================================
  // BREADCRUMBS TAB CONTENT
  // ==========================================================================

  describe("Breadcrumbs Tab Content", () => {
    it("should render search input when breadcrumbs tab is active by default", () => {
      expect(wrapper.find('[data-test="search-input"]').exists()).toBe(true);
    });

    it("should render event type selector when breadcrumbs tab is active", () => {
      expect(wrapper.find('[data-test="player-events-filter-select"]').exists()).toBe(true);
    });

    it("should render separator when breadcrumbs tab is active", () => {
      expect(wrapper.find('[data-test="separator"]').exists()).toBe(true);
    });

    it("should render event rows when breadcrumbs tab is active with 3 events", () => {
      expect(wrapper.findAll('[data-test^="player-event-row"]').length).toBe(3);
    });
  });

  // ==========================================================================
  // EVENTS DISPLAY
  // ==========================================================================

  describe("Events Display", () => {
    it("should display 3 event rows when 3 events are provided", () => {
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(3);
    });

    it("should display event display time text in the error event row", () => {
      expect(wrapper.find('[data-test="player-event-row-error"]').text()).toContain("10:30");
    });

    it("should display event type text in the error event row", () => {
      expect(wrapper.find('[data-test="player-event-row-error"]').text()).toContain("Error");
    });

    it("should display event name text in the error event row", () => {
      expect(wrapper.find('[data-test="player-event-row-error"]').text()).toContain(
        "TypeError: Cannot read property 'foo'",
      );
    });

    it("should render event type badge for the error event", () => {
      expect(wrapper.find('[data-test="event-type-badge"]').exists()).toBe(true);
    });

    it("should render action event row for the action event", () => {
      expect(wrapper.find('[data-test="player-event-row-action"]').exists()).toBe(true);
      // Badge label comes from the `rumEventType` registry group (humanised: "action" → "Action").
      expect(wrapper.find('[data-test="player-event-row-action"]').text()).toContain("Action");
    });

    it("should provide title attribute equal to event name on event name element", () => {
      const firstEventName = wrapper.find('[data-test="event-name"]');

      expect(firstEventName.attributes("title")).toBe("TypeError: Cannot read property 'foo'");
    });

    it("should provide title attributes for all visible event name elements", () => {
      const eventNames = wrapper.findAll('[data-test="event-name"]');

      eventNames.forEach((name: any, index: number) => {
        expect(name.attributes("title")).toBe(mockEvents[index].name);
      });
    });
  });

  // ==========================================================================
  // EVENT FILTERING
  // ==========================================================================

  describe("Event Filtering", () => {
    it("should have all 4 event types selected by default", () => {
      expect(wrapper.vm.selectedEventTypes).toEqual(["error", "action", "view", "frustration"]);
    });

    it("should have correct event type options list", () => {
      expect(wrapper.vm.eventOptions).toEqual([
        { label: "Error", value: "error" },
        { label: "Action", value: "action" },
        { label: "View", value: "view" },
        { label: "Frustration", value: "frustration" },
      ]);
    });

    it("should show only matching event when search term filters by name", async () => {
      wrapper.vm.searchEvent = "Button";

      wrapper.vm.searchEvents("Button");
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(1);
      expect(wrapper.find('[data-test^="player-event-row"]').text()).toContain(
        "Button click on submit",
      );
    });

    it("should show only error event when selectedEventTypes is set to error only", async () => {
      wrapper.vm.selectedEventTypes = ["error"];

      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(1);
      expect(wrapper.find('[data-test^="player-event-row"]').text()).toContain("TypeError");
    });

    it("should perform case-insensitive search when search term is uppercase", async () => {
      wrapper.vm.searchEvents("BUTTON");
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(1);
      expect(wrapper.find('[data-test^="player-event-row"]').text()).toContain(
        "Button click on submit",
      );
    });

    it("should show all 3 events when search value is null", async () => {
      wrapper.vm.searchEvents(null);
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(3);
    });

    it("should show all 3 events when search value is empty string", async () => {
      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(3);
    });

    it("should show only 1 event when both type and text filters are combined", async () => {
      wrapper.vm.selectedEventTypes = ["action", "view"];

      wrapper.vm.searchEvents("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(1);
      expect(wrapper.find('[data-test^="player-event-row"]').text()).toContain("click on submit");
    });
  });

  // ==========================================================================
  // EVENT INTERACTION
  // ==========================================================================

  describe("Event Interaction", () => {
    it("should emit event-emitted with event-click and first event data when first row is clicked", async () => {
      const firstEvent = wrapper.find('[data-test^="player-event-row"]');

      await firstEvent.trigger("click");

      const emitted = wrapper.emitted("event-emitted");
      expect(emitted).toBeDefined();
      expect(emitted).toHaveLength(1);
      expect(emitted![0]).toEqual(["event-click", mockEvents[0]]);
    });

    it("should emit event-emitted with correct second event data when second row is clicked", async () => {
      const eventRows = wrapper.findAll('[data-test^="player-event-row"]');

      await eventRows[1].trigger("click");

      expect(wrapper.emitted("event-emitted")![0]).toEqual(["event-click", mockEvents[1]]);
    });

    it("should emit event-emitted twice when two different event rows are clicked", async () => {
      const eventRows = wrapper.findAll('[data-test^="player-event-row"]');

      await eventRows[0].trigger("click");
      await eventRows[1].trigger("click");

      expect(wrapper.emitted("event-emitted")).toHaveLength(2);
    });
  });

  // ==========================================================================
  // PROPS REACTIVITY
  // ==========================================================================

  describe("Props Reactivity", () => {
    it("should show only 1 event row when events prop is replaced with 1 event", async () => {
      const newEvents = [
        {
          id: "new1",
          type: "error",
          name: "New error",
          displayTime: "11:00",
          relativeTime: 6000,
        },
      ];

      await wrapper.setProps({ events: newEvents });
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(1);
      expect(wrapper.find('[data-test^="player-event-row"]').text()).toContain("New error");
    });

    it("should show 4 event rows when events prop grows by one additional event", async () => {
      const newEvents = [
        ...mockEvents,
        {
          id: "event4",
          type: "action",
          name: "New action",
          displayTime: "10:40",
          relativeTime: 6000,
        },
      ];

      await wrapper.setProps({ events: newEvents });
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(4);
    });

    it("should show no event rows when events prop is set to empty array", async () => {
      await wrapper.setProps({ events: [] });
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(0);
    });

    it("should update session details display when sessionDetails prop changes", async () => {
      const appTabs = wrapper.findComponent({ name: "AppTabs" });
      await appTabs.vm.$emit("update:active-tab", "tags");
      await wrapper.vm.$nextTick();

      await wrapper.setProps({
        sessionDetails: { ...mockSessionDetails, user_email: "updated@example.com" },
      });
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="event-metadata"]').text()).toContain("updated@example.com");
    });
  });

  // ==========================================================================
  // ACCESSIBILITY
  // ==========================================================================

  describe("Accessibility", () => {
    it("should preserve full long event name text in title attribute", async () => {
      const longEvent = {
        id: "long",
        type: "error",
        name: "This is a very long event name that exceeds 100 characters and should be truncated with ellipsis to prevent overflow and maintain readable layout for the user interface",
        displayTime: "11:00",
        relativeTime: 7000,
      };

      await wrapper.setProps({ events: [longEvent] });

      expect(wrapper.find('[data-test="event-name"]').attributes("title")).toBe(longEvent.name);
    });
  });

  // ==========================================================================
  // COMPONENT LIFECYCLE
  // ==========================================================================

  describe("Component Lifecycle", () => {
    it("should maintain type filter results after prop update with active text search", async () => {
      wrapper.vm.selectedEventTypes = ["error"];
      const newEvents = [
        {
          id: "new1",
          type: "error",
          name: "TypeError: test",
          displayTime: "11:00",
          relativeTime: 6000,
        },
        {
          id: "new2",
          type: "action",
          name: "Button click",
          displayTime: "11:01",
          relativeTime: 6100,
        },
      ];

      await wrapper.setProps({ events: newEvents });
      wrapper.vm.searchEvents("Type");
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(1);
      expect(wrapper.find('[data-test^="player-event-row"]').text()).toContain("TypeError");
    });
  });

  // ==========================================================================
  // FRUSTRATION SIGNALS
  // ==========================================================================

  describe("Frustration Signals", () => {
    const mockEventsWithFrustrations = [
      {
        id: "frustrated1",
        type: "action",
        name: "click on Submit Button",
        displayTime: "00:45",
        relativeTime: 45000,
        frustration_types: ["rage_click"],
      },
      {
        id: "frustrated2",
        type: "action",
        name: "click on Nav Menu",
        displayTime: "01:23",
        relativeTime: 83000,
        frustration_types: ["dead_click"],
      },
      {
        id: "normal1",
        type: "action",
        name: "click on Cancel",
        displayTime: "02:00",
        relativeTime: 120000,
        frustration_types: null,
      },
      {
        id: "frustrated3",
        type: "action",
        name: "click on Checkout",
        displayTime: "02:30",
        relativeTime: 150000,
        frustration_types: ["rage_click", "error_click"],
      },
    ];

    beforeEach(async () => {
      wrapper = mount(PlayerEventsSidebar, {
        attachTo: "#app",
        props: {
          events: mockEventsWithFrustrations,
          sessionDetails: mockSessionDetails,
        },
        global: {
          plugins: [i18n],
          stubs: {
            ...stubs,
            FrustrationEventBadge: {
              name: "FrustrationEventBadge",
              template: '<span data-test="frustration-badge-stub">{{ frustrationTypes }}</span>',
              props: ["frustrationTypes"],
            },
          },
        },
      });
      await flushPromises();
    });

    it("should render without errors when events have frustration_types", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should display all 4 event rows when all 4 mixed frustration events are provided", () => {
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(4);
    });

    it("should display all event names including non-frustrated events", () => {
      const text = wrapper.text();

      expect(text).toContain("click on Submit Button");
      expect(text).toContain("click on Nav Menu");
      expect(text).toContain("click on Cancel");
      expect(text).toContain("click on Checkout");
    });

    it("should have frustration option in event filter", () => {
      expect(wrapper.vm.eventOptions).toContainEqual({
        label: "Frustration",
        value: "frustration",
      });
    });

    it("should include frustration in default selected filters", () => {
      expect(wrapper.vm.selectedEventTypes).toContain("frustration");
    });

    it("should show only 3 frustrated event rows when frustration filter is active", async () => {
      wrapper.vm.selectedEventTypes = ["frustration"];

      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(3);
    });

    it("should not render the non-frustrated action when only frustration filter is active", async () => {
      wrapper.vm.selectedEventTypes = ["frustration"];

      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      const rows = wrapper.findAll('[data-test^="player-event-row"]');
      const renderedText = rows.map((r: any) => r.text()).join(" ");
      expect(renderedText).not.toContain("click on Cancel");
    });

    it("should show all 4 action rows when both action and frustration filters are selected", async () => {
      wrapper.vm.selectedEventTypes = ["action", "frustration"];

      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(4);
    });

    it("should show 1 event when frustration filter and Submit search are combined", async () => {
      wrapper.vm.selectedEventTypes = ["frustration"];

      wrapper.vm.searchEvents("Submit");
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(1);
      expect(wrapper.find('[data-test^="player-event-row"]').text()).toContain("Submit");
    });

    it("should combine error and frustration filters to show both types", async () => {
      const mixedEvents = [
        ...mockEventsWithFrustrations,
        {
          id: "error1",
          type: "error",
          name: "TypeError",
          displayTime: "03:00",
          relativeTime: 180000,
          frustration_types: null,
        },
      ];
      await wrapper.setProps({ events: mixedEvents });
      wrapper.vm.selectedEventTypes = ["error", "frustration"];

      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      const rows = wrapper.findAll('[data-test^="player-event-row"]');
      const renderedText = rows.map((r: any) => r.text()).join(" ");
      expect(renderedText).toContain("TypeError");
      expect(renderedText).toContain("Submit");
    });

    it("should show 1 frustrated event when events prop is replaced with 1 frustrated event", async () => {
      await wrapper.setProps({ events: [mockEventsWithFrustrations[0]] });

      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(1);
      expect(wrapper.find('[data-test^="player-event-row"]').text()).toContain(
        "click on Submit Button",
      );
    });

    it("should handle events with multiple frustration types without errors", () => {
      const multipleTypes = wrapper.vm.events.find((e: any) => e.id === "frustrated3");

      expect(multipleTypes.frustration_types).toHaveLength(2);
      expect(multipleTypes.frustration_types).toContain("rage_click");
      expect(multipleTypes.frustration_types).toContain("error_click");
    });

    it("should treat events with empty frustration_types array as non-frustrated", async () => {
      const eventWithEmptyArray = {
        id: "empty",
        type: "action",
        name: "click",
        displayTime: "00:00",
        relativeTime: 0,
        frustration_types: [],
      };
      await wrapper.setProps({ events: [eventWithEmptyArray] });
      wrapper.vm.selectedEventTypes = ["frustration"];

      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(0);
    });
  });
});
