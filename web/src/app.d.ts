import type { LightboxItem } from '$lib/types';
declare global {
  namespace App {
    interface PageState {
      /** Set when the stop sheet was pushed in this tab, so closing can go back one step. */
      sheet?: boolean;
      /**
       * The open stop sheet's stop id, once `page.state` has been touched by `$lib/nav`; `null`
       * means explicitly closed. Absent (the key missing) means a pristine, freshly-loaded page,
       * which falls back to the `?stop=` URL param instead — see `sheetStopId` in `$lib/nav`.
       */
      stop?: string | null;
      lightbox?: { items: LightboxItem[]; index: number };
    }
  }
}
export {};
