// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import i18n from '@/locales';
import CheckTypePicker from '@/components/synthetics/CheckTypePicker.vue';
import type { SyntheticCheckType } from '@/types/synthetics';

const CHECK_TYPES: SyntheticCheckType[] = ['browser', 'http', 'tcp', 'tls', 'ssh'];

function createWrapper(props: {
  variant: 'modal' | 'inline';
  layout: 'row' | 'grid';
  disabledTypes?: SyntheticCheckType[];
  comingSoonTypes?: SyntheticCheckType[];
}) {
  return mount(CheckTypePicker, {
    props,
    global: {
      plugins: [i18n],
      stubs: {
        EmptyStateActionCard: {
          template: `
            <div
              class="empty-state-action-card-stub"
              :class="[{ 'pointer-events-none': $attrs.class?.includes('pointer-events-none') }]"
              :data-icon="icon"
              :data-label="label"
              :data-sublabel="sublabel"
              :data-hide-chevron="hideChevron !== undefined ? String(hideChevron) : undefined"
            >
              {{ label }}
            </div>`,
          props: ['icon', 'label', 'sublabel', 'hideChevron'],
          inheritAttrs: true,
        },
        OTag: {
          template: `
            <div class="o-tag-stub" :data-test="$attrs['data-test']" v-if="$attrs['data-test']">
              <slot></slot>
            </div>`,
        },
      },
    },
  });
}

describe('CheckTypePicker.vue', () => {
  describe('Rendering', () => {
    it('renders 5 cards for modal variant with grid layout', () => {
      const wrapper = createWrapper({ variant: 'modal', layout: 'grid' });
      const cards = wrapper.findAll('.empty-state-action-card-stub');
      expect(cards).toHaveLength(5);
    });

    it('renders 5 cards for modal variant with row layout', () => {
      const wrapper = createWrapper({ variant: 'modal', layout: 'row' });
      const cards = wrapper.findAll('.empty-state-action-card-stub');
      expect(cards).toHaveLength(5);
    });

    it('renders 5 cards for inline variant with grid layout', () => {
      const wrapper = createWrapper({ variant: 'inline', layout: 'grid' });
      const cards = wrapper.findAll('.empty-state-action-card-stub');
      expect(cards).toHaveLength(5);
    });

    it('renders 5 cards for inline variant with row layout', () => {
      const wrapper = createWrapper({ variant: 'inline', layout: 'row' });
      const cards = wrapper.findAll('.empty-state-action-card-stub');
      expect(cards).toHaveLength(5);
    });

    it('renders all five check types in order', () => {
      const wrapper = createWrapper({ variant: 'modal', layout: 'grid' });
      const cards = wrapper.findAll('.empty-state-action-card-stub');
      const labels = cards.map((c) => c.attributes('data-label'));
      expect(labels).toEqual(['Browser Test', 'HTTP / API', 'TCP Port', 'SSL / TLS Certificate', 'SSH']);
    });
  });

  describe('Data-test attributes', () => {
    it('sets data-test on the wrapper with the layout value', () => {
      const gridWrapper = createWrapper({ variant: 'modal', layout: 'grid' });
      expect(gridWrapper.find('[data-test="check-type-picker-grid"]').exists()).toBe(true);

      const rowWrapper = createWrapper({ variant: 'modal', layout: 'row' });
      expect(rowWrapper.find('[data-test="check-type-picker-row"]').exists()).toBe(true);
    });

    it('sets data-test on each card with layout and check type', () => {
      const wrapper = createWrapper({ variant: 'modal', layout: 'grid' });
      for (const type of CHECK_TYPES) {
        const card = wrapper.find(`[data-test="check-type-picker-grid-card-${type}"]`);
        expect(card.exists()).toBe(true);
      }
    });

    it('adds data-test to OTag coming-soon badge', () => {
      const wrapper = createWrapper({
        variant: 'modal',
        layout: 'grid',
        comingSoonTypes: ['tcp'],
      });
      expect(wrapper.find('[data-test="check-type-picker-coming-soon-badge"]').exists()).toBe(true);
    });
  });

  describe('Variant: hide-chevron prop', () => {
    it('modal variant passes hideChevron=false to all cards', () => {
      const wrapper = createWrapper({ variant: 'modal', layout: 'grid' });
      const cards = wrapper.findAll('.empty-state-action-card-stub');
      for (let i = 0; i < cards.length; i++) {
        expect(cards[i].attributes('data-hide-chevron')).toBe('false');
      }
    });

    it('inline variant passes hideChevron=true to all cards', () => {
      const wrapper = createWrapper({ variant: 'inline', layout: 'grid' });
      const cards = wrapper.findAll('.empty-state-action-card-stub');
      for (let i = 0; i < cards.length; i++) {
        expect(cards[i].attributes('data-hide-chevron')).toBe('true');
      }
    });
  });

  describe('Layout: CSS classes', () => {
    it('grid layout uses flex-wrap justify-center gap-4 wrapper', () => {
      const wrapper = createWrapper({ variant: 'modal', layout: 'grid' });
      const outer = wrapper.find('[data-test="check-type-picker-grid"]');
      expect(outer.classes()).toContain('flex-wrap');
      expect(outer.classes()).toContain('justify-center');
      expect(outer.classes()).toContain('gap-4');
    });

    it('grid layout does NOT use flex-col', () => {
      const wrapper = createWrapper({ variant: 'modal', layout: 'grid' });
      const outer = wrapper.find('[data-test="check-type-picker-grid"]');
      expect(outer.classes()).not.toContain('flex-col');
    });

    it('row layout uses flex-col gap-2 wrapper', () => {
      const wrapper = createWrapper({ variant: 'modal', layout: 'row' });
      const outer = wrapper.find('[data-test="check-type-picker-row"]');
      expect(outer.classes()).toContain('flex-col');
      expect(outer.classes()).toContain('gap-2');
    });

    it('row layout does NOT use flex-wrap', () => {
      const wrapper = createWrapper({ variant: 'modal', layout: 'row' });
      const outer = wrapper.find('[data-test="check-type-picker-row"]');
      expect(outer.classes()).not.toContain('flex-wrap');
    });
  });

  describe('Click handling (emit)', () => {
    it('clicking an enabled card emits select with the correct type', async () => {
      const wrapper = createWrapper({ variant: 'modal', layout: 'grid' });
      const httpCard = wrapper.find('[data-test="check-type-picker-grid-card-http"]');
      await httpCard.trigger('click');
      expect(wrapper.emitted('select')).toBeTruthy();
      expect(wrapper.emitted('select')![0]).toEqual(['http']);
    });

    it('emits for every clickable type', async () => {
      const wrapper = createWrapper({ variant: 'modal', layout: 'grid' });
      for (const type of CHECK_TYPES) {
        const card = wrapper.find(`[data-test="check-type-picker-grid-card-${type}"]`);
        await card.trigger('click');
        const emitted = wrapper.emitted('select')!;
        const last = emitted[emitted.length - 1];
        expect(last).toEqual([type]);
      }
    });
  });

  describe('Disabled types', () => {
    it('disabled card gets opacity-50 and cursor-not-allowed classes', () => {
      const wrapper = createWrapper({
        variant: 'modal',
        layout: 'grid',
        disabledTypes: ['tcp'],
      });
      const tcpCard = wrapper.find('[data-test="check-type-picker-grid-card-tcp"]');
      expect(tcpCard.classes()).toContain('opacity-50');
      expect(tcpCard.classes()).toContain('cursor-not-allowed');
    });

    it('clicking a disabled card does NOT emit select', async () => {
      const wrapper = createWrapper({
        variant: 'modal',
        layout: 'grid',
        disabledTypes: ['http'],
      });
      const httpCard = wrapper.find('[data-test="check-type-picker-grid-card-http"]');
      await httpCard.trigger('click');
      expect(wrapper.emitted('select')).toBeFalsy();
    });

    it('multiple disabled types all get disabled styling', () => {
      const wrapper = createWrapper({
        variant: 'modal',
        layout: 'grid',
        disabledTypes: ['tcp', 'tls', 'ssh'],
      });

      for (const type of ['tcp', 'tls', 'ssh']) {
        const card = wrapper.find(`[data-test="check-type-picker-grid-card-${type}"]`);
        expect(card.classes()).toContain('opacity-50');
        expect(card.classes()).toContain('cursor-not-allowed');
      }

      // Non-disabled cards should NOT have those classes
      for (const type of ['browser', 'http']) {
        const card = wrapper.find(`[data-test="check-type-picker-grid-card-${type}"]`);
        expect(card.classes()).not.toContain('opacity-50');
        expect(card.classes()).not.toContain('cursor-not-allowed');
      }
    });

    it('disabled card has pointer-events-none on its EmptyStateActionCard', () => {
      const wrapper = createWrapper({
        variant: 'modal',
        layout: 'grid',
        disabledTypes: ['ssh'],
      });
      const sshCard = wrapper.find('[data-test="check-type-picker-grid-card-ssh"]');
      const actionCard = sshCard.find('.empty-state-action-card-stub');
      expect(actionCard.classes()).toContain('pointer-events-none');
    });
  });

  describe('Coming-soon types', () => {
    it('coming-soon card gets opacity-70 and cursor-not-allowed classes', () => {
      const wrapper = createWrapper({
        variant: 'modal',
        layout: 'grid',
        comingSoonTypes: ['ssh'],
      });
      const sshCard = wrapper.find('[data-test="check-type-picker-grid-card-ssh"]');
      expect(sshCard.classes()).toContain('opacity-70');
      expect(sshCard.classes()).toContain('cursor-not-allowed');
    });

    it('coming-soon card renders an OTag badge with "Coming Soon" text', () => {
      const wrapper = createWrapper({
        variant: 'modal',
        layout: 'grid',
        comingSoonTypes: ['ssh'],
      });
      const sshCard = wrapper.find('[data-test="check-type-picker-grid-card-ssh"]');
      const badge = sshCard.find('.o-tag-stub');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain('Coming Soon');
    });

    it('non-coming-soon cards do NOT render a badge', () => {
      const wrapper = createWrapper({
        variant: 'modal',
        layout: 'grid',
        comingSoonTypes: ['ssh'],
      });
      const browserCard = wrapper.find('[data-test="check-type-picker-grid-card-browser"]');
      expect(browserCard.find('.o-tag-stub').exists()).toBe(false);
    });

    it('clicking a coming-soon card does NOT emit select', async () => {
      const wrapper = createWrapper({
        variant: 'modal',
        layout: 'grid',
        comingSoonTypes: ['tls'],
      });
      const tlsCard = wrapper.find('[data-test="check-type-picker-grid-card-tls"]');
      await tlsCard.trigger('click');
      expect(wrapper.emitted('select')).toBeFalsy();
    });

    it('coming-soon card has pointer-events-none on its EmptyStateActionCard', () => {
      const wrapper = createWrapper({
        variant: 'modal',
        layout: 'grid',
        comingSoonTypes: ['browser'],
      });
      const browserCard = wrapper.find('[data-test="check-type-picker-grid-card-browser"]');
      const actionCard = browserCard.find('.empty-state-action-card-stub');
      expect(actionCard.classes()).toContain('pointer-events-none');
    });
  });

  describe('Type in both disabledTypes and comingSoonTypes', () => {
    it('when a type is in both arrays, clicking does not emit', async () => {
      const wrapper = createWrapper({
        variant: 'modal',
        layout: 'grid',
        disabledTypes: ['browser'],
        comingSoonTypes: ['browser'],
      });
      const browserCard = wrapper.find('[data-test="check-type-picker-grid-card-browser"]');
      await browserCard.trigger('click');
      expect(wrapper.emitted('select')).toBeFalsy();
    });

    it('when a type is in both arrays, only disabled class is applied (disabled takes precedence)', () => {
      const wrapper = createWrapper({
        variant: 'modal',
        layout: 'grid',
        disabledTypes: ['tcp'],
        comingSoonTypes: ['tcp'],
      });
      const tcpCard = wrapper.find('[data-test="check-type-picker-grid-card-tcp"]');
      // disabled wins — only opacity-50, not opacity-70
      expect(tcpCard.classes()).toContain('opacity-50');
      expect(tcpCard.classes()).not.toContain('opacity-70');
      // Not clickable
      expect(tcpCard.classes()).not.toContain('cursor-pointer');
      expect(tcpCard.classes()).toContain('cursor-not-allowed');
    });

    it('when a type is in both arrays, the coming-soon badge is NOT rendered (disabled takes precedence)', () => {
      const wrapper = createWrapper({
        variant: 'modal',
        layout: 'grid',
        disabledTypes: ['tcp'],
        comingSoonTypes: ['tcp'],
      });
      const tcpCard = wrapper.find('[data-test="check-type-picker-grid-card-tcp"]');
      expect(tcpCard.find('.o-tag-stub').exists()).toBe(false);
    });

    it('when a type is in both arrays, pointer-events-none is applied to EmptyStateActionCard', () => {
      const wrapper = createWrapper({
        variant: 'modal',
        layout: 'grid',
        disabledTypes: ['tcp'],
        comingSoonTypes: ['tcp'],
      });
      const tcpCard = wrapper.find('[data-test="check-type-picker-grid-card-tcp"]');
      const actionCard = tcpCard.find('.empty-state-action-card-stub');
      expect(actionCard.classes()).toContain('pointer-events-none');
    });
  });

  describe('Props passed to EmptyStateActionCard', () => {
    it('passes icon, label, and sublabel for each card', () => {
      const wrapper = createWrapper({ variant: 'modal', layout: 'grid' });
      const cards = wrapper.findAll('.empty-state-action-card-stub');

      // Map of expected type -> { icon, label, sublabel }
      const expected: Record<SyntheticCheckType, { icon: string; label: string; sublabel: string }> = {
        browser: { icon: 'open-in-browser', label: 'Browser Test', sublabel: 'Record multi-step user journeys in a real browser' },
        http: { icon: 'network-check', label: 'HTTP / API', sublabel: 'Check endpoints, status codes, and response bodies' },
        tcp: { icon: 'bolt', label: 'TCP Port', sublabel: 'Verify a host and port are reachable' },
        tls: { icon: 'shield', label: 'SSL / TLS Certificate', sublabel: 'Monitor SSL/TLS certificate validity and expiry' },
        ssh: { icon: 'keyboard', label: 'SSH', sublabel: 'Confirm SSH connectivity to a server' },
      };

      for (let i = 0; i < CHECK_TYPES.length; i++) {
        const type = CHECK_TYPES[i];
        const card = cards[i];
        expect(card.attributes('data-icon')).toBe(expected[type].icon);
        expect(card.attributes('data-label')).toBe(expected[type].label);
        expect(card.attributes('data-sublabel')).toBe(expected[type].sublabel);
      }
    });

    it('adds w-full max-w-full classes to all EmptyStateActionCards', () => {
      const wrapper = createWrapper({ variant: 'modal', layout: 'grid' });
      const cards = wrapper.findAll('.empty-state-action-card-stub');
      for (let i = 0; i < cards.length; i++) {
        expect(cards[i].attributes('class')).toContain('w-full');
        expect(cards[i].attributes('class')).toContain('max-w-full');
      }
    });
  });

  describe('Empty/edge cases', () => {
    it('handles empty disabledTypes array (default)', () => {
      const wrapper = createWrapper({ variant: 'modal', layout: 'grid' });
      // All cards should be clickable — no disabled classes
      const cardWrappers = wrapper.findAll('[data-test^="check-type-picker-grid-card-"]');
      for (let i = 0; i < cardWrappers.length; i++) {
        expect(cardWrappers[i].classes()).not.toContain('opacity-50');
        expect(cardWrappers[i].classes()).not.toContain('cursor-not-allowed');
      }
    });

    it('handles empty comingSoonTypes array (default)', () => {
      const wrapper = createWrapper({ variant: 'modal', layout: 'grid' });
      // No badges should be present
      expect(wrapper.findAll('.o-tag-stub')).toHaveLength(0);
    });

    it('all types can be disabled simultaneously', () => {
      const types: SyntheticCheckType[] = ['browser', 'http', 'tcp', 'tls', 'ssh'];
      const wrapper = createWrapper({
        variant: 'inline',
        layout: 'row',
        disabledTypes: types,
      });
      const cards = wrapper.findAll('.empty-state-action-card-stub');
      for (let i = 0; i < cards.length; i++) {
        const parentDiv = wrapper.findAll('[data-test^="check-type-picker-row-card-"]')[i];
        expect(parentDiv.classes()).toContain('opacity-50');
      }
    });

    it('all types can be marked coming-soon simultaneously', () => {
      const types: SyntheticCheckType[] = ['browser', 'http', 'tcp', 'tls', 'ssh'];
      const wrapper = createWrapper({
        variant: 'inline',
        layout: 'row',
        comingSoonTypes: types,
      });
      // Badge should appear inside each card's wrapper
      const badgeContainers = wrapper.findAll('[data-test^="check-type-picker-row-card-"]');
      for (let i = 0; i < badgeContainers.length; i++) {
        expect(badgeContainers[i].find('.o-tag-stub').exists()).toBe(true);
      }
    });
  });
});
