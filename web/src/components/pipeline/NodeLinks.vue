<template>
  <div>
    <div
      data-test="add-alert-stream-type-select"
      class="alert-stream-type o2-input q-mr-sm q-mb-sm"
      style="padding-top: 0"
    >
      <q-select
        v-model="selectedParentNode"
        :options="parentNodes"
        :label="t('pipeline.SelectParentNode') + ' *'"
        :popup-content-style="{ textTransform: 'lowercase' }"
        color="input-border"
        bg-color="input-bg"
        class="q-py-sm showLabelOnTop no-case"
        stack-label
        outlined
        filled
        dense
        @update:model-value="updateChildNodes()"
        :rules="[(val: any) => !!val || 'Field is required!']"
        style="min-width: 220px"
      />
    </div>

    <div
      data-test="add-alert-stream-type-select"
      class="alert-stream-type o2-input q-mr-sm"
      style="padding-top: 0"
    >
      <q-select
        v-model="selectedChildNode"
        :options="childNodes"
        :label="t('pipeline.SelectChildNode') + ' *'"
        :popup-content-style="{ textTransform: 'lowercase' }"
        color="input-border"
        bg-color="input-bg"
        class="q-py-sm showLabelOnTop no-case"
        stack-label
        outlined
        filled
        dense
        style="min-width: 220px"
        @update:model-value="updateNodeLinks()"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeMount, ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps({
  nodeLinks: {
    type: Array,
    required: true,
  },
});

const { t } = useI18n();

const emit = defineEmits(["update:link"]);

const parentNodes: Ref<string[]> = ref([]);

const childNodes: Ref<string[]> = ref([]);

const selectedParentNode = ref("");

const selectedChildNode = ref("");

onBeforeMount(() => {
  // Initialize parent nodes
  parentNodes.value = Object.keys(props.nodeLinks);
});

const updateChildNodes = () => {
  // Update child nodes on parent node selection
  childNodes.value =
    getAllPossibleDestinations(selectedParentNode.value, props.nodeLinks) || [];

  updateNodeLinks();
};

function getAllPossibleDestinations(nodeName: string, nodeLinks: any) {
  let visited = new Set(); // To keep track of visited nodes to avoid infinite loops
  let destinations: string[] = []; // To store all unique destinations

  function dfs(currentNode: string) {
    // Add the node to the visited set
    visited.add(currentNode);

    // Process each 'to' connection
    console.log(nodeLinks[currentNode]);
    if (nodeLinks[currentNode] && nodeLinks[currentNode]?.to) {
      nodeLinks[currentNode].to.forEach((node: string) => {
        if (!visited.has(node)) {
          destinations.push(node); // Add to destinations if not already visited
          dfs(node); // Recurse
        }
      });
    }
  }

  // Start DFS from the given node name
  dfs(nodeName);

  console.log(destinations);

  return destinations;
}

const updateNodeLinks = () => {
  emit("update:link", {
    from: selectedParentNode.value,
    to: selectedChildNode.value,
  });
};
</script>

<style lang="scss" scoped></style>
