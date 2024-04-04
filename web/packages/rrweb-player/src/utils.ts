declare global {
  interface Document {
    mozExitFullscreen: Document['exitFullscreen'];
    webkitExitFullscreen: Document['exitFullscreen'];
    msExitFullscreen: Document['exitFullscreen'];
    webkitIsFullScreen: Document['fullscreen'];
    mozFullScreen: Document['fullscreen'];
    msFullscreenElement: Document['fullscreen'];
  }

  interface HTMLElement {
    mozRequestFullScreen: Element['requestFullscreen'];
    webkitRequestFullscreen: Element['requestFullscreen'];
    msRequestFullscreen: Element['requestFullscreen'];
  }
}

import { EventType, IncrementalSource } from 'rrweb';
import type { eventWithTime } from '@rrweb/types';

export function inlineCss(cssObj: Record<string, string>): string {
  let style = '';
  Object.keys(cssObj).forEach((key) => {
    style += `${key}: ${cssObj[key]};`;
  });
  return style;
}

function padZero(num: number, len = 2): string {
  let str = String(num);
  const threshold = Math.pow(10, len - 1);
  if (num < threshold) {
    while (String(threshold).length > str.length) {
      str = `0${num}`;
    }
  }
  return str;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
export function formatTime(ms: number): string {
  if (ms <= 0) {
    return '00:00';
  }
  const hour = Math.floor(ms / HOUR);
  ms = ms % HOUR;
  const minute = Math.floor(ms / MINUTE);
  ms = ms % MINUTE;
  const second = Math.floor(ms / SECOND);
  if (hour) {
    return `${padZero(hour)}:${padZero(minute)}:${padZero(second)}`;
  }
  return `${padZero(minute)}:${padZero(second)}`;
}

export function openFullscreen(el: HTMLElement): Promise<void> {
  if (el.requestFullscreen) {
    return el.requestFullscreen();
  } else if (el.mozRequestFullScreen) {
    /* Firefox */
    return el.mozRequestFullScreen();
  } else if (el.webkitRequestFullscreen) {
    /* Chrome, Safari and Opera */
    return el.webkitRequestFullscreen();
  } else if (el.msRequestFullscreen) {
    /* IE/Edge */
    return el.msRequestFullscreen();
  }
}

export function exitFullscreen(): Promise<void> {
  if (document.exitFullscreen) {
    return document.exitFullscreen();
  } else if (document.mozExitFullscreen) {
    /* Firefox */
    return document.mozExitFullscreen();
  } else if (document.webkitExitFullscreen) {
    /* Chrome, Safari and Opera */
    return document.webkitExitFullscreen();
  } else if (document.msExitFullscreen) {
    /* IE/Edge */
    return document.msExitFullscreen();
  }
}

export function isFullscreen(): boolean {
  let fullscreen = false;
  [
    'fullscreen',
    'webkitIsFullScreen',
    'mozFullScreen',
    'msFullscreenElement',
  ].forEach((fullScreenAccessor) => {
    if (fullScreenAccessor in document) {
      fullscreen = fullscreen || Boolean(document[fullScreenAccessor]);
    }
  });
  return fullscreen;
}

export function onFullscreenChange(handler: () => unknown): () => void {
  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);
  document.addEventListener('mozfullscreenchange', handler);
  document.addEventListener('MSFullscreenChange', handler);

  return () => {
    document.removeEventListener('fullscreenchange', handler);
    document.removeEventListener('webkitfullscreenchange', handler);
    document.removeEventListener('mozfullscreenchange', handler);
    document.removeEventListener('MSFullscreenChange', handler);
  };
}

export function typeOf(
  obj: unknown,
):
  | 'boolean'
  | 'number'
  | 'string'
  | 'function'
  | 'array'
  | 'date'
  | 'regExp'
  | 'undefined'
  | 'null'
  | 'object' {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const toString = Object.prototype.toString;
  const map = {
    '[object Boolean]': 'boolean',
    '[object Number]': 'number',
    '[object String]': 'string',
    '[object Function]': 'function',
    '[object Array]': 'array',
    '[object Date]': 'date',
    '[object RegExp]': 'regExp',
    '[object Undefined]': 'undefined',
    '[object Null]': 'null',
    '[object Object]': 'object',
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
  return map[toString.call(obj)];
}

/**
 * Forked from 'rrweb' replay/index.ts. The original function is not exported.
 * Determine whether the event is a user interaction event
 * @param event - event to be determined
 * @returns true if the event is a user interaction event
 */
function isUserInteraction(event: eventWithTime): boolean {
  if (event.type !== EventType.IncrementalSnapshot) {
    return false;
  }
  return (
    event.data.source > IncrementalSource.Mutation &&
    event.data.source <= IncrementalSource.Input
  );
}

// Forked from 'rrweb' replay/index.ts. A const threshold of inactive time.
const SKIP_TIME_THRESHOLD = 10 * 1000;

/**
 * Get periods of time when no user interaction happened from a list of events.
 * @param events - all events
 * @returns periods of time consist with [start time, end time]
 */
export function getInactivePeriods(events: eventWithTime[]) {
  const inactivePeriods: [number, number][] = [];
  let lastActiveTime = events[0].timestamp;
  for (const event of events) {
    if (!isUserInteraction(event)) continue;
    if (event.timestamp - lastActiveTime > SKIP_TIME_THRESHOLD) {
      inactivePeriods.push([lastActiveTime, event.timestamp]);
    }
    lastActiveTime = event.timestamp;
  }
  return inactivePeriods;
}
