<template>
  <div class="row q-mt-lg q-ml-xs">
    <div class="col-12">
      <div class="tags-title text-grey-8 text-bold q-mb-xs">Error Stack</div>
      <div class="q-mb-sm">{{ error_stack[0] }}</div>
      <div class="error-stacks">
        <template v-for="(stack, index) in error_stack" :key="stack">
          <div
            v-if="index"
            class="error_stack q-px-sm"
            :style="{
              'border-top': Number(index) === 1 ? '1px solid #e0e0e0' : '',
              'border-radius':
                Number(index) === error_stack.length - 1
                  ? '0 0 4px 4px'
                  : Number(index) === 1
                  ? '4px 4px 0 0'
                  : '',
            }"
          >
            {{ stack }}
          </div>
        </template>
      </div>
    </div>
    <!-- <div
      class="col-4"
      style="font-size: 12px; height: 300px; overflow-y: scroll"
    >
      <pre>
            {{ error }}
        </pre
      >
    </div> -->
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  error_stack: {
    type: Array,
    required: true,
  },
  error: {
    type: Object,
    required: true,
  },
});
</script>

<style lang="scss">
.tags-title {
  font-size: 16px;
}

.error_stack {
  border-bottom: 1px solid #e0e0e0;
  border-left: 1px solid #e0e0e0;
  border-right: 1px solid #e0e0e0;
  font-size: 13px;
  padding: 6px 8px;
}

.error_stacks:first-child .error_stack {
  border-top: 1px solid #e0e0e0;
}
</style>
