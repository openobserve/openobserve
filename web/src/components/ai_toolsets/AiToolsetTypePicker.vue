<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OText from "@/lib/core/Typography/OText.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import { getImageURL } from "@/utils/queryUtils";
import { stripPresetName, type Preset } from "@/components/ai_toolsets/presets";

export interface ToolsetFrom {
  preset?: string;
  kind?: string;
}

interface Card {
  key: string;
  icon: string;
  label: I18nText;
  desc: I18nText;
  from: ToolsetFrom;
}

const props = defineProps<{
  mcpPresets: Preset[];
}>();

const emit = defineEmits<{
  select: [from: ToolsetFrom];
}>();

const { t } = useI18nTyped();

// The server's preset has no logo field, so known brands are mapped by id.
const logo = (file: string) => `img:${getImageURL(`images/ai_toolsets/${file}.svg`)}`;
const MCP_LOGO = logo("model-context-protocol");
const PRESET_LOGOS: Record<string, string> = {
  datadog: logo("datadog"),
  dynatrace: logo("dynatrace"),
  grafana: logo("grafana"),
};

// "Datadog: metrics, logs" -> "metrics, logs"; the card title already says the name.
const mcpCards = computed<Card[]>(() => [
  ...props.mcpPresets.map((p) => ({
    key: p.id,
    icon: PRESET_LOGOS[p.id] ?? MCP_LOGO,
    label: raw(p.label),
    desc: p.description
      ? raw(stripPresetName(p.description, p.label))
      : t("aiToolset.addMcpDesc", { name: p.label }),
    from: { preset: p.id },
  })),
  {
    key: "custom-mcp",
    icon: MCP_LOGO,
    label: t("aiToolset.addCustomMcp"),
    desc: t("aiToolset.addCustomMcpDesc"),
    from: {},
  },
]);

const skillCards = computed<Card[]>(() => [
  {
    key: "skill",
    icon: "menu-book",
    label: t("aiToolset.addCustomSkill"),
    desc: t("aiToolset.addSkillDesc"),
    from: { kind: "skill" },
  },
]);

const sections = computed(() =>
  [
    { key: "mcp", title: t("aiToolset.groupMcp"), cards: mcpCards.value },
    { key: "skills", title: t("aiToolset.groupSkills"), cards: skillCards.value },
  ].filter((section) => section.cards.length),
);
</script>

<template>
  <div class="flex flex-col gap-5" data-test="ai-toolset-type-picker">
    <section
      v-for="section in sections"
      :key="section.key"
      class="flex flex-col gap-2"
      :data-test="`ai-toolsets-section-${section.key}`"
    >
      <OText as="h3" variant="meta">{{ section.title }}</OText>
      <div class="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <div
          v-for="card in section.cards"
          :key="card.key"
          class="relative cursor-pointer"
          :data-test="`ai-toolsets-add-${card.key}`"
          @click="emit('select', card.from)"
        >
          <EmptyStateActionCard
            :icon="card.icon"
            :label="card.label"
            :sublabel="card.desc"
            hide-chevron
            icon-surface="plain"
            class="h-full w-full max-w-full"
          />
        </div>
      </div>
    </section>
  </div>
</template>
