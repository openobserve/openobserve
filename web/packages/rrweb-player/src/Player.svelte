<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Replayer, unpack } from 'rrweb';
  import type { eventWithTime } from '@rrweb/types';
  import {
    inlineCss,
    openFullscreen,
    exitFullscreen,
    isFullscreen,
    onFullscreenChange,
    typeOf,
  } from './utils';
  import Controller from './Controller.svelte';

  export let width = 1024;
  export let height = 576;
  export let maxScale = 1;
  export let events: eventWithTime[] = [];
  export let skipInactive = true;
  export let autoPlay = true;
  export let speedOption: number[] = [1, 2, 4, 8];
  export let speed = 1;
  export let showController = true;
  export let tags: Record<string, string> = {};
  // color of inactive periods indicator
  export let inactiveColor = '#D4D4D4';

  let replayer: Replayer;

  export const getMirror = () => replayer.getMirror();

  const controllerHeight = 80;
  let player: HTMLElement;
  let frame: HTMLElement;
  let fullscreenListener: undefined | (() => void);
  let _width: number = width;
  let _height: number = height;
  let controller: {
    toggle: () => void;
    setSpeed: (speed: number) => void;
    toggleSkipInactive: () => void;
  } & Controller;

  let style: string;
  $: style = inlineCss({
    width: `${width}px`,
    height: `${height}px`,
  });
  let playerStyle: string;
  $: playerStyle = inlineCss({
    width: `${width}px`,
    height: `${height + (showController ? controllerHeight : 0)}px`,
  });

  const updateScale = (
    el: HTMLElement,
    frameDimension: { width: number; height: number },
  ) => {
    const widthScale = width / frameDimension.width;
    const heightScale = height / frameDimension.height;
    const scale = [widthScale, heightScale];
    if (maxScale) scale.push(maxScale);
    el.style.transform =
      `scale(${Math.min(...scale)})` + 'translate(-50%, -50%)';
  };

  export const triggerResize = () => {
    updateScale(replayer.wrapper, {
      width: replayer.iframe.offsetWidth,
      height: replayer.iframe.offsetHeight,
    });
  };

  export const toggleFullscreen = () => {
    if (player) {
      isFullscreen() ? exitFullscreen() : openFullscreen(player);
    }
  };

  export const addEventListener = (
    event: string,
    handler: (detail: unknown) => unknown,
  ) => {
    replayer.on(event, handler);
    switch (event) {
      case 'ui-update-current-time':
      case 'ui-update-progress':
      case 'ui-update-player-state':
        controller.$on(event, ({ detail }) => handler(detail));
      default:
        break;
    }
  };

  export const addEvent = (event: eventWithTime) => {
    replayer.addEvent(event);
    controller.triggerUpdateMeta();
  };
  export const getMetaData = () => replayer.getMetaData();
  export const getReplayer = () => replayer;

  // by pass controller methods as public API
  export const toggle = () => {
    controller.toggle();
  };
  export const setSpeed = (speed: number) => {
    controller.setSpeed(speed);
  };
  export const toggleSkipInactive = () => {
    controller.toggleSkipInactive();
  };
  export const play = () => {
    controller.play();
  };
  export const pause = () => {
    controller.pause();
  };
  export const goto = (timeOffset: number, play?: boolean) => {
    controller.goto(timeOffset, play);
  };
  export const playRange = (
    timeOffset: number,
    endTimeOffset: number,
    startLooping = false,
    afterHook: undefined | (() => void) = undefined,
  ) => {
    controller.playRange(timeOffset, endTimeOffset, startLooping, afterHook);
  };

  onMount(() => {
    // runtime type check
    if (speedOption !== undefined && typeOf(speedOption) !== 'array') {
      throw new Error('speedOption must be array');
    }
    speedOption.forEach((item) => {
      if (typeOf(item) !== 'number') {
        throw new Error('item of speedOption must be number');
      }
    });
    if (speedOption.indexOf(speed) < 0) {
      throw new Error(`speed must be one of speedOption,
        current config:
        {
          ...
          speed: ${speed},
          speedOption: [${speedOption.toString()}]
          ...
        }
        `);
    }

    replayer = new Replayer(events, {
      speed,
      root: frame,
      unpackFn: unpack,
      ...$$props,
    });

    replayer.on('resize', (dimension) => {
      updateScale(
        replayer.wrapper,
        dimension as { width: number; height: number },
      );
    });

    fullscreenListener = onFullscreenChange(() => {
      if (isFullscreen()) {
        setTimeout(() => {
          _width = width;
          _height = height;
          width = player.offsetWidth;
          height =
            player.offsetHeight - (showController ? controllerHeight : 0);
          updateScale(replayer.wrapper, {
            width: replayer.iframe.offsetWidth,
            height: replayer.iframe.offsetHeight,
          });
        }, 0);
      } else {
        width = _width;
        height = _height;
        updateScale(replayer.wrapper, {
          width: replayer.iframe.offsetWidth,
          height: replayer.iframe.offsetHeight,
        });
      }
    });
  });

  onDestroy(() => {
    fullscreenListener && fullscreenListener();
  });
</script>

<style global>
  @import 'rrweb/dist/rrweb.min.css';

  .rr-player {
    position: relative;
    background: white;
    float: left;
    border-radius: 5px;
    box-shadow: 0 24px 48px rgba(17, 16, 62, 0.12);
  }

  .rr-player__frame {
    overflow: hidden;
  }

  .replayer-wrapper {
    float: left;
    clear: both;
    transform-origin: top left;
    left: 50%;
    top: 50%;
  }

  .replayer-wrapper > iframe {
    border: none;
  }
</style>

<div class="rr-player" bind:this={player} style={playerStyle}>
  <div class="rr-player__frame" bind:this={frame} {style} />
  {#if replayer}
    <Controller
      bind:this={controller}
      {replayer}
      {showController}
      {autoPlay}
      {speedOption}
      {skipInactive}
      {tags}
      {inactiveColor}
      on:fullscreen={() => toggleFullscreen()}
    />
  {/if}
</div>
