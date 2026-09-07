export interface MobileControlsAccessibilityState {
  readonly role: 'dialog' | null;
  readonly ariaHidden: boolean | null;
  readonly ariaModal: boolean | null;
  readonly inert: boolean;
}

/**
 * Describes the accessibility state of the mobile operation sheet.
 *
 * Desktop keeps the operation controls in the normal page flow. On mobile,
 * the closed sheet is hidden from assistive technology and keyboard focus,
 * while the open sheet behaves as a modal dialog.
 */
export function mobileControlsAccessibilityState(
  isMobile: boolean,
  isOpen: boolean
): MobileControlsAccessibilityState {
  if (!isMobile) {
    return Object.freeze({
      role: null,
      ariaHidden: null,
      ariaModal: null,
      inert: false
    });
  }

  return Object.freeze({
    role: 'dialog',
    ariaHidden: isOpen ? null : true,
    ariaModal: isOpen ? true : null,
    inert: !isOpen
  });
}
