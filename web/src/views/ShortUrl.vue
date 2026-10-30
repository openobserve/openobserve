<template>
  <div data-test="loading-container" class="flex h-[100vh] flex-col items-center justify-center">
    <OSpinner size="lg" data-test="spinner" />
    <div data-test="message" class="text-text-secondary text-base">
      {{ t("common.shortUrl.redirecting") }}
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted } from "vue";
import { useRouter } from "vue-router";
import shortURL from "@/services/short_url";
import { useStore } from "vuex";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { useI18nTyped } from "@/types/i18n";

export default defineComponent({
  name: "ShortUrl",
  components: { OSpinner },
  props: {
    id: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const router = useRouter();
    const store = useStore();
    const { t } = useI18nTyped();

    const routeToHome = () => {
      router.replace({
        name: "home",
      });
    };

    const handleOriginalUrl = (url: string) => {
      const { pathname, search, hash } = new URL(url, window.location.origin);
      // Everything up to the first /web/ is the deployment's base path (ZO_BASE_URI), as in getPath().
      const webPos = `${pathname}/`.indexOf("/web/");
      routeToOriginalUrl((webPos > -1 ? pathname.slice(webPos + 4) : pathname) + search + hash);
    };

    const routeToOriginalUrl = (url: string) => {
      url.startsWith("/") ? router.replace(url) : router.replace("/" + url);
    };

    const fetchAndRedirect = async () => {
      try {
        const response = await shortURL.get(store.state.selectedOrganization.identifier, props.id);

        if (typeof response.data === "string") {
          handleOriginalUrl(response.data);
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

    // Execute when component is mounted
    onMounted(() => {
      fetchAndRedirect();
    });

    return {
      t,
      routeToHome,
      handleOriginalUrl,
      routeToOriginalUrl,
      fetchAndRedirect,
    };
  },
});
</script>
