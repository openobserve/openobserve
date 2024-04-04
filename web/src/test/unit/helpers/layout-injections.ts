/**
 * Injections for Components with a QPage root Element
 */
export function qLayoutInjections() {
  return {
    // pageContainerKey
    _q_pc_: true,
    // layoutKey
    _q_l_: {
      header: { size: 100, offset: 0, space: false },
      right: { size: 0, offset: 0, space: false },
      footer: { size: 0, offset: 0, space: false },
      left: { size: 300, offset: 0, space: false },
      isContainer: false,
    },
  };
}
