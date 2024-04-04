import { config } from "@vue/test-utils";
import { cloneDeep } from "lodash-es";
import { Quasar } from "quasar";
import { qLayoutInjections } from "./layout-injections";
import { beforeAll, afterAll } from "vitest";

export function installQuasar(options?: any) {
  const globalConfigBackup = cloneDeep(config.global);

  beforeAll(() => {
    config.global.plugins.unshift([Quasar, options]);
    config.global.provide = {
      ...config.global.provide,
      ...qLayoutInjections(),
    };
  });

  afterAll(() => {
    config.global = globalConfigBackup;
  });
}
