/** Where a canvas pane shows a step: the viewport that centres it at a zoom. */
type Viewport = { x: number; y: number; zoom: number };

/**
 * A live run's canvas follows the step the run is at, until the person pans or
 * zooms. After that the view is theirs: a later step never takes it back.
 */
export function stepFollower() {
  let moved = false;
  return {
    /** The person moved the view (a drag, a wheel or a pinch), not the canvas itself. */
    moved() {
      moved = true;
    },
    /** The viewport that centres the step, or undefined once the person has moved the view. */
    centre(
      pane: { width: number; height: number },
      step: { x: number; y: number; width: number; height: number },
      zoom: number,
    ): Viewport | undefined {
      if (moved) return undefined;
      return {
        x: pane.width / 2 - (step.x + step.width / 2) * zoom,
        y: pane.height / 2 - (step.y + step.height / 2) * zoom,
        zoom,
      };
    },
  };
}
