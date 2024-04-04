import { use } from "echarts/core";
import { HeatmapSeriesOption } from "echarts/charts";

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I
) => void
  ? I
  : never;

type LastOf<T> = UnionToIntersection<
  T extends any ? () => T : never
> extends () => infer R
  ? R
  : never;

type Push<T extends any[], V> = [...T, V];

type TuplifyUnion<
  T,
  L = LastOf<T>,
  N = [T] extends [never] ? true : false
> = true extends N ? [] : Push<TuplifyUnion<Exclude<T, L>>, L>;

type EChartsExtensionInstallRegisters = Parameters<
  TuplifyUnion<Parameters<typeof use>[0]>[0]
>[0];

export type EChartsExtensionRegisters = EChartsExtensionInstallRegisters;

// HeatmapSeriesOption does not support 'lmap'
type LeafletHeatmapSeriesOption = HeatmapSeriesOption & {
  coordinateSystem: "lmap";
};

/**
 * To install Leaflet component
 * @param registers registers echarts registers.
 */
declare function install(registers: EChartsExtensionRegisters): void;

export * from "./types";
export { install as LeafletComponent, LeafletHeatmapSeriesOption };
