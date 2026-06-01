<template>
  <aside class="eval-form-page__side">
    <section class="eval-preview-card">
      <h3>Preview</h3>
      <p>Use the fields on the left to define the production evaluation target.</p>
      <textarea
        rows="4"
        readonly
        value="6,854 matched spans
Match rate: 4.5%"
      />
    </section>
    <section class="eval-preview-card">
      <h3>Summary</h3>
      <dl>
        <dt>Name</dt><dd>{{ name || "—" }}</dd>
        <dt>Type</dt><dd>{{ streamType }}</dd>
        <dt>Status</dt><dd>{{ mode === "edit" ? "Editing" : "Draft" }}</dd>
      </dl>
    </section>
  </aside>
</template>

<script setup lang="ts">
defineProps<{
  name: string;
  streamType: string;
  mode: "create" | "edit";
}>();
</script>
