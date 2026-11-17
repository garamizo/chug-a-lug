// Screen chrome shared across layouts: the root layout draws the menu, the tab bar opens it and
// the Tab sheet (which the app layout's TabHost draws over any screen). `tabBusy` is true while a Tab
// photo is being taken, sent or kept for Retry. `celebrating` is true while a Golden Spike card is on
// screen, so nothing opens itself over it.
export const ui = $state({ menuOpen: false, tabOpen: false, tabBusy: false, celebrating: false });
