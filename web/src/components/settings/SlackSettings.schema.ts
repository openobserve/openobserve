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

import { z } from "zod";
import type { SlackAnswerMode, SlackMode } from "@/types/slack";
import { firstPublicDomain } from "@/utils/slackSettings";

type Translate = (key: string, params?: Record<string, unknown>) => string;

const trimmed = () => z.string().trim();

export const HELP_CONTACT_MAX_LENGTH = 256;

export const makeHelpContactSchema = () =>
  z.object({ help_contact: trimmed().max(HELP_CONTACT_MAX_LENGTH) });
export type HelpContactForm = z.infer<ReturnType<typeof makeHelpContactSchema>>;

const CONFIG_TOKEN_PREFIX = "xoxe-";
const APP_TOKEN_PREFIX = "xapp-";

// Slack's prefixes name a token's kind, so a token pasted into the wrong field is caught before Slack is called.
export const configTokenIssue = (t: Translate, value: string): string | null => {
  if (!value || value.startsWith(CONFIG_TOKEN_PREFIX)) return null;
  const key = value.startsWith("xoxe.")
    ? "slackApp.tokens.configAccessToken"
    : "slackApp.tokens.notConfigToken";
  return t(key, { prefix: CONFIG_TOKEN_PREFIX, page: "api.slack.com/apps" });
};

export const appTokenIssue = (t: Translate, value: string): string | null =>
  !value || value.startsWith(APP_TOKEN_PREFIX)
    ? null
    : t("slackApp.tokens.notAppToken", { prefix: APP_TOKEN_PREFIX });

type TokenFields = { config_refresh_token?: string; app_token?: string };

const checkTokenKinds = (t: Translate, v: TokenFields, ctx: z.RefinementCtx): void => {
  const issues: [keyof TokenFields, string | null][] = [
    ["config_refresh_token", configTokenIssue(t, v.config_refresh_token ?? "")],
    ["app_token", appTokenIssue(t, v.app_token ?? "")],
  ];
  for (const [path, message] of issues) {
    if (message) ctx.addIssue({ code: "custom", path: [path], message });
  }
};

// One form for Step 2: the configuration-token path, or Set up manually (which alone asks for app secrets).
export const makeCreateAppSchema = (t: Translate, isManual: () => boolean) =>
  z
    .object({
      mode: z.enum(["socket", "http"]),
      channel_history: z.boolean(),
      config_refresh_token: trimmed(),
      client_id: trimmed(),
      client_secret: trimmed(),
      signing_secret: trimmed(),
      app_token: trimmed(),
    })
    .superRefine((v, ctx) => {
      const require = (path: keyof typeof v, key: string) => {
        if (!String(v[path]).length)
          ctx.addIssue({ code: "custom", path: [path], message: t(key) });
      };
      if (!isManual()) {
        require("config_refresh_token", "slackApp.wizard.create.tokenRequired");
        checkTokenKinds(t, { config_refresh_token: v.config_refresh_token }, ctx);
        return;
      }
      if (v.mode === "socket") checkTokenKinds(t, { app_token: v.app_token }, ctx);
      require("client_id", "slackApp.wizard.create.clientIdRequired");
      require("client_secret", "slackApp.wizard.create.clientSecretRequired");
      // HTTP mode verifies Slack's requests with the signing secret.
      if (v.mode === "http")
        require("signing_secret", "slackApp.wizard.create.signingSecretRequired");
    });
export type CreateAppForm = {
  mode: SlackMode;
  channel_history: boolean;
  config_refresh_token: string;
  client_id: string;
  client_secret: string;
  signing_secret: string;
  app_token: string;
};
export const createAppDefaults = (): CreateAppForm => ({
  mode: "socket",
  channel_history: true,
  config_refresh_token: "",
  client_id: "",
  client_secret: "",
  signing_secret: "",
  app_token: "",
});

export const makeAppTokenSchema = (t: Translate) =>
  z
    .object({ app_token: trimmed().min(1, t("slackApp.wizard.install.appTokenRequired")) })
    .superRefine((v, ctx) => checkTokenKinds(t, v, ctx));
export type AppTokenForm = z.infer<ReturnType<typeof makeAppTokenSchema>>;

export const makeCredentialsSchema = (t: Translate, firstField: string) =>
  z
    .object({
      app_token: trimmed(),
      signing_secret: trimmed(),
      client_id: trimmed(),
      client_secret: trimmed(),
      config_refresh_token: trimmed(),
    })
    .refine((v) => Object.values(v).some((field) => field.length > 0), {
      path: [firstField],
      message: t("slackApp.credentials.atLeastOne"),
    })
    .superRefine((v, ctx) => checkTokenKinds(t, v, ctx));
export type CredentialsForm = z.infer<ReturnType<typeof makeCredentialsSchema>>;
export const credentialsDefaults = (): CredentialsForm => ({
  app_token: "",
  signing_secret: "",
  client_id: "",
  client_secret: "",
  config_refresh_token: "",
});

export const makeLinkingSchema = (t: Translate) =>
  z.object({ enabled: z.boolean(), domains: z.array(trimmed()) }).superRefine((v, ctx) => {
    const publicDomain = firstPublicDomain(v.domains);
    if (publicDomain) {
      ctx.addIssue({
        code: "custom",
        path: ["domains"],
        message: t("slackApp.linking.publicDomain", { domain: publicDomain }),
      });
    }
  });
export type LinkingForm = z.infer<ReturnType<typeof makeLinkingSchema>>;

export const makeChannelDefaultSchema = (t: Translate) =>
  z.object({
    channel_id: trimmed().min(1, t("slackApp.channels.channelRequired")),
    answer_mode: z.enum(["thread", "private"]),
  });
export type ChannelDefaultForm = {
  channel_id: string;
  answer_mode: SlackAnswerMode;
};
