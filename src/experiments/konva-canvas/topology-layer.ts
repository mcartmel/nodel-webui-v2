import Konva from 'konva';

/** Selection ink changes neither hit geometry nor hit ordering. */
export class TopologyLayer extends Konva.Layer {
  private sceneFrame: number | undefined;

  constructor(name: string) {
    super({ name });
    // A native full draw already covers any pending scene-only invalidation.
    this.on('draw.selectionScene', () => this.cancelSceneFrame());
  }

  batchDrawScene(): void {
    this.sceneFrame ??= window.requestAnimationFrame(() => {
      this.sceneFrame = undefined;
      if (this.getStage()) this.drawScene();
    });
  }

  override batchDraw(): this {
    this.cancelSceneFrame();
    return super.batchDraw();
  }

  override destroy(): this {
    this.cancelSceneFrame();
    return super.destroy();
  }

  private cancelSceneFrame(): void {
    if (this.sceneFrame === undefined) return;
    window.cancelAnimationFrame(this.sceneFrame);
    this.sceneFrame = undefined;
  }
}
