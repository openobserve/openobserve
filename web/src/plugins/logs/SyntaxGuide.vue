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
          class="w-full! justify-start! px-3! py-1.5! h-auto! rounded-md! gap-2! font-normal!"
        >
          <template #icon-left>
            <span class="inline-flex items-center justify-center w-7 h-7 rounded-md bg-[var(--o2-section-header-bg)] text-[var(--o2-text-secondary)] shrink-0">
              <OIcon name="help" size="sm" />
            </span>
          </template>
          {{ t('search.syntaxGuideLabel') }}
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
            noBorder ? 'border-0! bg-transparent! p-0! m-0! w-full justify-start hover:bg-transparent!' : '',
          ]"
          class="h-4.5!"
        >
          <OIcon name="help" size="sm" />
          <span v-if="label">{{ label }}</span>
          <span v-else-if="!noBorder" class="ml-1">{{ t('search.syntaxGuideLabel') }}</span>
          <OTooltip :content="t('search.syntaxGuideLabel')" />
        </OButton>
      </div>
    </template>
    <div :class="store.state.theme == 'dark' ? 'theme-dark' : 'theme-light'">
      <div v-if="!sqlmode">
        <div class="syntax-guide-title">
          <div class="label">{{ t("search.syntaxGuideLabel") }}</div>
        </div>
        <div class="border-t my-1 border-dropdown-separator" />
        <div class="answers">
          <div class="syntax-section">
            <div class="syntax-guide-text">
              <ul class="guide-list">
                <li>
                  {{ t('logs.syntaxGuide.invertedIndexPre') }}
                  <span class="bg-highlight">match_all('error')</span>
                  {{ t('logs.syntaxGuide.invertedIndexPost') }}
                </li>
                <li>
                  {{ t('logs.syntaxGuide.prefixPre') }}
                  <span class="bg-highlight">match_all('error*')</span>
                  {{ t('logs.syntaxGuide.prefixPost') }}
                </li>
                <li>
                  {{ t('logs.syntaxGuide.phrasePrefixPre') }}
                  <span class="bg-highlight">match_all('error code*')</span>
                  {{ t('logs.syntaxGuide.phrasePrefixPost') }}
                </li>
                <li>
                  {{ t('logs.syntaxGuide.caseSensitivePre') }}
                  <span class="bg-highlight">match_all('traceHits')</span>
                  {{ t('logs.syntaxGuide.caseSensitivePost') }}
                </li>
                <li>
                  {{ t('logs.syntaxGuide.postfixPre') }}
                  <span class="bg-highlight">match_all('*failed')</span>
                  {{ t('logs.syntaxGuide.postfixPost') }}
                </li>
                <li>
                  {{ t('logs.syntaxGuide.columnSearchPre') }}
                  <span class="bg-highlight"
                    >str_match(<b>fieldname</b>, 'error')</span
                  >
                </li>
                <li>
                  {{ t('logs.syntaxGuide.columnSearchCaseInsensitivePre') }}
                  <span class="bg-highlight"
                    >str_match_ignore_case(<b>fieldname</b>, 'Error')</span
                  >
                </li>
                <li>
                  {{ t('logs.syntaxGuide.codeColumnPre') }}
                  <span class="bg-highlight">code=200</span>
                </li>
                <li>
                  {{ t('logs.syntaxGuide.streamColumnPre') }}
                  <span class="bg-highlight">stream='stderr'</span>
                </li>
                <li>
                  {{ t('logs.syntaxGuide.additionalExamples') }}
                  <a
                    href="https://openobserve.ai/docs/example-queries/"
                    target="_blank"
                    class="hover:underline text-primary"
                    >{{ t('logs.syntaxGuide.clickHere') }}</a
                  >.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div v-else>
        <div class="syntax-guide-title">
          <div class="label">{{ t('logs.syntaxGuide.sqlModeTitle') }}</div>
        </div>
        <div class="border-t my-1 border-dropdown-separator" />
        <div class="answers">
          <div class="syntax-section">
            <div class="syntax-guide-text">
              <ul class="guide-list">
                <li>
                  {{ t('logs.syntaxGuide.invertedIndexPre') }}
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE match_all('error')</span
                  >
                  {{ t('logs.syntaxGuide.invertedIndexPost') }}
                </li>
                <li>
                  {{ t('logs.syntaxGuide.prefixPre') }}
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE match_all('error*')</span
                  >
                  {{ t('logs.syntaxGuide.prefixPost') }}
                </li>
                <li>
                  {{ t('logs.syntaxGuide.phrasePrefixPre') }}
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE match_all('error
                    code*')</span
                  >
                  {{ t('logs.syntaxGuide.phrasePrefixPost') }}
                </li>
                <li>
                  {{ t('logs.syntaxGuide.caseSensitivePre') }}
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE
                    match_all('traceHits')</span
                  >
                  {{ t('logs.syntaxGuide.caseSensitivePost') }}
                </li>
                <li>
                  {{ t('logs.syntaxGuide.postfixPre') }}
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE
                    match_all('*failed')</span
                  >
                  {{ t('logs.syntaxGuide.postfixPost') }}
                </li>
                <li>
                  {{ t('logs.syntaxGuide.columnSearchPre') }}
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE
                    str_match(<b>fieldname</b>, 'error')</span
                  >
                </li>
                <li>
                  {{ t('logs.syntaxGuide.codeColumnPre') }}
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE code=200</span
                  >
                </li>
                <li>
                  {{ t('logs.syntaxGuide.streamColumnPre') }}
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE stream='stderr'</span
                  >
                </li>
                <li>
                  {{ t('logs.syntaxGuide.queryFunctionPre') }} <i>extract_ip</i>
                  {{ t('logs.syntaxGuide.queryFunctionPost') }}
                  <span class="bg-highlight"
                    >SELECT extract_ip(log) FROM <b>stream</b> WHERE
                    code=200</span
                  >
                </li>
                <li>
                  {{ t('logs.syntaxGuide.additionalExamples') }}
                  <a
                    href="https://openobserve.ai/docs/example-queries/"
                    target="_blank"
                    class="hover:underline text-primary"
                    >{{ t('logs.syntaxGuide.clickHere') }}</a
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
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
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
      type: String,
      default: "",
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
    const { t } = useI18n();
    const store = useStore();
    return {
      t,
      store,
    };
  },
});
</script>
