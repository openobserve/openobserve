<script lang="ts">
  import { EventType } from 'rrweb';
  import type { Replayer } from 'rrweb';
  import type { playerMetaData } from '@rrweb/types';
  import type {
    PlayerMachineState,
    SpeedMachineState,
  } from 'rrweb/typings/replay/machine';
  import {
    onMount,
    onDestroy,
    createEventDispatcher,
    afterUpdate,
  } from 'svelte';
  import { formatTime, getInactivePeriods } from './utils';
  import Switch from './components/Switch.svelte';

  const dispatch = createEventDispatcher();

  export let replayer: Replayer;
  export let showController: boolean;
  export let autoPlay: boolean;
  export let skipInactive: boolean;
  export let speedOption: number[];
  export let speed = speedOption.length ? speedOption[0] : 1;
  export let tags: Record<string, string> = {};
  export let inactiveColor: string;

  let currentTime = 0;
  $: {
    dispatch('ui-update-current-time', { payload: currentTime });
  }
  let timer: number | null = null;
  let playerState: 'playing' | 'paused' | 'live';
  $: {
    dispatch('ui-update-player-state', { payload: playerState });
  }
  let speedState: 'normal' | 'skipping';
  let progress: HTMLElement;
  let step: HTMLElement;
  let finished: boolean;

  let pauseAt: number | false = false;
  let onPauseHook: () => unknown | undefined = undefined;
  let loop: {
    start: number;
    end: number;
  } | null = null;

  let meta: playerMetaData;
  $: meta = replayer.getMetaData();
  let percentage: string;
  $: {
    const percent = Math.min(1, currentTime / meta.totalTime);
    percentage = `${100 * percent}%`;
    dispatch('ui-update-progress', { payload: percent });
  }
  type CustomEvent = {
    name: string;
    background: string;
    position: string;
  };

  /**
   * Calculate the tag position (percent) to be displayed on the progress bar.
   * @param startTime - The start time of the session.
   * @param endTime - The end time of the session.
   * @param tagTime - The time of the tag.
   * @returns The position of the tag. unit: percentage
   */
  function position(startTime: number, endTime: number, tagTime: number) {
    const sessionDuration = endTime - startTime;
    const eventDuration = endTime - tagTime;
    const eventPosition = 100 - (eventDuration / sessionDuration) * 100;
    return eventPosition.toFixed(2);
  }

  let customEvents: CustomEvent[];
  $: customEvents = (() => {
    const { context } = replayer.service.state;
    const totalEvents = context.events.length;
    const start = context.events[0].timestamp;
    const end = context.events[totalEvents - 1].timestamp;
    const customEvents: CustomEvent[] = [];

    // loop through all the events and find out custom event.
    context.events.forEach((event) => {
      /**
       * we are only interested in custom event and calculate it's position
       * to place it in player's timeline.
       */
      if (event.type === EventType.Custom) {
        const customEvent = {
          name: event.data.tag,
          background: tags[event.data.tag] || 'rgb(73, 80, 246)',
          position: `${position(start, end, event.timestamp)}%`,
        };
        customEvents.push(customEvent);
      }
    });

    return customEvents;
  })();

  let inactivePeriods: {
    name: string;
    background: string;
    position: string;
    width: string;
  }[];
  $: inactivePeriods = (() => {
    try {
      const { context } = replayer.service.state;
      const totalEvents = context.events.length;
      const start = context.events[0].timestamp;
      const end = context.events[totalEvents - 1].timestamp;
      const periods = getInactivePeriods(context.events);
      // calculate the indicator width.
      const getWidth = (
        startTime: number,
        endTime: number,
        tagStart: number,
        tagEnd: number,
      ) => {
        const sessionDuration = endTime - startTime;
        const eventDuration = tagEnd - tagStart;
        const width = (eventDuration / sessionDuration) * 100;
        return width.toFixed(2);
      };
      return periods.map((period) => ({
        name: 'inactive period',
        background: inactiveColor,
        position: `${position(start, end, period[0])}%`,
        width: `${getWidth(start, end, period[0], period[1])}%`,
      }));
    } catch (e) {
      // For safety concern, if there is any error, the main function won't be affected.
      return [];
    }
  })();

  const loopTimer = () => {
    stopTimer();

    function update() {
      currentTime = replayer.getCurrentTime();

      if (pauseAt && currentTime >= pauseAt) {
        if (loop) {
          playRange(loop.start, loop.end, true, undefined);
        } else {
          replayer.pause();
          if (onPauseHook) {
            onPauseHook();
            onPauseHook = null;
          }
        }
      }

      if (currentTime < meta.totalTime) {
        timer = requestAnimationFrame(update);
      }
    }

    timer = requestAnimationFrame(update);
  };

  const stopTimer = () => {
    if (timer) {
      cancelAnimationFrame(timer);
      timer = null;
    }
  };

  export const toggle = () => {
    switch (playerState) {
      case 'playing':
        pause();
        break;
      case 'paused':
        play();
        break;
      default:
        break;
    }
  };

  export const play = () => {
    if (playerState !== 'paused') {
      return;
    }
    if (finished) {
      replayer.play();
      finished = false;
    } else {
      replayer.play(currentTime);
    }
  };

  export const pause = () => {
    if (playerState !== 'playing') {
      return;
    }
    replayer.pause();
    pauseAt = false;
  };

  export const goto = (timeOffset: number, play?: boolean) => {
    currentTime = timeOffset;
    pauseAt = false;
    finished = false;
    const resumePlaying =
      typeof play === 'boolean' ? play : playerState === 'playing';
    if (resumePlaying) {
      replayer.play(timeOffset);
    } else {
      replayer.pause(timeOffset);
    }
  };

  export const playRange = (
    timeOffset: number,
    endTimeOffset: number,
    startLooping = false,
    afterHook: undefined | (() => void) = undefined,
  ) => {
    if (startLooping) {
      loop = {
        start: timeOffset,
        end: endTimeOffset,
      };
    } else {
      loop = null;
    }
    currentTime = timeOffset;
    pauseAt = endTimeOffset;
    onPauseHook = afterHook;
    replayer.play(timeOffset);
  };

  const handleProgressClick = (event: MouseEvent) => {
    if (speedState === 'skipping') {
      return;
    }
    const progressRect = progress.getBoundingClientRect();
    const x = event.clientX - progressRect.left;
    let percent = x / progressRect.width;
    if (percent < 0) {
      percent = 0;
    } else if (percent > 1) {
      percent = 1;
    }
    const timeOffset = meta.totalTime * percent;
    goto(timeOffset);
  };

  export const setSpeed = (newSpeed: number) => {
    let needFreeze = playerState === 'playing';
    speed = newSpeed;
    if (needFreeze) {
      replayer.pause();
    }
    replayer.setConfig({ speed });
    if (needFreeze) {
      replayer.play(currentTime);
    }
  };

  export const toggleSkipInactive = () => {
    skipInactive = !skipInactive;
  };

  export const triggerUpdateMeta = () => {
    return Promise.resolve().then(() => {
      meta = replayer.getMetaData();
    });
  };

  onMount(() => {
    playerState = replayer.service.state.value;
    speedState = replayer.speedService.state.value;
    replayer.on(
      'state-change',
      (states: { player?: PlayerMachineState; speed?: SpeedMachineState }) => {
        const { player, speed } = states;
        if (player?.value && playerState !== player.value) {
          playerState = player.value;
          switch (playerState) {
            case 'playing':
              loopTimer();
              break;
            case 'paused':
              stopTimer();
              break;
            default:
              break;
          }
        }
        if (speed?.value && speedState !== speed.value) {
          speedState = speed.value;
        }
      },
    );
    replayer.on('finish', () => {
      finished = true;
      if (onPauseHook) {
        onPauseHook();
        onPauseHook = null;
      }
    });

    if (autoPlay) {
      replayer.play();
    }
  });

  afterUpdate(() => {
    if (skipInactive !== replayer.config.skipInactive) {
      replayer.setConfig({ skipInactive });
    }
  });

  onDestroy(() => {
    replayer.pause();
    stopTimer();
  });
</script>

<style>
  .rr-controller {
    width: 100%;
    height: 80px;
    background: #fff;
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    align-items: center;
    border-radius: 0 0 5px 5px;
  }

  .rr-timeline {
    width: 80%;
    display: flex;
    align-items: center;
  }

  .rr-timeline__time {
    display: inline-block;
    width: 100px;
    text-align: center;
    color: #11103e;
  }

  .rr-progress {
    flex: 1;
    height: 12px;
    background: #eee;
    position: relative;
    border-radius: 3px;
    cursor: pointer;
    box-sizing: border-box;
    border-top: solid 4px #fff;
    border-bottom: solid 4px #fff;
  }

  .rr-progress.disabled {
    cursor: not-allowed;
  }

  .rr-progress__step {
    height: 100%;
    position: absolute;
    left: 0;
    top: 0;
    background: #e0e1fe;
  }

  .rr-progress__handler {
    width: 20px;
    height: 20px;
    border-radius: 10px;
    position: absolute;
    top: 2px;
    transform: translate(-50%, -50%);
    background: rgb(73, 80, 246);
  }

  .rr-controller__btns {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
  }

  .rr-controller__btns button {
    width: 32px;
    height: 32px;
    display: flex;
    padding: 0;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .rr-controller__btns button:active {
    background: #e0e1fe;
  }

  .rr-controller__btns button.active {
    color: #fff;
    background: rgb(73, 80, 246);
  }

  .rr-controller__btns button:disabled {
    cursor: not-allowed;
  }
</style>

{#if showController}
  <div class="rr-controller">
    <div class="rr-timeline">
      <span class="rr-timeline__time">{formatTime(currentTime)}</span>
      <div
        class="rr-progress"
        class:disabled={speedState === 'skipping'}
        bind:this={progress}
        on:click={handleProgressClick}
      >
        <div
          class="rr-progress__step"
          bind:this={step}
          style="width: {percentage}"
        />
        {#each inactivePeriods as period}
          <div
            title={period.name}
            style="width: {period.width};height: 4px;position: absolute;background: {period.background};left:
            {period.position};"
          />
        {/each}
        {#each customEvents as event}
          <div
            title={event.name}
            style="width: 10px;height: 5px;position: absolute;top:
            2px;transform: translate(-50%, -50%);background: {event.background};left:
            {event.position};"
          />
        {/each}

        <div class="rr-progress__handler" style="left: {percentage}" />
      </div>
      <span class="rr-timeline__time">{formatTime(meta.totalTime)}</span>
    </div>
    <div class="rr-controller__btns">
      <button on:click={toggle}>
        {#if playerState === 'playing'}
          <svg
            class="icon"
            viewBox="0 0 1024 1024"
            version="1.1"
            xmlns="http://www.w3.org/2000/svg"
            xmlns:xlink="http://www.w3.org/1999/xlink"
            width="16"
            height="16"
          >
            <path
              d="M682.65984 128q53.00224 0 90.50112 37.49888t37.49888 90.50112l0
              512q0 53.00224-37.49888 90.50112t-90.50112
              37.49888-90.50112-37.49888-37.49888-90.50112l0-512q0-53.00224
              37.49888-90.50112t90.50112-37.49888zM341.34016 128q53.00224 0
              90.50112 37.49888t37.49888 90.50112l0 512q0 53.00224-37.49888
              90.50112t-90.50112
              37.49888-90.50112-37.49888-37.49888-90.50112l0-512q0-53.00224
              37.49888-90.50112t90.50112-37.49888zM341.34016 213.34016q-17.67424
              0-30.16704 12.4928t-12.4928 30.16704l0 512q0 17.67424 12.4928
              30.16704t30.16704 12.4928 30.16704-12.4928
              12.4928-30.16704l0-512q0-17.67424-12.4928-30.16704t-30.16704-12.4928zM682.65984
              213.34016q-17.67424 0-30.16704 12.4928t-12.4928 30.16704l0 512q0
              17.67424 12.4928 30.16704t30.16704 12.4928 30.16704-12.4928
              12.4928-30.16704l0-512q0-17.67424-12.4928-30.16704t-30.16704-12.4928z"
            />
          </svg>
        {:else}
          <svg
            class="icon"
            viewBox="0 0 1024 1024"
            version="1.1"
            xmlns="http://www.w3.org/2000/svg"
            xmlns:xlink="http://www.w3.org/1999/xlink"
            width="16"
            height="16"
          >
            <path
              d="M170.65984 896l0-768 640 384zM644.66944
              512l-388.66944-233.32864 0 466.65728z"
            />
          </svg>
        {/if}
      </button>
      {#each speedOption as s}
        <button
          class:active={s === speed && speedState !== 'skipping'}
          on:click={() => setSpeed(s)}
          disabled={speedState === 'skipping'}
        >
          {s}x
        </button>
      {/each}
      <Switch
        id="skip"
        bind:checked={skipInactive}
        disabled={speedState === 'skipping'}
        label="skip inactive"
      />
      <button on:click={() => dispatch('fullscreen')}>
        <svg
          class="icon"
          viewBox="0 0 1024 1024"
          version="1.1"
          xmlns="http://www.w3.org/2000/svg"
          xmlns:xlink="http://www.w3.org/1999/xlink"
          width="16"
          height="16"
        >
          <defs>
            <style type="text/css">
            </style>
          </defs>
          <path
            d="M916 380c-26.4 0-48-21.6-48-48L868 223.2 613.6 477.6c-18.4
            18.4-48.8 18.4-68 0-18.4-18.4-18.4-48.8 0-68L800 156 692 156c-26.4
            0-48-21.6-48-48 0-26.4 21.6-48 48-48l224 0c26.4 0 48 21.6 48 48l0
            224C964 358.4 942.4 380 916 380zM231.2 860l108.8 0c26.4 0 48 21.6 48
            48s-21.6 48-48 48l-224 0c-26.4 0-48-21.6-48-48l0-224c0-26.4 21.6-48
            48-48 26.4 0 48 21.6 48 48L164 792l253.6-253.6c18.4-18.4 48.8-18.4
            68 0 18.4 18.4 18.4 48.8 0 68L231.2 860z"
            p-id="1286"
          />
        </svg>
      </button>
    </div>
  </div>
{/if}
