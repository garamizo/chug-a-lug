// Screen chrome shared across layouts: the root layout draws the menu, the tab bar opens it and
// the Tab sheet (which Live draws, since the drinks it logs belong to Live's stop). `celebrating` is
// true while a Golden Spike card is on screen, so nothing opens itself over it.
export const ui = $state({ menuOpen: false, tabOpen: false, celebrating: false });
