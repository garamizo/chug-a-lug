import type { LightboxItem } from '$lib/types';
declare global {
  namespace App {
    interface PageState {
      /** Set when the stop sheet was pushed in this tab, so closing can go back one step. */
      sheet?: boolean;
      lightbox?: { items: LightboxItem[]; index: number };
    }
  }
}
export {};
