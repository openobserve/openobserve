import { ref, onMounted, onBeforeUnmount, watch, type Ref } from "vue";

interface Options {
  /** Reactive enable flag — when false, animation pauses + placeholder resets to first prompt. */
  enabled?: Ref<boolean>;
  /** Milliseconds per character while typing. Default 45. */
  typeSpeedMs?: number;
  /** Milliseconds per character while erasing. Default 25. */
  eraseSpeedMs?: number;
  /** Milliseconds to hold the full prompt before erasing. Default 1800. */
  holdMs?: number;
  /** Milliseconds to wait before starting the loop. Default 300. */
  initialDelayMs?: number;
}

/**
 * Cycles through `prompts` with a typewriter effect.
 * Use the returned `placeholder` as a reactive placeholder text on an input.
 */
export function useTypewriterPlaceholder(
  prompts: string[] | Ref<string[]>,
  options: Options = {},
) {
  const placeholder = ref("");
  const typeSpeed = options.typeSpeedMs ?? 45;
  const eraseSpeed = options.eraseSpeedMs ?? 25;
  const holdMs = options.holdMs ?? 1800;
  const initialDelay = options.initialDelayMs ?? 300;

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const getPrompts = (): string[] =>
    Array.isArray(prompts) ? prompts : prompts.value;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      clearTimer();
      timer = setTimeout(() => resolve(), ms);
    });
  }

  async function loop(): Promise<void> {
    let i = 0;
    await delay(initialDelay);
    while (!cancelled) {
      if (options.enabled && !options.enabled.value) {
        await delay(200);
        continue;
      }
      const list = getPrompts();
      if (list.length === 0) {
        await delay(500);
        continue;
      }
      const target = list[i % list.length];
      for (let c = 1; c <= target.length; c++) {
        if (cancelled) return;
        placeholder.value = target.slice(0, c);
        await delay(typeSpeed);
      }
      await delay(holdMs);
      if (cancelled) return;
      for (let c = target.length - 1; c >= 0; c--) {
        if (cancelled) return;
        placeholder.value = target.slice(0, c);
        await delay(eraseSpeed);
      }
      i++;
    }
  }

  onMounted(() => {
    loop();
  });

  onBeforeUnmount(() => {
    cancelled = true;
    clearTimer();
  });

  if (options.enabled) {
    watch(options.enabled, (val) => {
      if (!val) placeholder.value = "";
    });
  }

  return { placeholder };
}
