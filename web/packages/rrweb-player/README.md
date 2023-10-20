_Looking for a Vue.js version? Go here --> [@preflight-hq/rrweb-player-vue](https://github.com/Preflight-HQ/rrweb-player-vue)_

---

# rrweb-player

Since rrweb's replayer only provides a basic UI, you can choose rrweb-replayer which is based on rrweb's public APIs but has a feature-rich replayer UI.

## How is this different from `rrweb.Replayer`?

rrweb-player uses rrweb's Replayer under the hood, but as Replayer doesn't include any UI for controls, rrweb-player adds those.

## Installation

rrweb-player can also be included with `<script>`：

```html
<link
  rel="stylesheet"
  href="https://cdn.jsdelivr.net/npm/rrweb-player@latest/dist/style.css"
/>
<script src="https://cdn.jsdelivr.net/npm/rrweb-player@latest/dist/index.js"></script>
```

Or installed by using NPM：

```shell
npm install --save rrweb-player
```

```js
import rrwebPlayer from 'rrweb-player';
import 'rrweb-player/dist/style.css';
```

## Usage

```js
new rrwebPlayer({
  target: document.body, // customizable root element
  props: {
    events,
  },
});
```

## Options

| key            | default      | description                                                                                                         |
| -------------- | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| events         | []           | the events for replaying                                                                                            |
| width          | 1024         | the width of the replayer                                                                                           |
| height         | 576          | the height of the replayer                                                                                          |
| maxScale       | 1            | the maximum scale of the replayer (1 = 100%), set to 0 for unlimited                                                |
| autoPlay       | true         | whether to autoplay                                                                                                 |
| speed          | 1            | The default speed to play at                                                                                        |
| speedOption    | [1, 2, 4, 8] | speed options in UI                                                                                                 |
| showController | true         | whether to show the controller UI                                                                                   |
| tags           | {}           | customize the custom events style with a key-value map                                                              |
| inactiveColor  | #D4D4D4      | Customize the color of inactive periods indicator in the progress bar with a valid CSS color string.                |
| ...            | -            | all the [rrweb Replayer options](https://github.com/rrweb-io/rrweb/blob/master/guide.md#options-1) will be bypassed |

## methods on the rrwebPlayer component

```ts
addEventListener(event: string, handler: (params: any) => unknown): void;
```

```ts
addEvent(event: eventWithTime): void;
```

```ts
getMetaData() => {
    startTime: number;
    endTime: number;
    totalTime: number;
}
```

```ts
getReplayer() => Replayer;
```

```ts
getMirror() => Mirror;
```

Toggles between play/pause

```ts
toggle();
```

Sets speed of player

```ts
setSpeed(speed: number)
```

Turns on/off skip inactive

```ts
toggleSkipInactive();
```

Triggers resize, do this whenever you change width/height

```ts
triggerResize();
```

Plays replay

```ts
play();
```

Pauses replay

```ts
pause();
```

Go to a point in time and pause or play from then

```ts
goto(timeOffset: number, play?: boolean)
```

Plays from a time to a time and (optionally) loop

```ts
playRange(
    timeOffset: number,
    endTimeOffset: number,
    startLooping: boolean = false,
    afterHook: undefined | (() => void) = undefined,
  )
```
