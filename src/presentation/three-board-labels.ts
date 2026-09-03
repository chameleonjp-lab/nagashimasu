import * as THREE from 'three';

import type { ThreeResourceTracker } from './three-resource-tracker';
import type { Vec3Like } from './three-board-math';

export interface BoardLabelStyle {
  readonly color?: string;
  readonly background?: string;
  readonly fontWeight?: number;
}

const DEFAULT_LABEL_STYLE: Required<BoardLabelStyle> = Object.freeze({
  color: '#eef8ff',
  background: 'rgba(7, 21, 33, 0.78)',
  fontWeight: 800
});

interface LabelMaterialEntry {
  readonly material: THREE.SpriteMaterial;
  readonly widthRatio: number;
}

/**
 * A bounded Sprite pool. Textures are cached by label and style so repeated
 * board frames do not allocate new CanvasTextures or materials.
 */
export class ThreeBoardLabelPool {
  private readonly sprites: readonly THREE.Sprite[];
  private readonly materials = new Map<string, LabelMaterialEntry>();
  private nextSpriteIndex = 0;
  private disposedValue = false;

  public constructor(
    scene: THREE.Scene,
    private readonly resources: ThreeResourceTracker,
    maximumLabels: number
  ) {
    if (!Number.isSafeInteger(maximumLabels) || maximumLabels <= 0) {
      throw new RangeError('maximumLabels must be a positive integer');
    }
    const placeholderMaterial = resources.register(new THREE.SpriteMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false
    }));
    const sprites: THREE.Sprite[] = [];
    for (let index = 0; index < maximumLabels; index += 1) {
      const sprite = new THREE.Sprite(placeholderMaterial);
      sprite.visible = false;
      sprite.renderOrder = 100;
      sprites.push(sprite);
      scene.add(sprite);
    }
    this.sprites = Object.freeze(sprites);
  }

  public beginFrame(): void {
    if (this.disposedValue) return;
    this.nextSpriteIndex = 0;
    for (const sprite of this.sprites) sprite.visible = false;
  }

  public use(
    text: string,
    position: Vec3Like,
    width: number,
    style: BoardLabelStyle = {}
  ): void {
    if (this.disposedValue) return;
    const sprite = this.sprites[this.nextSpriteIndex];
    if (sprite === undefined) return;
    this.nextSpriteIndex += 1;
    const resolved = Object.freeze({ ...DEFAULT_LABEL_STYLE, ...style });
    const key = `${text}\u0000${resolved.color}\u0000${resolved.background}\u0000${resolved.fontWeight}`;
    const entry = this.materials.get(key) ?? this.createMaterial(text, resolved, key);
    sprite.material = entry.material;
    sprite.position.set(position.x, position.y, position.z);
    const safeWidth = Math.max(0.12, width);
    sprite.scale.set(safeWidth, safeWidth / entry.widthRatio, 1);
    sprite.visible = true;
  }

  public dispose(): void {
    if (this.disposedValue) return;
    this.disposedValue = true;
    for (const sprite of this.sprites) {
      sprite.visible = false;
      sprite.parent?.remove(sprite);
    }
    this.materials.clear();
    // Materials and CanvasTextures are registered with the shared tracker.
  }

  private createMaterial(
    text: string,
    style: Required<BoardLabelStyle>,
    key: string
  ): LabelMaterialEntry {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 72;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('label canvas context is unavailable');
    context.clearRect(0, 0, canvas.width, canvas.height);
    const fontSize = 42;
    context.font = `${style.fontWeight} ${fontSize}px system-ui, sans-serif`;
    const measuredWidth = Math.ceil(context.measureText(text).width);
    const horizontalPadding = 18;
    const labelWidth = Math.min(canvas.width, Math.max(48, measuredWidth + horizontalPadding * 2));
    context.fillStyle = style.background;
    context.beginPath();
    context.roundRect(2, 2, labelWidth - 4, canvas.height - 4, 12);
    context.fill();
    context.strokeStyle = 'rgba(226, 243, 255, 0.58)';
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = style.color;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, labelWidth / 2, canvas.height / 2 + 1);

    const texture = this.resources.register(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    const material = this.resources.register(new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    }));
    const entry = Object.freeze({
      material,
      widthRatio: labelWidth / canvas.height
    });
    this.materials.set(key, entry);
    return entry;
  }
}
