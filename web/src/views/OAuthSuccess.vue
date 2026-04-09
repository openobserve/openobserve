<template>
  <div class="oauth-popup-page">
    <div class="oauth-popup-content">
      <div class="oauth-icon success">✓</div>
      <h2>Connected!</h2>
      <p>
        Authorization successful. You can close this window and return to
        OpenObserve.
      </p>
      <p class="hint">This window will close automatically.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";

onMounted(() => {
  // window.close() only works reliably when the window was opened via window.open()
  setTimeout(() => {
    window.close();
  }, 1500);
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

.oauth-icon.success {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #22c55e;
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

.hint {
  color: #9ca3af;
  font-size: 0.8rem;
}
</style>
