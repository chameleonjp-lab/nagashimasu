import { describe, expect, it } from 'vitest';

import {
  PointerController,
  type PointerEventTarget
} from '../../src/presentation/pointer-controller';

class FakeTarget implements PointerEventTarget {
  public readonly listeners = new Map<string, (event: PointerEvent) => void>();
  public readonly captured: number[] = [];
  public readonly released: number[] = [];

  public addEventListener(type: string, listener: (event: PointerEvent) => void): void {
    this.listeners.set(type, listener);
  }

  public removeEventListener(type: string): void {
    this.listeners.delete(type);
  }

  public setPointerCapture(pointerId: number): void {
    this.captured.push(pointerId);
  }

  public releasePointerCapture(pointerId: number): void {
    this.released.push(pointerId);
  }
}

function event(pointerId: number, type = 'touch'): PointerEvent {
  return {
    pointerId,
    pointerType: type,
    clientX: 10,
    clientY: 20,
    preventDefault: () => undefined
  } as PointerEvent;
}

describe('PointerController', () => {
  it('allows one active pointer and never turns pointer-up into confirmation', () => {
    const target = new FakeTarget();
    const events: string[] = [];
    const controller = new PointerController(target, {
      onStart: () => events.push('start'),
      onMove: () => events.push('move'),
      onEnd: () => events.push('end')
    });
    controller.attach();
    controller.attach();
    expect(target.listeners.size).toBe(4);

    expect(controller.handlePointerDown(event(1))).toBe(true);
    expect(controller.handlePointerDown(event(2))).toBe(false);
    expect(controller.handlePointerMove(event(2))).toBe(false);
    expect(controller.handlePointerMove(event(1))).toBe(true);
    expect(controller.handlePointerUp(event(1))).toBe(true);
    expect(events).toEqual(['start', 'move', 'end']);
    expect(controller.active).toBe(false);
    expect(target.captured).toEqual([1]);
    expect(target.released).toEqual([1]);
  });

  it('cancels the active interaction and releases capture', () => {
    const target = new FakeTarget();
    let cancelled = 0;
    const controller = new PointerController(target, {
      onCancel: () => {
        cancelled += 1;
      }
    });
    controller.handlePointerDown(event(7));
    expect(controller.handlePointerCancel(event(7))).toBe(true);
    expect(cancelled).toBe(1);
    expect(controller.pointerId).toBeNull();
    expect(target.released).toEqual([7]);
  });

  it('detaches listeners and clears a still-active pointer', () => {
    const target = new FakeTarget();
    const controller = new PointerController(target, {});
    controller.attach();
    controller.handlePointerDown(event(3));
    controller.detach();
    expect(target.listeners.size).toBe(0);
    expect(controller.active).toBe(false);
    expect(target.released).toEqual([3]);
  });
});
