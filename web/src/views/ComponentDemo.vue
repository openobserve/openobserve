// Copyright 2026 OpenObserve Inc.
<script setup lang="ts">
/**
 * O2 Component Library — Interactive Demo Playground
 *
 * Dev-only route: /demo
 * Showcases all 13 O2 components with every variant, state, and prop.
 * No auth required — designed for developer reference and visual QA.
 */

import { computed, ref } from "vue";
import {
  O2Btn,
  O2BtnToggle,
  O2Checkbox,
  O2Field,
  O2File,
  O2Form,
  O2Input,
  O2OptionGroup,
  O2Radio,
  O2Range,
  O2Select,
  O2Slider,
  O2Toggle,
} from "@/lib";

// ─── Active section navigation ────────────────────────────────────────────────

const sections = [
  { id: "o2-input", label: "O2Input" },
  { id: "o2-select", label: "O2Select" },
  { id: "o2-btn", label: "O2Btn" },
  { id: "o2-checkbox", label: "O2Checkbox" },
  { id: "o2-toggle", label: "O2Toggle" },
  { id: "o2-radio", label: "O2Radio" },
  { id: "o2-field", label: "O2Field" },
  { id: "o2-slider", label: "O2Slider" },
  { id: "o2-range", label: "O2Range" },
  { id: "o2-btn-toggle", label: "O2BtnToggle" },
  { id: "o2-option-group", label: "O2OptionGroup" },
  { id: "o2-file", label: "O2File" },
  { id: "o2-form", label: "O2Form" },
];

const activeSection = ref("o2-input");

const scrollTo = (id: string) => {
  activeSection.value = id;
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
};

// ─── O2Input state ────────────────────────────────────────────────────────────

const inputBasic = ref("Hello world");
const inputEmpty = ref("");
const inputPassword = ref("secret");
const inputTextarea = ref("Multi-line\ncontent here");
const inputNumber = ref(42);
const inputSearch = ref("");

// ─── O2Select state ───────────────────────────────────────────────────────────

const colorOptions = [
  { label: "Red", value: "red" },
  { label: "Green", value: "green" },
  { label: "Blue", value: "blue" },
  { label: "Purple", value: "purple" },
  { label: "Orange", value: "orange" },
];
const selectSingle = ref("green");
const selectMultiple = ref(["red", "blue"]);
const selectSearch = ref<string | null>(null);
const selectSearchOptions = ref(colorOptions);

const filterColors = (val: string, update: (fn: () => void) => void) => {
  update(() => {
    if (!val) {
      selectSearchOptions.value = colorOptions;
    } else {
      const q = val.toLowerCase();
      selectSearchOptions.value = colorOptions.filter((o) =>
        o.label.toLowerCase().includes(q),
      );
    }
  });
};

// ─── O2Btn state ──────────────────────────────────────────────────────────────

const btnLoadingActive = ref(false);

const triggerLoading = () => {
  btnLoadingActive.value = true;
  setTimeout(() => (btnLoadingActive.value = false), 2000);
};

// ─── O2Checkbox state ─────────────────────────────────────────────────────────

const checkA = ref(true);
const checkB = ref(false);
const checkIndeterminate = ref(null as boolean | null);

// ─── O2Toggle state ───────────────────────────────────────────────────────────

const toggleA = ref(true);
const toggleB = ref(false);

// ─── O2Radio state ────────────────────────────────────────────────────────────

const radioValue = ref("b");

// ─── O2Field state ────────────────────────────────────────────────────────────

const fieldInput = ref("Custom field");

// ─── O2Slider state ───────────────────────────────────────────────────────────

const sliderValue = ref(40);
const sliderDense = ref(60);

// ─── O2Range state ────────────────────────────────────────────────────────────

const rangeValue = ref({ min: 20, max: 70 });

// ─── O2BtnToggle state ────────────────────────────────────────────────────────

const viewToggle = ref("list");
const viewToggleFlat = ref("day");
const viewToggleOutline = ref("week");

const viewOptions = [
  { label: "List", value: "list" },
  { label: "Grid", value: "grid" },
  { label: "Table", value: "table" },
];
const periodOptions = [
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
];

// ─── O2OptionGroup state ──────────────────────────────────────────────────────

const radioGroup = ref("b");
const checkboxGroup = ref(["b", "c"]);
const toggleGroup = ref("b");

const groupOptions = [
  { label: "Option A", value: "a" },
  { label: "Option B", value: "b" },
  { label: "Option C", value: "c" },
  { label: "Disabled", value: "d", disable: true },
];

// ─── O2File state ─────────────────────────────────────────────────────────────

const singleFile = ref<File | null>(null);
const multipleFiles = ref<File[]>([]);

// ─── O2Form state ─────────────────────────────────────────────────────────────

const formData = ref({ name: "", email: "" });
const formValid = ref<boolean | null>(null);
const formRef = ref<InstanceType<typeof O2Form> | null>(null);

const nameRules = [(v: string) => !!v || "Name is required"];
const emailRules = [
  (v: string) => !!v || "Email is required",
  (v: string) => /.+@.+\..+/.test(v) || "Invalid email",
];

const validateForm = async () => {
  if (!formRef.value) return;
  formValid.value = await (formRef.value as any).validate();
};

const resetForm = () => {
  formData.value = { name: "", email: "" };
  formValid.value = null;
  (formRef.value as any)?.resetValidation();
};

// ─── Code badge display ───────────────────────────────────────────────────────

const showCode = ref<Record<string, boolean>>({});
const toggleCode = (id: string) => {
  showCode.value[id] = !showCode.value[id];
};
</script>

<template>
  <div class="o2-demo">
    <!-- ── Sidebar ─────────────────────────────────────────────────────────── -->
    <aside class="o2-demo__sidebar">
      <div class="o2-demo__sidebar-logo">
        <span class="o2-demo__sidebar-title">O2 Components</span>
        <span class="o2-demo__sidebar-subtitle">Design System Playground</span>
      </div>
      <nav class="o2-demo__nav">
        <button
          v-for="s in sections"
          :key="s.id"
          class="o2-demo__nav-item"
          :data-active="activeSection === s.id || undefined"
          @click="scrollTo(s.id)"
        >
          {{ s.label }}
        </button>
      </nav>
    </aside>

    <!-- ── Main content ───────────────────────────────────────────────────── -->
    <main class="o2-demo__main">
      <header class="o2-demo__header">
        <h1 class="o2-demo__heading">Component Library</h1>
        <p class="o2-demo__sub">
          Headless-first replacements for all Quasar form elements. Three-layer
          design-token strategy. Shadcn / Radix UI data-attribute state
          conventions.
        </p>
      </header>

      <!-- ══════════════════════════════════════════════════════════════════ -->
      <!-- O2Input                                                            -->
      <!-- ══════════════════════════════════════════════════════════════════ -->
      <section :id="sections[0].id" class="o2-demo__section">
        <div class="o2-demo__section-header">
          <h2 class="o2-demo__section-title">O2Input</h2>
          <span class="o2-demo__section-tag">replaces q-input</span>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Variants</p>
          <div class="o2-demo__row">
            <O2Input
              v-model="inputBasic"
              label="Outlined (default)"
              variant="outlined"
              data-test="demo-input-outlined"
            />
            <O2Input
              v-model="inputBasic"
              label="Borderless"
              variant="borderless"
              data-test="demo-input-borderless"
            />
            <O2Input
              v-model="inputBasic"
              label="Filled"
              variant="filled"
              data-test="demo-input-filled"
            />
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">States</p>
          <div class="o2-demo__row">
            <O2Input
              v-model="inputEmpty"
              label="Placeholder"
              placeholder="Enter text…"
              hint="Helper text appears here"
              data-test="demo-input-placeholder"
            />
            <O2Input
              v-model="inputBasic"
              label="Error state"
              :error="true"
              error-message="This field is required"
              data-test="demo-input-error"
            />
            <O2Input
              v-model="inputBasic"
              label="Disabled"
              :disabled="true"
              data-test="demo-input-disabled"
            />
            <O2Input
              v-model="inputBasic"
              label="Loading"
              :loading="true"
              data-test="demo-input-loading"
            />
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Types</p>
          <div class="o2-demo__row">
            <O2Input
              v-model="inputPassword"
              label="Password"
              type="password"
              data-test="demo-input-password"
            />
            <O2Input
              v-model="inputNumber"
              label="Number"
              type="number"
              data-test="demo-input-number"
            />
            <O2Input
              v-model="inputSearch"
              label="Search"
              type="search"
              placeholder="Search…"
              clearable
              data-test="demo-input-search"
            />
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Textarea</p>
          <div class="o2-demo__row">
            <O2Input
              v-model="inputTextarea"
              label="Textarea"
              type="textarea"
              :autogrow="false"
              data-test="demo-input-textarea"
            />
            <O2Input
              v-model="inputTextarea"
              label="Textarea autogrow"
              type="textarea"
              :autogrow="true"
              data-test="demo-input-autogrow"
            />
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Slots (prepend / append)</p>
          <div class="o2-demo__row">
            <O2Input
              v-model="inputSearch"
              label="With prepend icon"
              data-test="demo-input-prepend"
            >
              <template #prepend>
                <svg
                  viewBox="0 0 14 14"
                  width="12"
                  height="12"
                  fill="none"
                  style="color: var(--o2-text-muted)"
                >
                  <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.2" />
                  <path
                    d="M9.5 9.5L12.5 12.5"
                    stroke="currentColor"
                    stroke-width="1.2"
                    stroke-linecap="round"
                  />
                </svg>
              </template>
            </O2Input>
            <O2Input
              v-model="inputBasic"
              label="Counter"
              :counter="true"
              :maxlength="40"
              data-test="demo-input-counter"
            />
            <O2Input
              v-model="inputBasic"
              label="Clearable"
              :clearable="true"
              data-test="demo-input-clearable"
            />
          </div>
        </div>
      </section>

      <!-- ══════════════════════════════════════════════════════════════════ -->
      <!-- O2Select                                                           -->
      <!-- ══════════════════════════════════════════════════════════════════ -->
      <section :id="sections[1].id" class="o2-demo__section">
        <div class="o2-demo__section-header">
          <h2 class="o2-demo__section-title">O2Select</h2>
          <span class="o2-demo__section-tag">replaces q-select</span>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Basic dropdown</p>
          <div class="o2-demo__row">
            <O2Select
              v-model="selectSingle"
              :options="colorOptions"
              label="Single select"
              emit-value
              map-options
              data-test="demo-select-single"
            />
            <O2Select
              v-model="selectSingle"
              :options="colorOptions"
              label="Borderless"
              variant="borderless"
              emit-value
              map-options
              data-test="demo-select-borderless"
            />
            <O2Select
              v-model="selectSingle"
              :options="colorOptions"
              label="Filled"
              variant="filled"
              emit-value
              map-options
              data-test="demo-select-filled"
            />
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Multiple + chips</p>
          <div class="o2-demo__row">
            <O2Select
              v-model="selectMultiple"
              :options="colorOptions"
              label="Multiple"
              :multiple="true"
              emit-value
              map-options
              data-test="demo-select-multiple"
            />
            <O2Select
              v-model="selectMultiple"
              :options="colorOptions"
              label="Multiple + chips"
              :multiple="true"
              :use-chips="true"
              emit-value
              map-options
              data-test="demo-select-chips"
            />
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Searchable</p>
          <div class="o2-demo__row">
            <O2Select
              v-model="selectSearch"
              :options="selectSearchOptions"
              label="Search / filter"
              :use-input="true"
              :fill-input="true"
              :hide-selected="true"
              emit-value
              map-options
              placeholder="Type to search…"
              @filter="filterColors"
              data-test="demo-select-search"
            />
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">States</p>
          <div class="o2-demo__row">
            <O2Select
              v-model="selectSingle"
              :options="colorOptions"
              label="Error"
              :error="true"
              error-message="Please select a color"
              emit-value
              map-options
              data-test="demo-select-error"
            />
            <O2Select
              v-model="selectSingle"
              :options="colorOptions"
              label="Disabled"
              :disable="true"
              emit-value
              map-options
              data-test="demo-select-disabled"
            />
            <O2Select
              v-model="selectSingle"
              :options="colorOptions"
              label="Clearable"
              :clearable="true"
              emit-value
              map-options
              data-test="demo-select-clearable"
            />
          </div>
        </div>
      </section>

      <!-- ══════════════════════════════════════════════════════════════════ -->
      <!-- O2Btn                                                              -->
      <!-- ══════════════════════════════════════════════════════════════════ -->
      <section :id="sections[2].id" class="o2-demo__section">
        <div class="o2-demo__section-header">
          <h2 class="o2-demo__section-title">O2Btn</h2>
          <span class="o2-demo__section-tag">replaces q-btn</span>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Variants</p>
          <div class="o2-demo__row o2-demo__row--wrap">
            <O2Btn label="Default" data-test="demo-btn-default" />
            <O2Btn label="Flat" flat data-test="demo-btn-flat" />
            <O2Btn label="Outline" outline data-test="demo-btn-outline" />
            <O2Btn label="Unelevated" unelevated data-test="demo-btn-unelevated" />
            <O2Btn label="Push" push data-test="demo-btn-push" />
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Sizes</p>
          <div class="o2-demo__row o2-demo__row--wrap o2-demo__row--center">
            <O2Btn label="XS" size="xs" data-test="demo-btn-xs" />
            <O2Btn label="SM" size="sm" data-test="demo-btn-sm" />
            <O2Btn label="MD (default)" data-test="demo-btn-md" />
            <O2Btn label="LG" size="lg" data-test="demo-btn-lg" />
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Shapes</p>
          <div class="o2-demo__row o2-demo__row--wrap o2-demo__row--center">
            <O2Btn label="Default" data-test="demo-btn-shape-default" />
            <O2Btn label="Rounded" rounded data-test="demo-btn-rounded" />
            <O2Btn icon="★" round flat data-test="demo-btn-round" />
            <O2Btn label="Square" square data-test="demo-btn-square" />
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">States</p>
          <div class="o2-demo__row o2-demo__row--wrap o2-demo__row--center">
            <O2Btn
              :label="btnLoadingActive ? 'Working…' : 'Click to Load'"
              :loading="btnLoadingActive"
              @click="triggerLoading"
              data-test="demo-btn-loading"
            />
            <O2Btn label="Disabled" :disable="true" data-test="demo-btn-disabled" />
            <O2Btn
              label="No caps"
              :no-caps="true"
              data-test="demo-btn-nocaps"
            />
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">With icon</p>
          <div class="o2-demo__row o2-demo__row--wrap o2-demo__row--center">
            <O2Btn label="Save" icon="💾" data-test="demo-btn-icon-left" />
            <O2Btn label="Delete" icon-right="🗑" flat data-test="demo-btn-icon-right" />
            <O2Btn label="Full width" style="width: 100%" data-test="demo-btn-full" />
          </div>
        </div>
      </section>

      <!-- ══════════════════════════════════════════════════════════════════ -->
      <!-- O2Checkbox                                                         -->
      <!-- ══════════════════════════════════════════════════════════════════ -->
      <section :id="sections[3].id" class="o2-demo__section">
        <div class="o2-demo__section-header">
          <h2 class="o2-demo__section-title">O2Checkbox</h2>
          <span class="o2-demo__section-tag">replaces q-checkbox</span>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">States</p>
          <div class="o2-demo__row o2-demo__row--wrap">
            <O2Checkbox
              v-model="checkA"
              label="Checked"
              data-test="demo-checkbox-checked"
            />
            <O2Checkbox
              v-model="checkB"
              label="Unchecked"
              data-test="demo-checkbox-unchecked"
            />
            <O2Checkbox
              v-model="checkA"
              label="Disabled checked"
              :disable="true"
              data-test="demo-checkbox-disabled-checked"
            />
            <O2Checkbox
              v-model="checkB"
              label="Disabled unchecked"
              :disable="true"
              data-test="demo-checkbox-disabled-unchecked"
            />
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Dense</p>
          <div class="o2-demo__row o2-demo__row--wrap">
            <O2Checkbox
              v-model="checkA"
              label="Dense checked"
              :dense="true"
              data-test="demo-checkbox-dense-checked"
            />
            <O2Checkbox
              v-model="checkB"
              label="Dense unchecked"
              :dense="true"
              data-test="demo-checkbox-dense-unchecked"
            />
          </div>
        </div>
      </section>

      <!-- ══════════════════════════════════════════════════════════════════ -->
      <!-- O2Toggle                                                           -->
      <!-- ══════════════════════════════════════════════════════════════════ -->
      <section :id="sections[4].id" class="o2-demo__section">
        <div class="o2-demo__section-header">
          <h2 class="o2-demo__section-title">O2Toggle</h2>
          <span class="o2-demo__section-tag">replaces q-toggle</span>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">States</p>
          <div class="o2-demo__row o2-demo__row--wrap">
            <O2Toggle
              v-model="toggleA"
              label="On"
              data-test="demo-toggle-on"
            />
            <O2Toggle
              v-model="toggleB"
              label="Off"
              data-test="demo-toggle-off"
            />
            <O2Toggle
              v-model="toggleA"
              label="Disabled on"
              :disable="true"
              data-test="demo-toggle-disabled-on"
            />
            <O2Toggle
              v-model="toggleB"
              label="Disabled off"
              :disable="true"
              data-test="demo-toggle-disabled-off"
            />
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Dense</p>
          <div class="o2-demo__row o2-demo__row--wrap">
            <O2Toggle
              v-model="toggleA"
              label="Dense"
              :dense="true"
              data-test="demo-toggle-dense"
            />
          </div>
        </div>
      </section>

      <!-- ══════════════════════════════════════════════════════════════════ -->
      <!-- O2Radio                                                            -->
      <!-- ══════════════════════════════════════════════════════════════════ -->
      <section :id="sections[5].id" class="o2-demo__section">
        <div class="o2-demo__section-header">
          <h2 class="o2-demo__section-title">O2Radio</h2>
          <span class="o2-demo__section-tag">replaces q-radio</span>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Group (v-model shared)</p>
          <div class="o2-demo__row o2-demo__row--wrap">
            <O2Radio
              v-model="radioValue"
              val="a"
              label="Option A"
              data-test="demo-radio-a"
            />
            <O2Radio
              v-model="radioValue"
              val="b"
              label="Option B"
              data-test="demo-radio-b"
            />
            <O2Radio
              v-model="radioValue"
              val="c"
              label="Option C"
              data-test="demo-radio-c"
            />
            <O2Radio
              v-model="radioValue"
              val="d"
              label="Disabled"
              :disable="true"
              data-test="demo-radio-disabled"
            />
          </div>
          <p class="o2-demo__value-display">Selected: {{ radioValue }}</p>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Dense</p>
          <div class="o2-demo__row o2-demo__row--wrap">
            <O2Radio
              v-model="radioValue"
              val="a"
              label="Dense A"
              :dense="true"
              data-test="demo-radio-dense-a"
            />
            <O2Radio
              v-model="radioValue"
              val="b"
              label="Dense B"
              :dense="true"
              data-test="demo-radio-dense-b"
            />
          </div>
        </div>
      </section>

      <!-- ══════════════════════════════════════════════════════════════════ -->
      <!-- O2Field                                                            -->
      <!-- ══════════════════════════════════════════════════════════════════ -->
      <section :id="sections[6].id" class="o2-demo__section">
        <div class="o2-demo__section-header">
          <h2 class="o2-demo__section-title">O2Field</h2>
          <span class="o2-demo__section-tag">replaces q-field</span>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Custom content wrapper</p>
          <div class="o2-demo__row">
            <O2Field label="Custom content" hint="Wrap any element" data-test="demo-field-basic">
              <input
                v-model="fieldInput"
                class="o2-demo__raw-input"
                placeholder="Native input inside O2Field"
              />
            </O2Field>
            <O2Field
              label="Error state"
              :error="true"
              error-message="Field is invalid"
              data-test="demo-field-error"
            >
              <input v-model="fieldInput" class="o2-demo__raw-input" />
            </O2Field>
            <O2Field label="Borderless" variant="borderless" data-test="demo-field-borderless">
              <input v-model="fieldInput" class="o2-demo__raw-input" />
            </O2Field>
          </div>
        </div>
      </section>

      <!-- ══════════════════════════════════════════════════════════════════ -->
      <!-- O2Slider                                                           -->
      <!-- ══════════════════════════════════════════════════════════════════ -->
      <section :id="sections[7].id" class="o2-demo__section">
        <div class="o2-demo__section-header">
          <h2 class="o2-demo__section-title">O2Slider</h2>
          <span class="o2-demo__section-tag">replaces q-slider</span>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Basic</p>
          <div class="o2-demo__row o2-demo__row--col">
            <O2Slider
              v-model="sliderValue"
              :min="0"
              :max="100"
              data-test="demo-slider-basic"
            />
            <p class="o2-demo__value-display">Value: {{ sliderValue }}</p>
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">With label + markers</p>
          <div class="o2-demo__row o2-demo__row--col">
            <O2Slider
              v-model="sliderValue"
              :min="0"
              :max="100"
              :step="10"
              :label="true"
              :markers="true"
              data-test="demo-slider-label"
            />
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Dense + disabled</p>
          <div class="o2-demo__row o2-demo__row--col">
            <O2Slider
              v-model="sliderDense"
              :dense="true"
              data-test="demo-slider-dense"
            />
            <O2Slider
              v-model="sliderValue"
              :disable="true"
              data-test="demo-slider-disabled"
            />
          </div>
        </div>
      </section>

      <!-- ══════════════════════════════════════════════════════════════════ -->
      <!-- O2Range                                                            -->
      <!-- ══════════════════════════════════════════════════════════════════ -->
      <section :id="sections[8].id" class="o2-demo__section">
        <div class="o2-demo__section-header">
          <h2 class="o2-demo__section-title">O2Range</h2>
          <span class="o2-demo__section-tag">replaces q-range</span>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Dual-handle range</p>
          <div class="o2-demo__row o2-demo__row--col">
            <O2Range
              v-model="rangeValue"
              :min="0"
              :max="100"
              data-test="demo-range-basic"
            />
            <p class="o2-demo__value-display">
              Min: {{ rangeValue.min }} — Max: {{ rangeValue.max }}
            </p>
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">With labels</p>
          <div class="o2-demo__row o2-demo__row--col">
            <O2Range
              v-model="rangeValue"
              :min="0"
              :max="100"
              :label="true"
              data-test="demo-range-label"
            />
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Disabled</p>
          <div class="o2-demo__row o2-demo__row--col">
            <O2Range
              v-model="rangeValue"
              :disable="true"
              data-test="demo-range-disabled"
            />
          </div>
        </div>
      </section>

      <!-- ══════════════════════════════════════════════════════════════════ -->
      <!-- O2BtnToggle                                                        -->
      <!-- ══════════════════════════════════════════════════════════════════ -->
      <section :id="sections[9].id" class="o2-demo__section">
        <div class="o2-demo__section-header">
          <h2 class="o2-demo__section-title">O2BtnToggle</h2>
          <span class="o2-demo__section-tag">replaces q-btn-toggle</span>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Variants</p>
          <div class="o2-demo__row o2-demo__row--col">
            <div class="o2-demo__inline-row">
              <span class="o2-demo__inline-label">Default</span>
              <O2BtnToggle
                v-model="viewToggle"
                :options="viewOptions"
                data-test="demo-btntoggle-default"
              />
            </div>
            <div class="o2-demo__inline-row">
              <span class="o2-demo__inline-label">Flat</span>
              <O2BtnToggle
                v-model="viewToggleFlat"
                :options="periodOptions"
                :flat="true"
                data-test="demo-btntoggle-flat"
              />
            </div>
            <div class="o2-demo__inline-row">
              <span class="o2-demo__inline-label">Outline</span>
              <O2BtnToggle
                v-model="viewToggleOutline"
                :options="periodOptions"
                :outline="true"
                data-test="demo-btntoggle-outline"
              />
            </div>
            <div class="o2-demo__inline-row">
              <span class="o2-demo__inline-label">Dense</span>
              <O2BtnToggle
                v-model="viewToggle"
                :options="viewOptions"
                :dense="true"
                data-test="demo-btntoggle-dense"
              />
            </div>
            <div class="o2-demo__inline-row">
              <span class="o2-demo__inline-label">Rounded</span>
              <O2BtnToggle
                v-model="viewToggle"
                :options="viewOptions"
                :rounded="true"
                data-test="demo-btntoggle-rounded"
              />
            </div>
            <div class="o2-demo__inline-row">
              <span class="o2-demo__inline-label">Spread (full)</span>
              <O2BtnToggle
                v-model="viewToggle"
                :options="viewOptions"
                :spread="true"
                style="width: 16rem"
                data-test="demo-btntoggle-spread"
              />
            </div>
          </div>
        </div>
      </section>

      <!-- ══════════════════════════════════════════════════════════════════ -->
      <!-- O2OptionGroup                                                      -->
      <!-- ══════════════════════════════════════════════════════════════════ -->
      <section :id="sections[10].id" class="o2-demo__section">
        <div class="o2-demo__section-header">
          <h2 class="o2-demo__section-title">O2OptionGroup</h2>
          <span class="o2-demo__section-tag">replaces q-option-group</span>
        </div>

        <div class="o2-demo__group">
          <div class="o2-demo__row">
            <div>
              <p class="o2-demo__group-label">Radio (type="radio")</p>
              <O2OptionGroup
                v-model="radioGroup"
                :options="groupOptions"
                type="radio"
                data-test="demo-optgroup-radio"
              />
              <p class="o2-demo__value-display">Value: {{ radioGroup }}</p>
            </div>
            <div>
              <p class="o2-demo__group-label">Checkbox (type="checkbox")</p>
              <O2OptionGroup
                v-model="checkboxGroup"
                :options="groupOptions"
                type="checkbox"
                data-test="demo-optgroup-checkbox"
              />
              <p class="o2-demo__value-display">Values: {{ checkboxGroup.join(", ") }}</p>
            </div>
            <div>
              <p class="o2-demo__group-label">Toggle (type="toggle")</p>
              <O2OptionGroup
                v-model="toggleGroup"
                :options="groupOptions"
                type="toggle"
                data-test="demo-optgroup-toggle"
              />
              <p class="o2-demo__value-display">Value: {{ toggleGroup }}</p>
            </div>
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Inline layout</p>
          <O2OptionGroup
            v-model="radioGroup"
            :options="groupOptions.slice(0, 3)"
            type="radio"
            :inline="true"
            data-test="demo-optgroup-inline"
          />
        </div>
      </section>

      <!-- ══════════════════════════════════════════════════════════════════ -->
      <!-- O2File                                                             -->
      <!-- ══════════════════════════════════════════════════════════════════ -->
      <section :id="sections[11].id" class="o2-demo__section">
        <div class="o2-demo__section-header">
          <h2 class="o2-demo__section-title">O2File</h2>
          <span class="o2-demo__section-tag">replaces q-file</span>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Variants</p>
          <div class="o2-demo__row">
            <O2File
              v-model="singleFile"
              label="Single file (outlined)"
              :clearable="true"
              data-test="demo-file-single"
            />
            <O2File
              v-model="singleFile"
              label="Borderless"
              variant="borderless"
              :clearable="true"
              data-test="demo-file-borderless"
            />
            <O2File
              v-model="singleFile"
              label="Filled"
              variant="filled"
              :clearable="true"
              data-test="demo-file-filled"
            />
          </div>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Multiple + states</p>
          <div class="o2-demo__row">
            <O2File
              v-model="multipleFiles"
              label="Multiple files"
              :multiple="true"
              :counter="true"
              :clearable="true"
              data-test="demo-file-multiple"
            />
            <O2File
              v-model="singleFile"
              label="Error state"
              :error="true"
              error-message="Please select a file"
              data-test="demo-file-error"
            />
            <O2File
              v-model="singleFile"
              label="Disabled"
              :disable="true"
              data-test="demo-file-disabled"
            />
          </div>
        </div>
      </section>

      <!-- ══════════════════════════════════════════════════════════════════ -->
      <!-- O2Form                                                             -->
      <!-- ══════════════════════════════════════════════════════════════════ -->
      <section :id="sections[12].id" class="o2-demo__section">
        <div class="o2-demo__section-header">
          <h2 class="o2-demo__section-title">O2Form</h2>
          <span class="o2-demo__section-tag">replaces q-form</span>
        </div>

        <div class="o2-demo__group">
          <p class="o2-demo__group-label">Validation form</p>
          <O2Form ref="formRef" style="max-width: 24rem" data-test="demo-form">
            <div style="display: flex; flex-direction: column; gap: 0.5rem">
              <O2Input
                v-model="formData.name"
                label="Name *"
                :rules="nameRules"
                data-test="demo-form-name"
              />
              <O2Input
                v-model="formData.email"
                label="Email *"
                type="email"
                :rules="emailRules"
                data-test="demo-form-email"
              />
            </div>
            <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem">
              <O2Btn
                label="Validate"
                @click="validateForm"
                data-test="demo-form-validate-btn"
              />
              <O2Btn
                label="Reset"
                flat
                @click="resetForm"
                data-test="demo-form-reset-btn"
              />
            </div>
          </O2Form>
          <p
            v-if="formValid !== null"
            class="o2-demo__value-display"
            :style="{ color: formValid ? 'var(--o2-status-success-text, #38a169)' : 'var(--o2-status-error-text, #e53e3e)' }"
          >
            Form is {{ formValid ? "✓ valid" : "✗ invalid" }}
          </p>
        </div>
      </section>
    </main>
  </div>
</template>

<style lang="scss">
// Copyright 2026 OpenObserve Inc.
//
// O2 Demo Playground styles — global BEM under .o2-demo namespace.

.o2-demo {
  display: flex;
  min-height: 100vh;
  background: var(--o2-primary-background);
  color: var(--o2-text-primary);
  font-family: inherit;
  font-size: 0.8125rem;

  // ─── Sidebar ──────────────────────────────────────────────────────────────
  &__sidebar {
    position: fixed;
    top: 0;
    left: 0;
    width: 13rem;
    height: 100vh;
    background: var(--o2-secondary-background);
    border-right: 1px solid var(--o2-border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    z-index: 10;
  }

  &__sidebar-logo {
    padding: 1rem 1rem 0.75rem;
    border-bottom: 1px solid var(--o2-border);
    flex-shrink: 0;
  }

  &__sidebar-title {
    display: block;
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--o2-text-primary);
    line-height: 1.2;
  }

  &__sidebar-subtitle {
    display: block;
    font-size: 0.6875rem;
    color: var(--o2-text-muted);
    margin-top: 0.1875rem;
  }

  &__nav {
    padding: 0.5rem 0;
    flex: 1;
  }

  &__nav-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.375rem 1rem;
    font-size: 0.8125rem;
    font-family: inherit;
    color: var(--o2-text-secondary);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: color 0.1s, background 0.1s;
    border-left: 2px solid transparent;

    &:hover {
      color: var(--o2-text-primary);
      background: var(--o2-hover-gray);
    }

    &[data-active] {
      color: var(--o2-primary-color);
      border-left-color: var(--o2-primary-color);
      background: color-mix(in srgb, var(--o2-primary-color) 8%, transparent);
      font-weight: 500;
    }
  }

  // ─── Main ────────────────────────────────────────────────────────────────
  &__main {
    margin-left: 13rem;
    flex: 1;
    padding: 2rem 2.5rem;
    max-width: 60rem;
  }

  &__header {
    margin-bottom: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--o2-border);
  }

  &__heading {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--o2-text-primary);
    margin: 0 0 0.375rem;
  }

  &__sub {
    font-size: 0.8125rem;
    color: var(--o2-text-muted);
    line-height: 1.5;
    margin: 0;
    max-width: 44rem;
  }

  // ─── Sections ────────────────────────────────────────────────────────────
  &__section {
    margin-bottom: 3rem;
    scroll-margin-top: 1.5rem;
  }

  &__section-header {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--o2-border);
  }

  &__section-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--o2-text-primary);
    margin: 0;
  }

  &__section-tag {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--o2-text-muted);
    background: var(--o2-muted-background);
    border: 1px solid var(--o2-border);
    border-radius: 0.25rem;
    padding: 0.125rem 0.375rem;
    font-family: monospace;
  }

  // ─── Groups ───────────────────────────────────────────────────────────────
  &__group {
    margin-bottom: 1.5rem;
  }

  &__group-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--o2-text-muted);
    margin: 0 0 0.625rem;
  }

  &__row {
    display: flex;
    gap: 1rem;
    align-items: flex-start;

    &--wrap { flex-wrap: wrap; align-items: center; }
    &--center { align-items: center; }
    &--col { flex-direction: column; }

    > * { flex: 1; min-width: 0; }

    &--wrap > * { flex: none; }
    &--col > * { flex: none; }
  }

  &__inline-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  &__inline-label {
    font-size: 0.75rem;
    color: var(--o2-text-muted);
    min-width: 5rem;
    flex-shrink: 0;
  }

  &__value-display {
    font-size: 0.6875rem;
    color: var(--o2-text-muted);
    font-family: monospace;
    margin: 0.375rem 0 0;
    padding: 0.25rem 0.5rem;
    background: var(--o2-muted-background);
    border-radius: 0.1875rem;
    display: inline-block;
  }

  // ─── Raw input (inside O2Field demo) ─────────────────────────────────────
  &__raw-input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    color: var(--o2-text-primary);
    font-size: 0.8125rem;
    font-family: inherit;
    padding: 0;
    line-height: 1.5;
  }
}
</style>
