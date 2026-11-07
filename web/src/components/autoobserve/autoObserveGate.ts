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

/** The `/config` fields the AutoObserve preview reads. */
export interface AutoObserveConfig {
  experimental?: boolean;
  version?: string;
}

/** The one rule the nav entry and the route share: an experimental org on an enterprise build. */
export function isAutoObserveEnabled(
  isEnterprise: string,
  zoConfig: AutoObserveConfig | null | undefined,
): boolean {
  return isEnterprise === "true" && zoConfig?.experimental === true;
}

/** Longest a cold load waits for the org's full `/config` before the preview route gives up. */
export const CONFIG_WAIT_MS = 10_000;

/** Where the route guard reads the org's full `/config`, hears it arrive, or asks for it; the Vuex store and query cache in the app. */
export interface ConfigSource {
  read(): AutoObserveConfig | null | undefined;
  watch(callback: (config: AutoObserveConfig | null | undefined) => void): () => void;
  fetchFull(): Promise<AutoObserveConfig | null | undefined>;
}

/** Only the authenticated full config carries `version` and `experimental`; the login-time subset has neither. */
export function configLoaded(zoConfig: AutoObserveConfig | null | undefined): boolean {
  return typeof zoConfig?.version === "string" && zoConfig.version !== "";
}

/** Waits for the org's full `/config` on a cold load so the preview never paints for an org it is off for. */
export function autoObserveAllowed(
  isEnterprise: string,
  source: ConfigSource,
  waitMs: number = CONFIG_WAIT_MS,
): Promise<boolean> {
  const current = source.read();
  if (configLoaded(current)) return Promise.resolve(isAutoObserveEnabled(isEnterprise, current));
  return new Promise((resolve) => {
    let settled = false;
    let stop = () => {};
    const settle = (config: AutoObserveConfig | null | undefined) => {
      if (settled || !configLoaded(config)) return;
      settled = true;
      clearTimeout(timer);
      stop();
      resolve(isAutoObserveEnabled(isEnterprise, config));
    };
    const timer = setTimeout(() => {
      settled = true;
      stop();
      resolve(false);
    }, waitMs);
    stop = source.watch(settle);
    // The layout that loads the full config only mounts after this guard lets the route in.
    source.fetchFull().then(settle, () => {});
  });
}
