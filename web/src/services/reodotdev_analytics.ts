import { ref } from "vue";
import { loadReoScript } from "reodotdev";
import config from "../aws-exports";

interface IdentityPayload {
  username: string;
  type: "linkedin" | "github" | "email" | "google" | "others" | "sso";
  other_identities?: Array<{
    username: string;
    type: "linkedin" | "github" | "email" | "google" | "others" | "sso";
  }>;
  firstname?: string;
  lastname?: string;
  company?: string;
}

const isLoaded = ref(false);
let reoInstance: any = null;

const clientID = config.REO_CLIENT_KEY || "";
const source = "app";
const enableAnalytics = config.enableAnalytics == "true";

export function useReo() {
  const reoInit = async () => {
    if (!enableAnalytics) {
      console.info("Analytics disabled by config.");
      return;
    }

    try {
    const Reo = await loadReoScript({ clientID, source });
    Reo.init({ clientID });
    reoInstance = Reo;
    isLoaded.value = true;
  } catch (error) {
    console.error("Failed initializing Reo.Dev:", error);
  }
  };

  const identify = (identity: IdentityPayload) => {
    if (!enableAnalytics) {
      console.info("Analytics disabled. Skipping identify.");
      return;
    }

    if (!reoInstance) {
      console.warn("Reo not initialized yet. Call init() first.");
      return;
    }

    reoInstance.identify(identity);
  };

  return {
    reoInit,
    identify,
    isLoaded,
    reoInstance,
  };
}
