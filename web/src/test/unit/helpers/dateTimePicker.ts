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

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

import DateTime from "@/components/DateTime.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

export type Picker = VueWrapper<InstanceType<typeof DateTime>>;
export type Payload = Record<string, unknown>;

/** Loads the lazy bar and paste parser once, so a later flush sees them mounted. */
export async function warmRangeInput(): Promise<void> {
  await import("@/components/DateTimeRangeInput.vue");
  await import("@/composables/useTimeRangeInput");
}

export function mountPicker(props: Record<string, unknown> = {}): Picker {
  return mount(DateTime, {
    props: { calendarPresets: true, ...props },
    attachTo: document.body,
    global: { plugins: [i18n, store] },
  });
}

export async function openMenu(wrapper: Picker): Promise<void> {
  wrapper.vm.onMenuOpenChange(true);
  wrapper.vm.menuOpen = true;
  await flushPromises();
}

// jsdom matches attribute values case-insensitively, which would confuse 1-m (minutes) with 1-M (months).
export const el = <T extends HTMLElement = HTMLElement>(dataTest: string): T | null =>
  (Array.from(document.querySelectorAll<T>("[data-test]")).find(
    (node) => node.getAttribute("data-test") === dataTest,
  ) ?? null) as T | null;

export const barInput = () => el<HTMLInputElement>("date-time-range-input-field");

export const barState = () => el("date-time-range-status")?.getAttribute("data-state") ?? null;

export async function typeInBar(text: string): Promise<void> {
  const input = barInput();
  if (!input) throw new Error("the range bar is not mounted");
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await flushPromises();
}

export async function press(
  target: Element | null,
  key: string,
  init: KeyboardEventInit = {},
): Promise<KeyboardEvent> {
  if (!target) throw new Error(`no target for ${key}`);
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  await flushPromises();
  return event;
}

export const changes = (wrapper: Picker): Payload[] =>
  ((wrapper.emitted("on:date-change") ?? []) as unknown[][]).map((args) => args[0] as Payload);

export const lastChange = (wrapper: Picker): Payload => changes(wrapper).at(-1) as Payload;
