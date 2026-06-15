<!-- Copyright 2026 OpenObserve Inc.

  ⚠️ THROWAWAY TEST-TARGET PAGE — NOT FOR MERGE.

  This page exists only as a deterministic, multi-mode UI surface for exercising
  the E2E Council test-generation pipeline (non-dry-run). Reachable at /test-demo.
  It has no backend dependency: every output is a pure function of the dropdown
  selections, so generated Playwright tests are stable and self-contained.

  Test surface (all interactive/asserted elements carry data-test ids):
    1. Fruit dropdown   -> single mapping to a description line.
    2. Country + City   -> cascading dropdowns (city options depend on country)
                           -> combined location sentence.
    3. Mode toggle      -> Basic | Advanced. "Advanced" reveals an extra Priority
                           dropdown and a conditional banner that only appears
                           when Fruit = Cherry AND Priority = High.
-->
<template>
  <div class="test-demo-page q-pa-lg" data-test="test-demo-page">
    <div class="q-mb-lg">
      <div class="text-h5" data-test="test-demo-title">TEST — Demo Page</div>
      <div class="text-caption text-grey" data-test="test-demo-subtitle">
        Throwaway multi-mode surface for E2E Council test generation. No backend —
        every output is derived purely from the selections below.
      </div>
    </div>

    <!-- ───────────── Section 1: single dropdown -> text ───────────── -->
    <q-card flat bordered class="q-pa-md q-mb-md" data-test="test-demo-fruit-card">
      <div class="text-subtitle1 q-mb-sm">1. Pick a fruit</div>
      <q-select
        v-model="fruit"
        :options="fruitOptions"
        label="Fruit"
        outlined
        dense
        emit-value
        map-options
        style="max-width: 320px"
        data-test="test-demo-fruit-select"
      />
      <div class="q-mt-md text-body1" data-test="test-demo-fruit-output">
        {{ fruitOutput }}
      </div>
    </q-card>

    <!-- ───────────── Section 2: cascading dropdowns -> text ───────────── -->
    <q-card flat bordered class="q-pa-md q-mb-md" data-test="test-demo-location-card">
      <div class="text-subtitle1 q-mb-sm">2. Pick a location</div>
      <div class="row q-col-gutter-md" style="max-width: 660px">
        <div class="col">
          <q-select
            v-model="country"
            :options="countryOptions"
            label="Country"
            outlined
            dense
            emit-value
            map-options
            data-test="test-demo-country-select"
            @update:model-value="onCountryChange"
          />
        </div>
        <div class="col">
          <q-select
            v-model="city"
            :options="cityOptions"
            label="City"
            outlined
            dense
            emit-value
            map-options
            :disable="!country"
            data-test="test-demo-city-select"
          />
        </div>
      </div>
      <div class="q-mt-md text-body1" data-test="test-demo-location-output">
        {{ locationOutput }}
      </div>
    </q-card>

    <!-- ───────────── Section 3: mode toggle + conditional banner ───────────── -->
    <q-card flat bordered class="q-pa-md" data-test="test-demo-mode-card">
      <div class="text-subtitle1 q-mb-sm">3. Mode</div>
      <q-btn-toggle
        v-model="mode"
        :options="modeOptions"
        toggle-color="primary"
        outline
        data-test="test-demo-mode-toggle"
      />

      <div class="q-mt-md text-body1" data-test="test-demo-mode-output">
        {{ modeOutput }}
      </div>

      <!-- Advanced-only controls -->
      <div v-if="mode === 'advanced'" class="q-mt-md" data-test="test-demo-advanced-panel">
        <q-select
          v-model="priority"
          :options="priorityOptions"
          label="Priority"
          outlined
          dense
          emit-value
          map-options
          style="max-width: 320px"
          data-test="test-demo-priority-select"
        />
        <div class="q-mt-sm text-body1" data-test="test-demo-priority-output">
          {{ priorityOutput }}
        </div>

        <!-- Combined rule: Fruit=Cherry AND Priority=High -->
        <q-banner
          v-if="showCriticalBanner"
          class="bg-red-1 text-red-9 q-mt-md"
          rounded
          dense
          data-test="test-demo-combined-banner"
        >
          <template #avatar>
            <q-icon name="warning" color="red" />
          </template>
          Critical cherry alert — Cherry selected at High priority.
        </q-banner>
      </div>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";

// ───────────── Section 1: fruit ─────────────
const fruit = ref<string>("");
const fruitOptions = [
  { label: "Apple", value: "apple" },
  { label: "Banana", value: "banana" },
  { label: "Cherry", value: "cherry" },
];
const fruitDescriptions: Record<string, string> = {
  apple: "Apple — a crisp red pome. (You selected option A.)",
  banana: "Banana — a soft yellow berry. (You selected option B.)",
  cherry: "Cherry — a small red stone fruit. (You selected option C.)",
};
const fruitOutput = computed(() =>
  fruit.value ? fruitDescriptions[fruit.value] : "No fruit selected yet.",
);

// ───────────── Section 2: cascading country -> city ─────────────
const country = ref<string>("");
const city = ref<string>("");
const countryOptions = [
  { label: "India", value: "india" },
  { label: "United States", value: "usa" },
  { label: "Japan", value: "japan" },
];
const citiesByCountry: Record<string, { label: string; value: string }[]> = {
  india: [
    { label: "Bengaluru", value: "bengaluru" },
    { label: "Mumbai", value: "mumbai" },
  ],
  usa: [
    { label: "San Francisco", value: "sf" },
    { label: "New York", value: "ny" },
  ],
  japan: [
    { label: "Tokyo", value: "tokyo" },
    { label: "Osaka", value: "osaka" },
  ],
};
const cityOptions = computed(() =>
  country.value ? citiesByCountry[country.value] : [],
);
const onCountryChange = () => {
  // reset the dependent city whenever the country changes
  city.value = "";
};
const labelOf = (
  opts: { label: string; value: string }[],
  value: string,
): string => opts.find((o) => o.value === value)?.label ?? "";
const locationOutput = computed(() => {
  if (!country.value) return "Pick a country to begin.";
  if (!city.value) return `Country: ${labelOf(countryOptions, country.value)}. Now pick a city.`;
  return `You selected ${labelOf(cityOptions.value, city.value)}, ${labelOf(
    countryOptions,
    country.value,
  )}.`;
});

// ───────────── Section 3: mode + priority + combined rule ─────────────
const mode = ref<string>("basic");
const modeOptions = [
  { label: "Basic", value: "basic" },
  { label: "Advanced", value: "advanced" },
];
const modeOutput = computed(() =>
  mode.value === "advanced"
    ? "Advanced mode — extra controls are visible below."
    : "Basic mode — minimal controls. Switch to Advanced for more.",
);

const priority = ref<string>("");
const priorityOptions = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];
const priorityOutput = computed(() => {
  if (!priority.value) return "No priority selected.";
  return `Priority set to ${labelOf(priorityOptions, priority.value)}.`;
});

const showCriticalBanner = computed(
  () => mode.value === "advanced" && fruit.value === "cherry" && priority.value === "high",
);
</script>

<style scoped lang="scss">
.test-demo-page {
  max-width: 900px;
}
</style>
