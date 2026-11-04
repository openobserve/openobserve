import {
  getCurrentInstance,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
  type Ref,
} from "vue";

interface Options {
  /** Reactive enable flag — when false, animation pauses + placeholder resets to empty. */
  enabled?: Ref<boolean>;
  /** Milliseconds per character while typing. Default 45. */
  typeSpeedMs?: number;
  /** Milliseconds per character while erasing. Default 25. */
  eraseSpeedMs?: number;
  /** Milliseconds to hold the full prompt before erasing. Default 1800. */
  holdMs?: number;
  /** Milliseconds to wait before the first character. Default 300. */
  initialDelayMs?: number;
}

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false);

/** Types each prompt once and rests on the last; static under reduced motion, paused while offscreen or cached. */
export function useTypewriterPlaceholder(
  prompts: string[] | Readonly<Ref<string[]>>,
  options: Options = {},
) {
  const placeholder = ref("");
  const typeSpeed = options.typeSpeedMs ?? 45;
  const eraseSpeed = options.eraseSpeedMs ?? 25;
  const holdMs = options.holdMs ?? 1800;
  const initialDelay = options.initialDelayMs ?? 300;
  const instance = getCurrentInstance();
  const still = prefersReducedMotion();

  let index = 0;
  let typed = 0;
  let erasing = false;
  let started = false;
  let resting = still;
  let mounted = false;
  let active = true;
  let onScreen = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let observer: IntersectionObserver | null = null;

  const getPrompts = (): string[] => (Array.isArray(prompts) ? prompts : prompts.value);
  const isEnabled = () => !options.enabled || options.enabled.value;
  const canRun = () =>
    mounted &&
    active &&
    onScreen &&
    isEnabled() &&
    !(typeof document !== "undefined" && document.hidden);

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(ms: number) {
    clearTimer();
    timer = setTimeout(step, ms);
  }

  function showRest() {
    const list = getPrompts();
    placeholder.value = isEnabled() ? (list[list.length - 1] ?? "") : "";
  }

  function step() {
    timer = null;
    const list = getPrompts();
    if (list.length === 0) return;
    index = Math.min(index, list.length - 1);
    const target = list[index];
    typed = Math.min(typed, target.length);
    if (erasing) {
      if (typed > 0) {
        typed--;
        placeholder.value = target.slice(0, typed);
        schedule(eraseSpeed);
        return;
      }
      erasing = false;
      index++;
      step();
      return;
    }
    if (typed < target.length) {
      typed++;
      placeholder.value = target.slice(0, typed);
      schedule(typeSpeed);
      return;
    }
    if (index >= list.length - 1) {
      resting = true;
      return;
    }
    erasing = true;
    schedule(holdMs);
  }

  function resume() {
    if (resting) {
      showRest();
      return;
    }
    if (!canRun() || timer !== null) return;
    schedule(started ? typeSpeed : initialDelay);
    started = true;
  }

  const onVisibilityChange = () => (document.hidden ? clearTimer() : resume());

  function watchInputs() {
    watch(
      () => getPrompts().join("\n"),
      () => {
        if (resting) showRest();
        else resume();
      },
    );
    if (!options.enabled) return;
    watch(options.enabled, (val) => {
      if (val) {
        resume();
        return;
      }
      clearTimer();
      typed = 0;
      erasing = false;
      placeholder.value = "";
    });
  }

  onMounted(() => {
    mounted = true;
    // Callers' getters may read state declared after this call, so nothing reads them during setup.
    watchInputs();
    const el = instance?.proxy?.$el;
    if (el instanceof Element && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        onScreen = entries[entries.length - 1]?.isIntersecting ?? onScreen;
        if (onScreen) resume();
        else clearTimer();
      });
      observer.observe(el);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    resume();
  });

  onActivated(() => {
    active = true;
    resume();
  });

  onDeactivated(() => {
    active = false;
    clearTimer();
  });

  onBeforeUnmount(() => {
    mounted = false;
    clearTimer();
    observer?.disconnect();
    observer = null;
    document.removeEventListener("visibilitychange", onVisibilityChange);
  });

  return { placeholder };
}
