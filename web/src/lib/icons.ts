// One stroke-icon set for the whole app (24x24, round caps). Words stay in labels.ts and become
// each control's accessible name.
export type IconName = 'back' | 'edit' | 'delete' | 'add' | 'up' | 'down' | 'send' | 'attach' | 'camera' | 'emoji' | 'keyboard';

export const ICONS: Record<IconName, string[]> = {
  back: ['M15 5l-7 7 7 7'],
  edit: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13.5 6.5l4 4'],
  delete: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  add: ['M12 5v14', 'M5 12h14'],
  up: ['M6 15l6-6 6 6'],
  down: ['M6 9l6 6 6-6'],
  send: ['M4 12l16-8-6 16-3-7-7-1z'],
  attach: ['M20 11l-8.5 8.5a5 5 0 01-7-7L13 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L14 7'],
  camera: ['M4 8h3l2-3h6l2 3h3v11H4z', 'M12 16a3 3 0 100-6 3 3 0 000 6z'],
  emoji: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2', 'M9 10h.01', 'M15 10h.01'],
  keyboard: ['M3 7h18v10H3z', 'M7 11h.01', 'M11 11h.01', 'M15 11h.01', 'M8 14h8']
};
