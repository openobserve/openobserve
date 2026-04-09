<template>
  <div class="oauth-popup-page">
    <div class="oauth-popup-content">
      <div class="oauth-icon error">✕</div>
      <h2>Authorization Failed</h2>
      <p v-if="reason">
        <strong>Reason:</strong> {{ reason }}
      </p>
      <p>You can close this window and try again from OpenObserve.</p>
      <p class="hint">This window will close automatically.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();

const reason = computed(() => {
  const r = route.query.reason as string | undefined;
  return r ? decodeURIComponent(r) : "";
});

onMounted(() => {
  setTimeout(() => {
    window.close();
  }, 4000);
});
</script>

<style scoped>
.oauth-popup-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  font-family: sans-serif;
  background: #f9fafb;
}

.oauth-popup-content {
  text-align: center;
  padding: 2rem;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  max-width: 360px;
  width: 100%;
}

.oauth-icon.error {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #ef4444;
  color: #fff;
  font-size: 1.75rem;
  font-weight: bold;
  margin-bottom: 1rem;
}

h2 {
  margin: 0 0 0.5rem;
  font-size: 1.25rem;
  color: #111827;
}

p {
  margin: 0 0 0.5rem;
  color: #6b7280;
  font-size: 0.9rem;
}

p strong {
  color: #374151;
}

.hint {
  color: #9ca3af;
  font-size: 0.8rem;
}
</style>
