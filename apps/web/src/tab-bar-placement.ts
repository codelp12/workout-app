import { useEffect, useState } from "react";

/** Whether the element brings up the on-screen keyboard when focused. */
export function isTextEntry(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(el.type);
}

// The keyboard takes at least this much of the screen; less is browser chrome.
const KEYBOARD_MIN_HEIGHT = 150;

// Tallest viewport seen per window width, so rotating doesn't read as a keyboard.
const tallest = new Map<number, number>();

/** Whether the on-screen keyboard is up: a text field has focus and the viewport has shrunk. */
function keyboardUp(): boolean {
  const vv = window.visualViewport;
  if (!vv) return false;
  const width = window.innerWidth;
  const full = Math.max(tallest.get(width) ?? 0, window.innerHeight, vv.height);
  tallest.set(width, full);
  return (
    isTextEntry(document.activeElement) &&
    full - vv.height >= KEYBOARD_MIN_HEIGHT
  );
}

/**
 * How far below the layout viewport the screen's bottom edge is. iOS Safari
 * can leave `visualViewport.offsetTop` stuck above 0 after the keyboard closes,
 * which leaves `position: fixed; bottom: 0` floating up the screen.
 */
function viewportGap(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  const gap = Math.round(vv.offsetTop + vv.height - window.innerHeight);
  return gap > 1 ? gap : 0;
}

export type TabBarPlacement = {
  /** True while the on-screen keyboard is up. */
  hidden: boolean;
  /** Pixels to move the bar down to reach the bottom of the screen. */
  offset: number;
};

/**
 * Keeps the bottom tab bar on the bottom of the screen: hides it while the
 * keyboard is up, and pushes it back down if iOS leaves the viewport shifted
 * after the keyboard closes.
 */
export function useTabBarPlacement(): TabBarPlacement {
  const [placement, setPlacement] = useState<TabBarPlacement>({
    hidden: false,
    offset: 0,
  });
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => {
      const hidden = keyboardUp();
      const offset = hidden ? 0 : viewportGap();
      setPlacement((p) =>
        p.hidden === hidden && p.offset === offset ? p : { hidden, offset },
      );
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    // activeElement is still the old field during focusout, and the keyboard
    // takes a moment to go away.
    const afterBlur = () => {
      clearTimeout(timer);
      update();
      timer = setTimeout(() => {
        // A 1px scroll makes WebKit recompute the viewport.
        if (viewportGap() > 0) {
          window.scrollBy(0, 1);
          window.scrollBy(0, -1);
        }
        update();
      }, 150);
    };
    const onFocusOut = () => setTimeout(afterBlur, 0);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", onFocusOut);
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    update();
    return () => {
      clearTimeout(timer);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", onFocusOut);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
    };
  }, []);
  return placement;
}
