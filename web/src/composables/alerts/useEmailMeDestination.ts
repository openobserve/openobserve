// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed, ref, watch } from "vue";
import { useStore } from "vuex";

import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { ToastOptions } from "@/lib/feedback/Toast/OToast.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { queryClient } from "@/composables/query/queryClient";
import destinationService from "@/services/alert_destination";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { destinationKeys } from "@/services/alert_destination.querykeys";
import { settingQuery } from "@/services/settings.queries";
import { preselectDestination, type PreselectInput } from "@/utils/alerts/preselectDestination";

/** Org setting naming the destination new alerts start with; value `{ destination: <name> }`. */
export const ORG_DEFAULT_DESTINATION_KEY = "default_alert_destination";
export const ORG_DEFAULT_DESTINATION_CATEGORY = "alerts";

// The server seeds this template the first time an email destination names it.
const EMAIL_ME_TEMPLATE = "prebuilt_email";

export interface EmailMeDeps {
  /** The form's selected destination names; read reactively. */
  destinations: () => string[];
  setDestinations: (names: string[]) => void;
  /** The recovery list offers the same planned option, so a resolved name replaces it there too. */
  recoveryDestinations: () => string[];
  setRecoveryDestinations: (names: string[]) => void;
  /** A destination was created, so the form's list must reload. */
  onCreated: () => void;
}

/** The default destination's name from the setting value; anything malformed reads as unset. */
export const orgDefaultDestinationOf = (value: unknown): string | null => {
  const name = (value as { destination?: unknown } | null)?.destination;
  return typeof name === "string" && name.trim() ? name.trim() : null;
};

const serverMessage = (error: any): string | undefined =>
  error?.response?.data?.message ?? error?.response?.data?.error;

/** Pre-selects who a new alert notifies, and turns "Email me" into a real destination on save or first test. */
export function useEmailMeDestination(deps: EmailMeDeps) {
  const store = useStore();
  const { t } = useI18nTyped();
  const org = (): string => store.state.selectedOrganization.identifier;
  // Recipients are stored lowercased (destinations.rs save), so names and matches use the same form.
  const address = computed(() =>
    String(store.state.userInfo?.email ?? "")
      .trim()
      .toLowerCase(),
  );

  // Planned until resolved: the destination does not exist yet, only its name is selected.
  const pending = ref<string | null>(null);
  const resolved = ref<{ name: string; template: string } | null>(null);
  const error = ref("");
  let inflight: Promise<string[] | null> | null = null;

  watch(deps.destinations, () => {
    error.value = "";
  });

  // Labelled as the user's address until the form's reloaded list carries the real row.
  const option = computed(() => {
    const name = pending.value ?? resolved.value?.name;
    if (!name) return null;
    return {
      label: t("alerts.alertSettings.emailMeOption", { address: address.value }),
      value: name,
    };
  });

  const preselect = async (alert: () => PreselectInput["alert"]) => {
    let orgDestinations: string[];
    let defaultDestination: string | null;
    try {
      const [list, setting] = await Promise.all([
        queryClient.fetchQuery(destinationsQuery(org(), "alert")),
        queryClient.fetchQuery(settingQuery(org(), ORG_DEFAULT_DESTINATION_KEY)).catch(() => null),
      ]);
      orgDestinations = list.map((destination: any) => destination.name);
      defaultDestination = orgDefaultDestinationOf(setting);
    } catch {
      // Without the org's list a first alert cannot be told from a team one, so add nothing.
      return;
    }
    // The user picked something while the lists loaded.
    if (deps.destinations().length > 0) return;
    const choice = preselectDestination({
      isNew: true,
      alert: alert(),
      orgDestinations,
      defaultDestination,
      smtpEnabled: store.state.zoConfig?.smtp_enabled,
      userEmail: address.value,
    });
    if (choice.kind === "orgDefault") deps.setDestinations([choice.destination]);
    if (choice.kind === "emailMe") {
      pending.value = `email-${address.value}`;
      deps.setDestinations([pending.value]);
    }
  };

  const findOrCreate = async (planned: string) => {
    const options = destinationsQuery(org(), "alert");
    await queryClient.invalidateQueries({
      queryKey: options.queryKey,
      exact: true,
      refetchType: "none",
    });
    const mine = (await queryClient.fetchQuery(options)).find(
      (destination: any) =>
        destination.type === "email" &&
        destination.emails?.length === 1 &&
        String(destination.emails[0]).trim().toLowerCase() === address.value,
    );
    if (mine) return { name: mine.name as string, template: mine.template || EMAIL_ME_TEMPLATE };
    await destinationService.create({
      org_identifier: org(),
      data: { name: planned, type: "email", emails: [address.value], template: EMAIL_ME_TEMPLATE },
      options: { skipAccessToast: true },
    });
    await queryClient.invalidateQueries({
      queryKey: destinationKeys.all(org()),
      refetchType: "none",
    });
    deps.onCreated();
    return { name: planned, template: EMAIL_ME_TEMPLATE };
  };

  const resolveNow = async (names: string[], planned: string) => {
    error.value = "";
    try {
      const destination = await findOrCreate(planned);
      pending.value = null;
      resolved.value = destination;
      const swap = (list: string[]) =>
        list.map((name) => (name === planned ? destination.name : name));
      const next = swap(names);
      deps.setDestinations(next);
      const recovery = deps.recoveryDestinations();
      if (recovery.includes(planned)) deps.setRecoveryDestinations(swap(recovery));
      return next;
    } catch (e: any) {
      error.value =
        e?.response?.status === 403
          ? t("alerts.alertSettings.emailMeForbidden")
          : raw(serverMessage(e)) ||
            t("alerts.alertSettings.emailMeFailed", { address: address.value });
      return null;
    }
  };

  /** The names with a planned Email me swapped for a real destination; null when that failed. */
  const resolve = async (names: string[], withRecovery = false): Promise<string[] | null> => {
    const planned = pending.value;
    const picked =
      names.includes(planned ?? "") ||
      (withRecovery && deps.recoveryDestinations().includes(planned ?? ""));
    if (!planned || !picked) return names;
    // A Send test and a save racing must not create the destination twice.
    inflight ??= resolveNow(names, planned).finally(() => {
      inflight = null;
    });
    return inflight;
  };

  const sendTest = async (name: string, template: string) => {
    try {
      await destinationService.testSend({
        org_identifier: org(),
        destination_name: name,
        data: { template_name: template },
        options: { skipAccessToast: true },
      });
      toast({ variant: "success", message: t("alert_templates.testSendSuccess") });
    } catch (e: any) {
      const message: I18nText =
        e?.response?.status === 429
          ? t("alert_templates.testSendRateLimited")
          : raw(serverMessage(e)) || t("alerts.alertSettings.sendTestFailed");
      toast({ variant: "error", message });
    }
  };

  /** The create toast when any of the saved alert's names (firing or recovery) emails the user; null otherwise. */
  const savedToast = (names: string[], alertTemplate?: string): ToastOptions | null => {
    const destination = resolved.value;
    if (!destination || !names.includes(destination.name)) return null;
    return {
      variant: "success",
      message: t("alerts.messages.alertSavedEmailMe", { address: address.value }),
      action: {
        label: t("alert_templates.testSend"),
        handler: () => void sendTest(destination.name, alertTemplate || destination.template),
      },
    };
  };

  return { error, option, preselect, resolve, savedToast };
}
