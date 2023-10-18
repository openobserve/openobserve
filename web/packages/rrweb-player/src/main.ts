import type { eventWithTime } from '@rrweb/types';
import _Player from './Player.svelte';

type PlayerProps = {
  events: eventWithTime[];
};

class Player extends _Player {
  constructor(options: {
    target: Element;
    props: PlayerProps;
    // for compatibility
    data?: PlayerProps;
  }) {
    super({
      target: options.target,
      props: options.data || options.props,
    });
  }
}

export default Player;
