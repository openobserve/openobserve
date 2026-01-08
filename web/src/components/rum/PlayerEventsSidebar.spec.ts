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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import PlayerEventsSidebar from "@/components/rum/PlayerEventsSidebar.vue";
import i18n from "@/locales";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Install Quasar plugins
installQuasar({
  plugins: [quasar.Dialog, quasar.Notify, quasar.Loading],
});

// Mock AppTabs component
vi.mock("@/components/common/AppTabs.vue", () => ({
  default: {
    name: "AppTabs",
    template: `
      <div data-test="app-tabs">
        <div v-for="tab in tabs" :key="tab.value" 
             @click="$emit('update:active-tab', tab.value)"
             :class="{ active: activeTab === tab.value }"
             data-test="tab-button">
          {{ tab.label }}
        </div>
      </div>
    `,
    props: ["tabs", "activeTab"],
    emits: ["update:active-tab"],
  },
}));

describe("PlayerEventsSidebar Component", () => {
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

  beforeEach(async () => {
    vi.clearAllMocks();

    wrapper = mount(PlayerEventsSidebar, {
      attachTo: "#app",
      props: {
        events: mockEvents,
        sessionDetails: mockSessionDetails,
      },
      global: {
        plugins: [i18n],
        stubs: {
          "q-input": {
            template: `
              <div data-test="q-input">
                <input v-model="modelValue" @input="$emit('update:model-value', $event.target.value)" />
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
          "q-select": {
            template: `
              <div data-test="q-select">
                <select v-model="modelValue" @change="$emit('update:model-value', Array.from($event.target.selectedOptions, option => option.value))">
                  <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </div>
            `,
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
            ],
            emits: ["update:model-value"],
          },
          "q-separator": {
            template: '<hr data-test="separator" />',
          },
          "q-icon": {
            template: '<i data-test="q-icon" :class="name"></i>',
            props: ["name", "size"],
          },
        },
      },
    });

    await flushPromises();
    await wrapper.vm.$nextTick();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should render events container", () => {
      expect(wrapper.find(".events-container").exists()).toBe(true);
    });

    it("should have relative positioning class", () => {
      const container = wrapper.find(".events-container");
      expect(container.classes()).toContain("relative-position");
    });
  });

  describe("Tabs Integration", () => {
    it("should render AppTabs component", () => {
      const appTabs = wrapper.findComponent({ name: "AppTabs" });
      expect(appTabs.exists()).toBe(true);
    });

    it("should pass correct tabs configuration", () => {
      const appTabs = wrapper.findComponent({ name: "AppTabs" });
      const tabs = appTabs.props("tabs");

      expect(tabs).toHaveLength(2);
      expect(tabs[0].label).toBe("Breadcrumbs");
      expect(tabs[0].value).toBe("breadcrumbs");
      expect(tabs[1].label).toBe("Tags");
      expect(tabs[1].value).toBe("tags");
    });

    it("should have breadcrumbs as default active tab", () => {
      expect(wrapper.vm.activeTab).toBe("breadcrumbs");
    });

    it("should handle tab switching", async () => {
      const appTabs = wrapper.findComponent({ name: "AppTabs" });
      await appTabs.vm.$emit("update:active-tab", "tags");

      expect(wrapper.vm.activeTab).toBe("tags");
    });
  });

  describe("Tags Tab Content", () => {
    beforeEach(async () => {
      wrapper.vm.activeTab = "tags";
      await wrapper.vm.$nextTick();
    });

    it("should display tags content when tags tab is active", () => {
      const metadata = wrapper.find(".event-metadata");
      expect(metadata.exists()).toBe(true);
    });

    it("should display user email with mail icon", () => {
      const emailSection = wrapper.find(".event-metadata");
      expect(emailSection.text()).toContain("test@example.com");
      const mailIcon = emailSection.find('[data-test="q-icon"].mail');
      expect(mailIcon.exists()).toBe(true);
    });

    it("should display date with schedule icon", () => {
      const dateSection = wrapper.find(".event-metadata");
      expect(dateSection.text()).toContain("2024-01-01 10:00:00");
      const scheduleIcon = dateSection.find('[data-test="q-icon"].schedule');
      expect(scheduleIcon.exists()).toBe(true);
    });

    it("should display browser and OS with settings icon", () => {
      const browserSection = wrapper.find(".event-metadata");
      expect(browserSection.text()).toContain("Chrome 120, Windows 10");
      const settingsIcon = browserSection.find('[data-test="q-icon"].settings');
      expect(settingsIcon.exists()).toBe(true);
    });

    it("should display IP with language icon", () => {
      const ipSection = wrapper.find(".event-metadata");
      expect(ipSection.text()).toContain("192.168.1.1");
      const languageIcon = ipSection.find('[data-test="q-icon"].language');
      expect(languageIcon.exists()).toBe(true);
    });

    it("should display location with location icon", () => {
      const locationSection = wrapper.find(".event-metadata");
      expect(locationSection.text()).toContain("New York, USA");
      const locationIcon = locationSection.find(
        '[data-test="q-icon"].location_on',
      );
      expect(locationIcon.exists()).toBe(true);
    });

    it("should handle unknown user email", async () => {
      await wrapper.setProps({
        sessionDetails: { ...mockSessionDetails, user_email: null },
      });
      wrapper.vm.activeTab = "tags";
      await wrapper.vm.$nextTick();

      const emailSection = wrapper.find(".event-metadata");
      expect(emailSection.text()).toContain("Unknown User");
    });
  });

  describe("Breadcrumbs Tab Content", () => {
    beforeEach(async () => {
      wrapper.vm.activeTab = "breadcrumbs";
      await wrapper.vm.$nextTick();
    });

    it("should display breadcrumbs content when breadcrumbs tab is active", () => {
      const searchSection = wrapper.find(".flex.items-center.justify-between");
      expect(searchSection.exists()).toBe(true);
    });

    it("should render search input", () => {
      const searchInput = wrapper.find('[data-test="q-input"]');
      expect(searchInput.exists()).toBe(true);
    });

    it("should render event type selector", () => {
      const eventSelector = wrapper.find('[data-test="player-events-filter-select"]');
      expect(eventSelector.exists()).toBe(true);
    });

    it("should render separator", () => {
      const separator = wrapper.find('[data-test="separator"]');
      expect(separator.exists()).toBe(true);
    });

    it("should render events list", () => {
      const eventsList = wrapper.find(".events-list");
      expect(eventsList.exists()).toBe(true);
    });
  });

  describe("Events Display", () => {
    beforeEach(async () => {
      wrapper.vm.activeTab = "breadcrumbs";
      await wrapper.vm.$nextTick();
    });

    it("should display all events initially", () => {
      const eventContainers = wrapper.findAll(".event-container");
      expect(eventContainers).toHaveLength(3);
    });

    it("should display event time", () => {
      const firstEvent = wrapper.find(".event-container");
      expect(firstEvent.text()).toContain("10:30");
    });

    it("should display event type", () => {
      const firstEvent = wrapper.find(".event-container");
      expect(firstEvent.text()).toContain("error");
    });

    it("should display event name", () => {
      const firstEvent = wrapper.find(".event-container");
      expect(firstEvent.text()).toContain(
        "TypeError: Cannot read property 'foo'",
      );
    });

    it("should apply error styling to error events", () => {
      const firstEvent = wrapper.find(".event-container .event-type");
      expect(firstEvent.classes()).toContain("bg-red-3");
    });

    it("should not apply error styling to non-error events", () => {
      const eventContainers = wrapper.findAll(".event-container");
      const secondEvent = eventContainers[1];
      const eventType = secondEvent.find(".event-type");
      expect(eventType.classes()).not.toContain("bg-red-3");
    });

    it("should have correct event title attribute", () => {
      const firstEventName = wrapper.find(
        ".event-container .inline:last-child",
      );
      expect(firstEventName.attributes("title")).toBe(
        "TypeError: Cannot read property 'foo'",
      );
    });
  });

  describe("Event Filtering", () => {
    beforeEach(async () => {
      wrapper.vm.activeTab = "breadcrumbs";
      await wrapper.vm.$nextTick();
    });

    it("should have default selected event types", () => {
      expect(wrapper.vm.selectedEventTypes).toEqual([
        "error",
        "action",
        "view",
        "frustration",
      ]);
    });

    it("should have correct event options", () => {
      expect(wrapper.vm.eventOptions).toEqual([
        { label: "Error", value: "error" },
        { label: "Action", value: "action" },
        { label: "View", value: "view" },
        { label: "Frustration", value: "frustration" },
      ]);
    });

    it("should filter events by search term", async () => {
      wrapper.vm.searchEvent = "Button";
      wrapper.vm.searchEvents("Button");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredEvents).toHaveLength(1);
      expect(wrapper.vm.filteredEvents[0].name).toBe("Button click on submit");
    });

    it("should filter events by type", async () => {
      wrapper.vm.selectedEventTypes = ["error"];
      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredEvents).toHaveLength(1);
      expect(wrapper.vm.filteredEvents[0].type).toBe("error");
    });

    it("should be case insensitive for search", async () => {
      wrapper.vm.searchEvents("BUTTON");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredEvents).toHaveLength(1);
      expect(wrapper.vm.filteredEvents[0].name).toBe("Button click on submit");
    });

    it("should handle null search value", async () => {
      wrapper.vm.searchEvents(null);
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredEvents).toHaveLength(3);
    });

    it("should handle empty search value", async () => {
      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredEvents).toHaveLength(3);
    });

    it("should combine type and search filters", async () => {
      wrapper.vm.selectedEventTypes = ["action", "view"];
      wrapper.vm.searchEvents("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredEvents).toHaveLength(1);
      expect(wrapper.vm.filteredEvents[0].type).toBe("action");
    });
  });

  describe("Event Interaction", () => {
    beforeEach(async () => {
      wrapper.vm.activeTab = "breadcrumbs";
      await wrapper.vm.$nextTick();
    });

    it("should emit event when event is clicked", async () => {
      const firstEvent = wrapper.find(".event-container");
      await firstEvent.trigger("click");

      const emittedEvents = wrapper.emitted("event-emitted");
      expect(emittedEvents).toBeDefined();
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents![0]).toEqual(["event-click", mockEvents[0]]);
    });

    it("should emit correct event data", async () => {
      const eventContainers = wrapper.findAll(".event-container");
      await eventContainers[1].trigger("click");

      const emittedEvents = wrapper.emitted("event-emitted");
      expect(emittedEvents![0]).toEqual(["event-click", mockEvents[1]]);
    });

    it("should handle multiple event clicks", async () => {
      const eventContainers = wrapper.findAll(".event-container");
      await eventContainers[0].trigger("click");
      await eventContainers[1].trigger("click");

      const emittedEvents = wrapper.emitted("event-emitted");
      expect(emittedEvents).toHaveLength(2);
    });
  });

  describe("Props Integration", () => {
    it("should watch events prop changes", async () => {
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

      expect(wrapper.vm.filteredEvents).toEqual(newEvents);
    });

    it("should update filtered events when events prop changes", async () => {
      const initialLength = wrapper.vm.filteredEvents.length;

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

      expect(wrapper.vm.filteredEvents.length).toBe(initialLength + 1);
    });

    it("should handle empty events array", async () => {
      await wrapper.setProps({ events: [] });
      expect(wrapper.vm.filteredEvents).toEqual([]);
    });
  });

  describe("Component Structure", () => {
    it("should have correct container classes", () => {
      const container = wrapper.find(".events-container");
      expect(container.classes()).toContain("relative-position");
    });

    it("should have correct layout structure for breadcrumbs", async () => {
      wrapper.vm.activeTab = "breadcrumbs";
      await wrapper.vm.$nextTick();

      const controlsSection = wrapper.find(
        ".flex.items-center.justify-between",
      );
      const eventsList = wrapper.find(".events-list");

      expect(controlsSection.exists()).toBe(true);
      expect(eventsList.exists()).toBe(true);
    });

    it("should have correct search input width", () => {
      const searchContainer = wrapper.find('.tw\\:w-\\[60\\%\\]');
      expect(searchContainer.exists()).toBe(true);
    });

    it("should have correct selector width", () => {
      const selectorContainer = wrapper.find('.tw\\:w-\\[40\\%\\]');
      expect(selectorContainer.exists()).toBe(true);
    });
  });

  describe("CSS Classes and Styling", () => {
    beforeEach(async () => {
      wrapper.vm.activeTab = "breadcrumbs";
      await wrapper.vm.$nextTick();
    });

    it("should apply correct classes to event containers", () => {
      const eventContainer = wrapper.find(".event-container");
      expect(eventContainer.classes()).toContain("cursor-pointer");
      expect(eventContainer.classes()).toContain("rounded-borders");
      expect(eventContainer.classes()).toContain("q-mt-xs");
      expect(eventContainer.classes()).toContain("q-px-sm");
      expect(eventContainer.classes()).toContain("q-py-sm");
    });

    it("should apply ellipsis class to event content", () => {
      const eventContent = wrapper.find(".event-container .ellipsis");
      expect(eventContent.exists()).toBe(true);
    });

    it("should apply inline class to event elements", () => {
      const inlineElements = wrapper.findAll(".event-container .inline");
      expect(inlineElements.length).toBeGreaterThan(0);
    });
  });

  describe("Accessibility", () => {
    beforeEach(async () => {
      wrapper.vm.activeTab = "breadcrumbs";
      await wrapper.vm.$nextTick();
    });

    it("should have cursor pointer on clickable events", () => {
      const eventContainers = wrapper.findAll(".event-container");
      eventContainers.forEach((container) => {
        expect(container.classes()).toContain("cursor-pointer");
      });
    });

    it("should provide title attributes for event names", () => {
      const eventNames = wrapper.findAll(".event-container .inline:last-child");
      eventNames.forEach((name, index) => {
        expect(name.attributes("title")).toBe(mockEvents[index].name);
      });
    });

    it("should handle long event names with title truncation", async () => {
      const longEvent = {
        id: "long",
        type: "error",
        name: "This is a very long event name that exceeds 100 characters and should be truncated with ellipsis to prevent overflow and maintain readable layout for the user interface",
        displayTime: "11:00",
        relativeTime: 7000,
      };

      await wrapper.setProps({ events: [longEvent] });

      const eventName = wrapper.find(".event-container .inline:last-child");
      expect(eventName.attributes("title")).toBe(longEvent.name);
    });
  });

  describe("Component Lifecycle", () => {
    it("should maintain filtering state through prop updates", async () => {
      wrapper.vm.selectedEventTypes = ["error"];
      wrapper.vm.searchEvent = "Type";

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

      expect(wrapper.vm.filteredEvents).toHaveLength(1);
      expect(wrapper.vm.filteredEvents[0].type).toBe("error");
    });
  });

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

    it("should calculate correct frustration event count", () => {
      const frustratedEvents = wrapper.vm.events.filter(
        (e: any) => e.frustration_types && e.frustration_types.length > 0
      );
      expect(frustratedEvents.length).toBe(3);
    });

    it("should return 0 frustration count when no frustrated events", async () => {
      await wrapper.setProps({ events: [mockEventsWithFrustrations[2]] });
      const frustratedEvents = wrapper.vm.events.filter(
        (e: any) => e.frustration_types && e.frustration_types.length > 0
      );
      expect(frustratedEvents.length).toBe(0);
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

    it("should filter to show only frustrated events", async () => {
      wrapper.vm.selectedEventTypes = ["frustration"];
      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredEvents).toHaveLength(3);
      wrapper.vm.filteredEvents.forEach((event: any) => {
        expect(event.frustration_types).toBeTruthy();
        expect(event.frustration_types.length).toBeGreaterThan(0);
      });
    });

    it("should combine frustration filter with error filter", async () => {
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

      const filteredTypes = wrapper.vm.filteredEvents.map((e: any) => e.type);
      const hasFrustrations = wrapper.vm.filteredEvents.some(
        (e: any) => e.frustration_types && e.frustration_types.length > 0
      );

      expect(filteredTypes).toContain("error");
      expect(hasFrustrations).toBe(true);
    });

    it("should not show non-frustrated actions when only frustration filter is selected", async () => {
      wrapper.vm.selectedEventTypes = ["frustration"];
      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      const nonFrustratedEvent = wrapper.vm.filteredEvents.find(
        (e: any) => e.id === "normal1"
      );
      expect(nonFrustratedEvent).toBeUndefined();
    });

    it("should show all actions when both action and frustration filters are selected", async () => {
      wrapper.vm.selectedEventTypes = ["action", "frustration"];
      wrapper.vm.searchEvents("");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredEvents).toHaveLength(4);
    });

    it("should apply search filter on frustrated events", async () => {
      wrapper.vm.selectedEventTypes = ["frustration"];
      wrapper.vm.searchEvents("Submit");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredEvents).toHaveLength(1);
      expect(wrapper.vm.filteredEvents[0].name).toContain("Submit");
    });

    it("should update frustration count when events change", async () => {
      let frustratedEvents = wrapper.vm.events.filter(
        (e: any) => e.frustration_types && e.frustration_types.length > 0
      );
      expect(frustratedEvents.length).toBe(3);

      await wrapper.setProps({
        events: [mockEventsWithFrustrations[0]], // Only 1 frustrated event
      });

      frustratedEvents = wrapper.vm.events.filter(
        (e: any) => e.frustration_types && e.frustration_types.length > 0
      );
      expect(frustratedEvents.length).toBe(1);
    });

    it("should handle events with multiple frustration types", () => {
      const multipleTypes = wrapper.vm.events.find((e: any) => e.id === "frustrated3");
      expect(multipleTypes.frustration_types).toHaveLength(2);
      expect(multipleTypes.frustration_types).toContain("rage_click");
      expect(multipleTypes.frustration_types).toContain("error_click");
    });

    it("should handle empty frustration_types array", async () => {
      const eventWithEmptyArray = {
        id: "empty",
        type: "action",
        name: "click",
        displayTime: "00:00",
        relativeTime: 0,
        frustration_types: [],
      };

      await wrapper.setProps({ events: [eventWithEmptyArray] });
      const frustratedEvents = wrapper.vm.events.filter(
        (e: any) => e.frustration_types && e.frustration_types.length > 0
      );
      expect(frustratedEvents.length).toBe(0);
    });
  });
});
