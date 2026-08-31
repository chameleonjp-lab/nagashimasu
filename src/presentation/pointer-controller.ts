export interface PointerEventTarget {
  addEventListener(
    type: string,
    listener: (event: PointerEvent) => void,
    options?: AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: (event: PointerEvent) => void,
    options?: AddEventListenerOptions
  ): void;
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
}

export interface PointerData {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
}

export interface PointerInteractionCallbacks {
  readonly onStart?: (data: PointerData) => void;
  readonly onMove?: (data: PointerData) => void;
  readonly onEnd?: (data: PointerData) => void;
  readonly onCancel?: (data: PointerData) => void;
}

function toData(event: PointerEvent): PointerData {
  return Object.freeze({
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    clientX: event.clientX,
    clientY: event.clientY
  });
}

function preventMouseDefault(event: PointerEvent): void {
  // Keep touch defaults available to the browser; CSS decides whether the
  // current surface is a board gesture or a scrollable operation sheet. Mouse
  // input has no touch pan to preserve, so suppress its native selection
  // behaviour as before.
  if (event.pointerType !== 'touch') event.preventDefault();
}

/**
 * Owns the single active pointer used by the board.
 * Pointer-up only emits an end event; it never confirms a construction.
 */
export class PointerController {
  private activePointerId: number | null = null;
  private attachedValue = false;
  private readonly target: PointerEventTarget;
  private readonly callbacks: PointerInteractionCallbacks;
  private readonly listeners: Readonly<Record<string, (event: PointerEvent) => void>>;

  public constructor(
    target: PointerEventTarget,
    callbacks: PointerInteractionCallbacks
  ) {
    this.target = target;
    this.callbacks = callbacks;
    this.listeners = Object.freeze({
      pointerdown: (event: PointerEvent) => this.handlePointerDown(event),
      pointermove: (event: PointerEvent) => this.handlePointerMove(event),
      pointerup: (event: PointerEvent) => this.handlePointerUp(event),
      pointercancel: (event: PointerEvent) => this.handlePointerCancel(event)
    });
  }

  public get active(): boolean {
    return this.activePointerId !== null;
  }

  public get pointerId(): number | null {
    return this.activePointerId;
  }

  public attach(): void {
    if (this.attachedValue) return;
    for (const [type, listener] of Object.entries(this.listeners)) {
      this.target.addEventListener(type, listener, { passive: false });
    }
    this.attachedValue = true;
  }

  public detach(): void {
    if (!this.attachedValue && this.activePointerId === null) return;
    for (const [type, listener] of Object.entries(this.listeners)) {
      this.target.removeEventListener(type, listener, { passive: false });
    }
    this.attachedValue = false;
    if (this.activePointerId !== null) {
      this.target.releasePointerCapture?.(this.activePointerId);
      this.activePointerId = null;
    }
  }

  public handlePointerDown(event: PointerEvent): boolean {
    if (this.activePointerId !== null) return false;
    this.activePointerId = event.pointerId;
    preventMouseDefault(event);
    this.target.setPointerCapture?.(event.pointerId);
    this.callbacks.onStart?.(toData(event));
    return true;
  }

  public handlePointerMove(event: PointerEvent): boolean {
    if (this.activePointerId !== event.pointerId) return false;
    preventMouseDefault(event);
    this.callbacks.onMove?.(toData(event));
    return true;
  }

  public handlePointerUp(event: PointerEvent): boolean {
    if (this.activePointerId !== event.pointerId) return false;
    preventMouseDefault(event);
    this.callbacks.onEnd?.(toData(event));
    this.target.releasePointerCapture?.(event.pointerId);
    this.activePointerId = null;
    return true;
  }

  public handlePointerCancel(event: PointerEvent): boolean {
    if (this.activePointerId !== event.pointerId) return false;
    preventMouseDefault(event);
    this.callbacks.onCancel?.(toData(event));
    this.target.releasePointerCapture?.(event.pointerId);
    this.activePointerId = null;
    return true;
  }
}
