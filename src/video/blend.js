// Video crossfade + blend mode for the two iframe stages.

const MODES = ['normal', 'screen', 'difference', 'luminosity']; // NORMAL / ADD / DIFF / LUMA

/**
 * A deck faded fully out still shows this much video. The audio cuts to
 * silence, but the picture never goes black — a DJ has to see that the other
 * deck is still running (and where it is) before bringing it back in.
 */
export const MIN_VIDEO_OPACITY = 0.22;

/** Map a 0..1 crossfader side onto the visible range. */
const stageOpacity = (t, floor) => floor + (1 - floor) * t;

/**
 * @param {{A:HTMLElement,B:HTMLElement}} stages wrappers around each iframe
 * @param {{xfader:number, blend:number}} s
 * @param {number} [floor] opacity a fully faded-out deck keeps
 */
export function applyVideo(stages, { xfader, blend }, floor = MIN_VIDEO_OPACITY) {
  if (stages.A) stages.A.style.opacity = String(stageOpacity(1 - xfader, floor));
  if (stages.B) {
    stages.B.style.opacity = String(stageOpacity(xfader, floor));
    stages.B.style.mixBlendMode = MODES[blend] || 'normal';
  }
}

export const blendName = (i) => ['NORMAL', 'ADD', 'DIFF', 'LUMA'][i] || 'NORMAL';
