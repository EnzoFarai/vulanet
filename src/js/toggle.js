// src/js/toggle.js
// Shared toggle component used across settings pages.
// Renders visual state by swapping classes on the element:
//   .toggle-on  → blue, "toggle right"
//   .toggle-off → red,  "toggle left"
// The element itself is expected to contain an <img> whose src
// we swap between /toggle-right.svg and /toggle-left.svg.

const IMG_ON  = '/assets/icons/phosphor/fill/toggle-right.svg';
const IMG_OFF = '/assets/icons/phosphor/duotone/toggle-left.svg';

export function initToggle(element, initialState, onChange) {
  if (!element) {
    return {
      getValue: () => false,
      setValue: () => {}
    };
  }

  const img = element.querySelector('img');
  let isOn = !!initialState;
  let lastSwipe = 0;
  const THRESHOLD = 30;

  function setVisual() {
    element.classList.toggle('toggle-on', isOn);
    element.classList.toggle('toggle-off', !isOn);
    if (img) {
      img.src = isOn ? IMG_ON : IMG_OFF;
      img.alt = isOn ? 'On' : 'Off';
    }
  }

  function toggle(bySwipe = false) {
    isOn = !isOn;
    setVisual();
    if (bySwipe) lastSwipe = Date.now();
    if (typeof onChange === 'function') {
      try { onChange(isOn); } catch (e) { console.error(e); }
    }
  }

  // ── Touch ──────────────────────────────────────────────
  let touchStartX = 0;
  element.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    element.classList.add('swiping');
  }, { passive: true });

  element.addEventListener('touchend', (e) => {
    const delta = e.changedTouches[0].screenX - touchStartX;
    element.classList.remove('swiping');
    if (Math.abs(delta) > THRESHOLD) {
      toggle(true);
      e.preventDefault();
    }
  });

  // ── Mouse ──────────────────────────────────────────────
  let mouseDown = false;
  let mouseStartX = 0;

  element.addEventListener('mousedown', (e) => {
    mouseDown = true;
    mouseStartX = e.screenX;
    element.classList.add('swiping');
    e.preventDefault();
  });

  element.addEventListener('mouseup', (e) => {
    if (!mouseDown) return;
    const delta = e.screenX - mouseStartX;
    mouseDown = false;
    element.classList.remove('swiping');
    if (Math.abs(delta) > THRESHOLD) toggle(true);
  });

  element.addEventListener('mouseleave', () => {
    mouseDown = false;
    element.classList.remove('swiping');
  });

  element.addEventListener('click', (e) => {
    if (Date.now() - lastSwipe < 200) {
      e.stopPropagation();
      return;
    }
    toggle(false);
  });

  element.addEventListener('contextmenu', (e) => e.preventDefault());

  // Apply initial visual state
  setVisual();

  return {
    getValue: () => isOn,
    setValue: (v, silent = false) => {
      isOn = !!v;
      setVisual();
      if (!silent && typeof onChange === 'function') {
        try { onChange(isOn); } catch (e) { console.error(e); }
      }
    }
  };
}
