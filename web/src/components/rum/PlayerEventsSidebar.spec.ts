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
    props: ["modelValue", "size", "filled", "borderless", "dense", "clearable", "debounce", "placeholder"],
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
    props: ["modelValue", "options", "behavior", "multiple", "filled", "borderless", "dense", "emit-value", "size", "labelKey", "valueKey"],
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
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // COMPONENT MOUNTING
  // ==========================================================================

  describe("Component Mounting", () => {
    it("mounts successfully without errors", () => {
      // Arrange & Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("renders AppTabs component on mount", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="app-tabs"]').exists()).toBe(true);
    });
  });

  // ==========================================================================
  // TABS INTEGRATION
  // ==========================================================================

  describe("Tabs Integration", () => {
    it("renders AppTabs component", () => {
      // Arrange & Assert
      expect(wrapper.findComponent({ name: "AppTabs" }).exists()).toBe(true);
    });

    it("passes 3 tabs to AppTabs with labels Breadcrumbs, Tags and Traces", () => {
      // Arrange
      const appTabs = wrapper.findComponent({ name: "AppTabs" });
      const tabs = appTabs.props("tabs");

      // Assert
      expect(tabs).toHaveLength(3);
      expect(tabs[0].label).toBe("Breadcrumbs");
      expect(tabs[0].value).toBe("breadcrumbs");
      expect(tabs[1].label).toBe("Tags");
      expect(tabs[1].value).toBe("tags");
      expect(tabs[2].label).toBe("Traces");
      expect(tabs[2].value).toBe("traces");
    });

    it("shows breadcrumbs content by default when component mounts", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="search-input"]').exists()).toBe(true);
    });

    it("switches to tags tab content when AppTabs emits update:active-tab with tags", async () => {
      // Arrange
      const appTabs = wrapper.findComponent({ name: "AppTabs" });

      // Act
      await appTabs.vm.$emit("update:active-tab", "tags");
      await wrapper.vm.$nextTick();

      // Assert
      expect(wrapper.find('[data-test="event-metadata"]').exists()).toBe(true);
    });

    it("switches back to breadcrumbs content when AppTabs emits update:active-tab with breadcrumbs", async () => {
      // Arrange
      const appTabs = wrapper.findComponent({ name: "AppTabs" });
      await appTabs.vm.$emit("update:active-tab", "tags");
      await wrapper.vm.$nextTick();

      // Act
      await appTabs.vm.$emit("update:active-tab", "breadcrumbs");
      await wrapper.vm.$nextTick();

      // Assert
      expect(wrapper.find('[data-test="search-input"]').exists()).toBe(true);
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

    it("displays event-metadata section when tags tab is active", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="event-metadata"]').exists()).toBe(true);
    });

    it("displays user email text in metadata when sessionDetails has user_email", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="event-metadata"]').text()).toContain("test@example.com");
    });

    it("renders mail icon in metadata when tags tab is active", () => {
      // Arrange
      const metadata = wrapper.find('[data-test="event-metadata"]');

      // Assert
      expect(metadata.find('[data-test="OIcon"].mail').exists()).toBe(true);
    });

    it("displays date text in metadata when sessionDetails has date", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="event-metadata"]').text()).toContain("2024-01-01 10:00:00");
    });

    it("renders schedule icon in metadata when tags tab is active", () => {
      // Arrange
      const metadata = wrapper.find('[data-test="event-metadata"]');

      // Assert
      expect(metadata.find('[data-test="OIcon"].schedule').exists()).toBe(true);
    });

    it("displays browser and OS text in metadata", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="event-metadata"]').text()).toContain("Chrome 120, Windows 10");
    });

    it("renders settings icon in metadata when tags tab is active", () => {
      // Arrange
      const metadata = wrapper.find('[data-test="event-metadata"]');

      // Assert
      expect(metadata.find('[data-test="OIcon"].settings').exists()).toBe(true);
    });

    it("displays IP address text in metadata when sessionDetails has ip", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="event-metadata"]').text()).toContain("192.168.1.1");
    });

    it("renders language icon in metadata when tags tab is active", () => {
      // Arrange
      const metadata = wrapper.find('[data-test="event-metadata"]');

      // Assert
      expect(metadata.find('[data-test="OIcon"].language').exists()).toBe(true);
    });

    it("displays city and country text in metadata when sessionDetails has location", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="event-metadata"]').text()).toContain("New York, USA");
    });

    it("displays Unknown User when sessionDetails has null user_email", async () => {
      // Arrange & Act
      await wrapper.setProps({
        sessionDetails: { ...mockSessionDetails, user_email: null },
      });
      await wrapper.vm.$nextTick();

      // Assert
      expect(wrapper.find('[data-test="event-metadata"]').text()).toContain("Unknown User");
    });
  });

  // ==========================================================================
  // BREADCRUMBS TAB CONTENT
  // ==========================================================================

  describe("Breadcrumbs Tab Content", () => {
    it("renders search input when breadcrumbs tab is active by default", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="search-input"]').exists()).toBe(true);
    });

    it("renders event type selector when breadcrumbs tab is active", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="player-events-filter-select"]').exists()).toBe(true);
    });

    it("renders separator when breadcrumbs tab is active", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="separator"]').exists()).toBe(true);
    });

    it("renders event rows when breadcrumbs tab is active with 3 events", () => {
      // Arrange & Assert
      expect(wrapper.findAll('[data-test^="player-event-row"]').length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // EVENTS DISPLAY
  // ==========================================================================

  describe("Events Display", () => {
    it("displays 3 event rows when 3 events are provided", () => {
      // Arrange & Assert
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(3);
    });

    it("displays event display time text in the error event row", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="player-event-row-error"]').text()).toContain("10:30");
    });

    it("displays event type text in the error event row", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="player-event-row-error"]').text()).toContain("error");
    });

    it("displays event name text in the error event row", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="player-event-row-error"]').text()).toContain(
        "TypeError: Cannot read property 'foo'",
      );
    });

    it("renders event type badge for the error event", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="event-type-badge"]').exists()).toBe(true);
    });

    it("renders action event row for the action event", () => {
      // Arrange & Assert
      expect(wrapper.find('[data-test="player-event-row-action"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="player-event-row-action"]').text()).toContain("action");
    });

    it("provides title attribute equal to event name on event name element", () => {
      // Arrange
      const firstEventName = wrapper.find('[data-test="event-name"]');

      // Assert
      expect(firstEventName.attributes("title")).toBe(
        "TypeError: Cannot read property 'foo'",
      );
    });

    it("provides title attributes for all visible event name elements", () => {
      // Arrange
      const eventNames = wrapper.findAll('[data-test="event-name"]');

      // Assert
      eventNames.forEach((name: any, index: number) => {
        expect(name.attributes("title")).toBe(mockEvents[index].name);
      });
    });
  });

  // ==========================================================================
  // EVENT FILTERING
  // ==========================================================================

  describe("Event Filtering", () => {
    it("has all 4 event types selected by default", () => {
      // Arrange & Assert
      expect(wrapper.vm.selectedEventTypes).toEqual([
        "error",
        "action",
        "view",
        "frustration",
      ]);
    });

    it("has correct event type options list", () => {
      // Arrange & Assert
      expect(wrapper.vm.eventOptions).toEqual([
        { label: "Error", value: "error" },
        { label: "Action", value: "action" },
        { label: "View", value: "view" },
        { label: "Frustration", value: "frustration" },
      ]);
    });

    it("shows only matching event when search term filters by name", async () => {
      // Arrange
      wrapper.vm.searchEvent = "Button";

      // Act
      wrapper.vm.searchEvents("Button");
      await wrapper.vm.$nextTick();

      // Assert
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(1);
      expect(wrapper.find('[data-test^="player-event-row"]').text()).toContain("Button click on submit");
    });

    it("shows only error event when selectedEventTypes is set to error only", async () => {
      // Arrange
      wrapper.vm.selectedEventTypes = ["error"];

      // Act
      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      // Assert
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(1);
      expect(wrapper.find('[data-test^="player-event-row"]').text()).toContain("TypeError");
    });

    it("performs case-insensitive search when search term is uppercase", async () => {
      // Arrange & Act
      wrapper.vm.searchEvents("BUTTON");
      await wrapper.vm.$nextTick();

      // Assert
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(1);
      expect(wrapper.find('[data-test^="player-event-row"]').text()).toContain("Button click on submit");
    });

    it("shows all 3 events when search value is null", async () => {
      // Arrange & Act
      wrapper.vm.searchEvents(null);
      await wrapper.vm.$nextTick();

      // Assert
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(3);
    });

    it("shows all 3 events when search value is empty string", async () => {
      // Arrange & Act
      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      // Assert
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(3);
    });

    it("shows only 1 event when both type and text filters are combined", async () => {
      // Arrange
      wrapper.vm.selectedEventTypes = ["action", "view"];

      // Act
      wrapper.vm.searchEvents("click");
      await wrapper.vm.$nextTick();

      // Assert
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(1);
      expect(wrapper.find('[data-test^="player-event-row"]').text()).toContain("click on submit");
    });
  });

  // ==========================================================================
  // EVENT INTERACTION
  // ==========================================================================

  describe("Event Interaction", () => {
    it("emits event-emitted with event-click and first event data when first row is clicked", async () => {
      // Arrange
      const firstEvent = wrapper.find('[data-test^="player-event-row"]');

      // Act
      await firstEvent.trigger("click");

      // Assert
      const emitted = wrapper.emitted("event-emitted");
      expect(emitted).toBeDefined();
      expect(emitted).toHaveLength(1);
      expect(emitted![0]).toEqual(["event-click", mockEvents[0]]);
    });

    it("emits event-emitted with correct second event data when second row is clicked", async () => {
      // Arrange
      const eventRows = wrapper.findAll('[data-test^="player-event-row"]');

      // Act
      await eventRows[1].trigger("click");

      // Assert
      expect(wrapper.emitted("event-emitted")![0]).toEqual(["event-click", mockEvents[1]]);
    });

    it("emits event-emitted twice when two different event rows are clicked", async () => {
      // Arrange
      const eventRows = wrapper.findAll('[data-test^="player-event-row"]');

      // Act
      await eventRows[0].trigger("click");
      await eventRows[1].trigger("click");

      // Assert
      expect(wrapper.emitted("event-emitted")).toHaveLength(2);
    });
  });

  // ==========================================================================
  // PROPS REACTIVITY
  // ==========================================================================

  describe("Props Reactivity", () => {
    it("shows only 1 event row when events prop is replaced with 1 event", async () => {
      // Arrange
      const newEvents = [
        {
          id: "new1",
          type: "error",
          name: "New error",
          displayTime: "11:00",
          relativeTime: 6000,
        },
      ];

      // Act
      await wrapper.setProps({ events: newEvents });
      await wrapper.vm.$nextTick();

      // Assert
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(1);
      expect(wrapper.find('[data-test^="player-event-row"]').text()).toContain("New error");
    });

    it("shows 4 event rows when events prop grows by one additional event", async () => {
      // Arrange
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

      // Act
      await wrapper.setProps({ events: newEvents });
      await wrapper.vm.$nextTick();

      // Assert
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(4);
    });

    it("shows no event rows when events prop is set to empty array", async () => {
      // Arrange & Act
      await wrapper.setProps({ events: [] });
      await wrapper.vm.$nextTick();

      // Assert
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(0);
    });
  });

  // ==========================================================================
  // ACCESSIBILITY
  // ==========================================================================

  describe("Accessibility", () => {
    it("preserves full long event name text in title attribute", async () => {
      // Arrange
      const longEvent = {
        id: "long",
        type: "error",
        name: "This is a very long event name that exceeds 100 characters and should be truncated with ellipsis to prevent overflow and maintain readable layout for the user interface",
        displayTime: "11:00",
        relativeTime: 7000,
      };

      // Act
      await wrapper.setProps({ events: [longEvent] });

      // Assert
      expect(wrapper.find('[data-test="event-name"]').attributes("title")).toBe(longEvent.name);
    });
  });

  // ==========================================================================
  // COMPONENT LIFECYCLE
  // ==========================================================================

  describe("Component Lifecycle", () => {
    it("maintains type filter results after prop update with active text search", async () => {
      // Arrange
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

      // Act
      await wrapper.setProps({ events: newEvents });
      wrapper.vm.searchEvents("Type");
      await wrapper.vm.$nextTick();

      // Assert
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

    it("renders without errors when events have frustration_types", () => {
      // Arrange & Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("displays all 4 event rows when all 4 mixed frustration events are provided", () => {
      // Arrange & Assert
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(4);
    });

    it("displays all event names including non-frustrated events", () => {
      // Arrange
      const text = wrapper.text();

      // Assert
      expect(text).toContain("click on Submit Button");
      expect(text).toContain("click on Nav Menu");
      expect(text).toContain("click on Cancel");
      expect(text).toContain("click on Checkout");
    });

    it("has frustration option in event filter", () => {
      // Arrange & Assert
      expect(wrapper.vm.eventOptions).toContainEqual({
        label: "Frustration",
        value: "frustration",
      });
    });

    it("includes frustration in default selected filters", () => {
      // Arrange & Assert
      expect(wrapper.vm.selectedEventTypes).toContain("frustration");
    });

    it("shows only 3 frustrated event rows when frustration filter is active", async () => {
      // Arrange
      wrapper.vm.selectedEventTypes = ["frustration"];

      // Act
      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      // Assert
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(3);
    });

    it("does not render the non-frustrated action when only frustration filter is active", async () => {
      // Arrange
      wrapper.vm.selectedEventTypes = ["frustration"];

      // Act
      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      // Assert
      const rows = wrapper.findAll('[data-test^="player-event-row"]');
      const renderedText = rows.map((r: any) => r.text()).join(" ");
      expect(renderedText).not.toContain("click on Cancel");
    });

    it("shows all 4 action rows when both action and frustration filters are selected", async () => {
      // Arrange
      wrapper.vm.selectedEventTypes = ["action", "frustration"];

      // Act
      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      // Assert
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(4);
    });

    it("shows 1 event when frustration filter and Submit search are combined", async () => {
      // Arrange
      wrapper.vm.selectedEventTypes = ["frustration"];

      // Act
      wrapper.vm.searchEvents("Submit");
      await wrapper.vm.$nextTick();

      // Assert
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(1);
      expect(wrapper.find('[data-test^="player-event-row"]').text()).toContain("Submit");
    });

    it("combines error and frustration filters to show both types", async () => {
      // Arrange
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

      // Act
      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      // Assert
      const rows = wrapper.findAll('[data-test^="player-event-row"]');
      const renderedText = rows.map((r: any) => r.text()).join(" ");
      expect(renderedText).toContain("TypeError");
      expect(renderedText).toContain("Submit");
    });

    it("shows 1 frustrated event when events prop is replaced with 1 frustrated event", async () => {
      // Arrange & Act
      await wrapper.setProps({ events: [mockEventsWithFrustrations[0]] });

      // Assert
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(1);
      expect(wrapper.find('[data-test^="player-event-row"]').text()).toContain("click on Submit Button");
    });

    it("handles events with multiple frustration types without errors", () => {
      // Arrange
      const multipleTypes = wrapper.vm.events.find((e: any) => e.id === "frustrated3");

      // Assert
      expect(multipleTypes.frustration_types).toHaveLength(2);
      expect(multipleTypes.frustration_types).toContain("rage_click");
      expect(multipleTypes.frustration_types).toContain("error_click");
    });

    it("treats events with empty frustration_types array as non-frustrated", async () => {
      // Arrange
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

      // Act
      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      // Assert
      expect(wrapper.findAll('[data-test^="player-event-row"]')).toHaveLength(0);
    });
  });
});
