// Whether the phone view shows its bar of big copies of the machine's
// buttons. Off by default: the buttons on the machine itself work in every
// view, and without the bar the controls sit in a slim strip at the top.

const STORE = 'reelpocket.buttonBar';
export const BUTTON_BAR_CHANGED = 'reelpocket:buttonbar';

export function buttonBarOn(): boolean {
  try {
    return localStorage.getItem(STORE) === 'on';
  } catch {
    return false;
  }
}

export function setButtonBarOn(on: boolean): void {
  try { localStorage.setItem(STORE, on ? 'on' : 'off'); } catch { }
  window.dispatchEvent(new Event(BUTTON_BAR_CHANGED));
}
