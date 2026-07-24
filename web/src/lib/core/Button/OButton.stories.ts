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

import type { Meta, StoryObj } from "@storybook/vue3-vite";
import OButton from "./OButton.vue";
import type { ButtonSize, ButtonVariant } from "./OButton.types";

const VARIANTS: ButtonVariant[] = [
  "primary",
  "secondary",
  "outline",
  "ghost",
  "ghost-primary",
  "ghost-muted",
  "ghost-destructive",
  "ghost-success",
  "ghost-warning",
  "destructive",
  "warning",
  "outline-primary",
  "ai-gradient",
];

const SIZES: ButtonSize[] = ["xs", "sm", "md", "lg"];

const meta: Meta<typeof OButton> = {
  title: "Core/OButton",
  component: OButton,
  tags: ["autodocs"],
  args: {
    variant: "primary",
    size: "md",
    disabled: false,
    loading: false,
    default: "Button",
  },
  argTypes: {
    variant: { control: "select", options: VARIANTS },
    size: { control: "select", options: SIZES },
    type: { control: "select", options: ["button", "submit", "reset"] },
    disabled: { control: "boolean" },
    loading: { control: "boolean" },
    active: { control: "boolean" },
    block: { control: "boolean" },
    iconLeft: { control: "text" },
    iconRight: { control: "text" },
    default: { control: "text", description: "Default slot (label)" },
    onClick: { action: "click" },
  },
};

export default meta;
type Story = StoryObj<typeof OButton>;

/** Prop-driven playground — every control maps to a real OButton prop. */
export const Playground: Story = {
  render: (args) => ({
    components: { OButton },
    setup: () => ({ args }),
    template: `<OButton v-bind="args" @click="args.onClick">{{ args.default }}</OButton>`,
  }),
};

/** Every labelled variant across the four text sizes. */
export const Variants: Story = {
  args: {
    variant: "outline"
  },

  render: () => ({
    components: { OButton },
    setup: () => ({ variants: VARIANTS, sizes: SIZES }),
    template: `
      <div class="flex flex-col gap-3">
        <div v-for="v in variants" :key="v" class="flex flex-wrap items-center gap-3">
          <span class="w-40 shrink-0 font-mono text-xs text-text-muted">{{ v }}</span>
          <OButton v-for="s in sizes" :key="s" :variant="v" :size="s">{{ s }}</OButton>
        </div>
      </div>
    `,
  })
};

/** Disabled / loading / active / block states. */
export const States: Story = {
  render: () => ({
    components: { OButton },
    template: `
      <div class="flex flex-wrap items-center gap-3">
        <OButton disabled>Disabled</OButton>
        <OButton loading>Loading</OButton>
        <OButton variant="ghost" active>Active</OButton>
        <OButton icon-left="add">Icon left</OButton>
        <OButton icon-right="chevron-right">Icon right</OButton>
      </div>
    `,
  }),
};
