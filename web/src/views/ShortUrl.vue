<template>
  <div class="loading-container">
    <div class="spinner"></div>
    <div class="message">Redirecting...</div>
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import shortURL from "@/services/short_url";
import { useStore } from "vuex";

export default defineComponent({
  name: "ShortUrl",
  setup() {
    const route = useRoute();
    const router = useRouter();
    const store = useStore();

    const fetchAndRedirect = async () => {
      try {
        const id = route.params.id as string;
        const response = await shortURL.get(
          store.state.selectedOrganization.identifier,
          id,
        );

        if (typeof response.data === "string") {
          const url = response.data.split("/");
          if (url.includes("web")) {
            url[4].startsWith("/")
              ? router.replace(url[4])
              : router.replace("/" + url[4]);
          } else {
            url[3].startsWith("/")
              ? router.replace(url[3])
              : router.replace("/" + url[3]);
          }
        } else {
          // Handle case where redirect URL is not found
          routeToHome();
        }
      } catch (error) {
        console.error("Error fetching short URL:", error);
        // Redirect to home page on error
        routeToHome();
      }
    };

    const routeToHome = () => {
      router.replace({
        name: "home",
      });
    };

    // Execute when component is mounted
    onMounted(() => {
      fetchAndRedirect();
    });
  },
});
</script>

<style scoped>
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
}

.spinner {
  border: 4px solid rgba(0, 0, 0, 0.1);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border-left-color: #09f;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

.message {
  font-size: 16px;
  color: #666;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
