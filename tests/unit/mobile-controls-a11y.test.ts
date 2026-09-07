import { describe, expect, it } from 'vitest';

import { mobileControlsAccessibilityState } from '../../src/presentation/mobile-controls-a11y';

describe('mobile controls accessibility state', () => {
  it('keeps the desktop operation controls in the normal document flow', () => {
    expect(mobileControlsAccessibilityState(false, false)).toEqual({
      role: null,
      ariaHidden: null,
      ariaModal: null,
      inert: false
    });
    expect(mobileControlsAccessibilityState(false, true)).toEqual({
      role: null,
      ariaHidden: null,
      ariaModal: null,
      inert: false
    });
  });

  it('hides the closed mobile sheet from focus and assistive technology', () => {
    expect(mobileControlsAccessibilityState(true, false)).toEqual({
      role: 'dialog',
      ariaHidden: true,
      ariaModal: null,
      inert: true
    });
  });

  it('exposes the open mobile sheet as a modal dialog', () => {
    expect(mobileControlsAccessibilityState(true, true)).toEqual({
      role: 'dialog',
      ariaHidden: null,
      ariaModal: true,
      inert: false
    });
  });
});
