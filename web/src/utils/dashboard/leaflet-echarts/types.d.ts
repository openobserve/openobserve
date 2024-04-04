declare const name = "echarts-extension-leaflet";
declare const version = "1.0.0";

interface InnerLeafletComponentOption {
  /**
   * Whether echarts layer is interactive.
   * @default true
   * @since v1.0.0
   */
  echartsLayerInteractive?: Boolean;
  /**
   * Whether to enable large mode
   * @default false
   * @since v1.0.0
   */
  largeMode?: false;
  /**
   * Whether echarts layer should be rendered when the map is moving.
   * if `false`, it will only be re-rendered after the map `moveend`.
   * It's better to set this option to false if data is large.
   * @default true
   */
  renderOnMoving?: boolean;
}

/**
 * Extended Leaflet component option
 */
interface LeafletComponentOption<LeafletOption> {
  leaflet?: LeafletOption extends never
    ? InnerLeafletComponentOption
    : InnerLeafletComponentOption & LeafletOption;
}

export { name, version, LeafletComponentOption };
