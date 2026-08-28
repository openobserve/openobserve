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

<template>
  <ODropdown side="bottom" align="start">
    <template #trigger>
      <div>
        <!-- Menu-item style: full-width, left-aligned, badge icon — used when placed inside a dropdown -->
        <OButton
          v-if="menuItem"
          data-cy="syntax-guide-button"
          variant="ghost"
          size="sm"
          class="rounded-default! h-auto! w-full! justify-start! gap-2! px-3! py-1.5! font-normal!"
        >
          <template #icon-left>
            <span
              class="rounded-default bg-section-header-bg text-text-secondary inline-flex h-7 w-7 shrink-0 items-center justify-center"
            >
              <OIcon name="help" size="sm" />
            </span>
          </template>
          {{ t("search.syntaxGuideLabel") }}
        </OButton>
        <!-- Toolbar style: outline button matching sibling toolbar buttons (e.g. Reset) -->
        <OButton
          v-else-if="toolbar"
          data-cy="syntax-guide-button"
          variant="outline"
          size="xs"
          :class="[sqlmode ? 'sql-mode' : 'normal-mode']"
        >
          <OIcon name="help" size="sm" />
          <span v-if="label">{{ label }}</span>
          <OTooltip :content="t('search.syntaxGuideLabel')" />
        </OButton>
        <!-- Default style: compact inline button for toolbar use -->
        <OButton
          v-else
          data-cy="syntax-guide-button"
          variant="ghost"
          size="sm"
          :class="[
            noBorder ? 'display-none!' : 'ml-1',
            sqlmode ? 'sql-mode' : 'normal-mode',
            noBorder
              ? 'm-0! w-full justify-start border-0! bg-transparent! p-0! hover:bg-transparent!'
              : '',
          ]"
          class="h-4.5!"
        >
          <OIcon name="help" size="sm" />
          <span v-if="label">{{ label }}</span>
          <span v-else-if="!noBorder" class="ml-1">{{ t("search.syntaxGuideLabel") }}</span>
          <OTooltip :content="t('search.syntaxGuideLabel')" />
        </OButton>
      </div>
    </template>
    <div>
      <div v-if="!sqlmode">
        <div class="w-105">
          <div class="label text-sm font-bold">{{ t("search.syntaxGuideLabel") }}</div>
        </div>
        <div class="border-dropdown-separator my-1 border-t" />
        <div class="answers">
          <div class="mb-1.25">
            <div class="ml-1.25 text-xs">
              <ul class="mt-2.5 mb-0 px-2.5 text-sm leading-[1.4375rem]">
                <!-- The prose in each item is translated; the query fragments next to it are
                     NOT — they are syntax, and a translated match_all() would be a query
                     that does not run. -->
                <!-- eslint-disable vue/no-bare-strings-in-template -->
                <li>
                  {{ t("search.syntaxGuide.invertedIndex") }}
                  <span class="bg-highlight-bg px-1.25">match_all('error')</span>
                  {{ t("search.syntaxGuide.invertedIndexHint") }}
                </li>
                <li>
                  {{ t("search.syntaxGuide.prefix") }}
                  <span class="bg-highlight-bg px-1.25">match_all('error*')</span>
                  {{ t("search.syntaxGuide.prefixHint") }}
                </li>
                <li>
                  {{ t("search.syntaxGuide.phrasePrefix") }}
                  <span class="bg-highlight-bg px-1.25">match_all('error code*')</span>
                  {{ t("search.syntaxGuide.phrasePrefixHint") }}
                </li>
                <li>
                  {{ t("search.syntaxGuide.caseSensitive") }}
                  <span class="bg-highlight-bg px-1.25">match_all('traceHits')</span>
                  {{ t("search.syntaxGuide.caseSensitiveHint") }}
                </li>
                <li>
                  {{ t("search.syntaxGuide.postfix") }}
                  <span class="bg-highlight-bg px-1.25">match_all('*failed')</span>
                  {{ t("search.syntaxGuide.postfixHint") }}
                </li>
                <li>
                  {{ t("search.syntaxGuide.column") }}
                  <span class="bg-highlight-bg px-1.25">str_match(<b>fieldname</b>, 'error')</span>
                </li>
                <li>
                  {{ t("search.syntaxGuide.columnIgnoreCase") }}
                  <span class="bg-highlight-bg px-1.25"
                    >str_match_ignore_case(<b>fieldname</b>, 'Error')</span
                  >
                </li>
                <li>
                  {{ t("search.syntaxGuide.code") }}
                  <span class="bg-highlight-bg px-1.25">code=200</span>
                </li>
                <li>
                  {{ t("search.syntaxGuide.stream") }}
                  <span class="bg-highlight-bg px-1.25">stream='stderr'</span>
                </li>
                <!-- eslint-enable vue/no-bare-strings-in-template -->
                <li>
                  {{ t("search.syntaxGuide.moreExamples") }}
                  <a
                    href="https://openobserve.ai/docs/example-queries/"
                    target="_blank"
                    class="text-primary hover:underline"
                    >{{ t("search.syntaxGuide.clickHere") }}</a
                  >.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div v-else>
        <div class="w-105">
          <div class="label text-sm font-bold">{{ t("search.syntaxGuide.sqlTitle") }}</div>
        </div>
        <div class="border-dropdown-separator my-1 border-t" />
        <div class="answers">
          <div class="mb-1.25">
            <div class="ml-1.25 text-xs">
              <ul class="mt-2.5 mb-0 px-2.5 text-sm leading-[1.4375rem]">
                <!-- As above: the prose is translated, the SQL samples are left literal. -->
                <!-- eslint-disable vue/no-bare-strings-in-template -->
                <li>
                  {{ t("search.syntaxGuide.invertedIndex") }}
                  <span class="bg-highlight-bg px-1.25"
                    >SELECT * FROM <b>stream</b> WHERE match_all('error')</span
                  >
                  {{ t("search.syntaxGuide.invertedIndexHint") }}
                </li>
                <li>
                  {{ t("search.syntaxGuide.prefix") }}
                  <span class="bg-highlight-bg px-1.25"
                    >SELECT * FROM <b>stream</b> WHERE match_all('error*')</span
                  >
                  {{ t("search.syntaxGuide.prefixHint") }}
                </li>
                <li>
                  {{ t("search.syntaxGuide.phrasePrefix") }}
                  <span class="bg-highlight-bg px-1.25"
                    >SELECT * FROM <b>stream</b> WHERE match_all('error code*')</span
                  >
                  {{ t("search.syntaxGuide.phrasePrefixHint") }}
                </li>
                <li>
                  {{ t("search.syntaxGuide.caseSensitive") }}
                  <span class="bg-highlight-bg px-1.25"
                    >SELECT * FROM <b>stream</b> WHERE match_all('traceHits')</span
                  >
                  {{ t("search.syntaxGuide.caseSensitiveHint") }}
                </li>
                <li>
                  {{ t("search.syntaxGuide.postfix") }}
                  <span class="bg-highlight-bg px-1.25"
                    >SELECT * FROM <b>stream</b> WHERE match_all('*failed')</span
                  >
                  {{ t("search.syntaxGuide.postfixHint") }}
                </li>
                <li>
                  {{ t("search.syntaxGuide.column") }}
                  <span class="bg-highlight-bg px-1.25"
                    >SELECT * FROM <b>stream</b> WHERE str_match(<b>fieldname</b>, 'error')</span
                  >
                </li>
                <li>
                  {{ t("search.syntaxGuide.code") }}
                  <span class="bg-highlight-bg px-1.25"
                    >SELECT * FROM <b>stream</b> WHERE code=200</span
                  >
                </li>
                <li>
                  {{ t("search.syntaxGuide.stream") }}
                  <span class="bg-highlight-bg px-1.25"
                    >SELECT * FROM <b>stream</b> WHERE stream='stderr'</span
                  >
                </li>
                <li>
                  <!-- Both the function name and the sample are slots, so the sentence can be
                       reordered by a translator without stranding the <i> or the space. -->
                  <i18n-t keypath="search.syntaxGuide.queryFunction" tag="span">
                    <template #fn>
                      <i>extract_ip</i>
                    </template>
                    <template #query>
                      <span class="bg-highlight-bg px-1.25"
                        >SELECT extract_ip(log) FROM <b>stream</b> WHERE code=200</span
                      >
                    </template>
                  </i18n-t>
                </li>
                <!-- eslint-enable vue/no-bare-strings-in-template -->
                <li>
                  {{ t("search.syntaxGuide.moreExamples") }}
                  <a
                    href="https://openobserve.ai/docs/example-queries/"
                    target="_blank"
                    class="text-primary hover:underline"
                    >{{ t("search.syntaxGuide.clickHere") }}</a
                  >.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  </ODropdown>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { raw, type I18nText, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
export default defineComponent({
  name: "ComponentSearchSyntaxGuide",
  props: {
    sqlmode: {
      type: Boolean,
      default: false,
    },
    noBorder: {
      type: Boolean,
      default: false,
    },
    label: {
      type: String as unknown as PropType<I18nText>,
      default: raw(""),
    },
    menuItem: {
      type: Boolean,
      default: false,
    },
    toolbar: {
      type: Boolean,
      default: false,
    },
  },
  components: { OButton, OTooltip, OIcon, ODropdown },
  setup() {
    const { t } = useI18nTyped();
    const store = useStore();
    return {
      raw,
      t,
      store,
    };
  },
});
</script>
