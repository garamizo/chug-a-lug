// Whether the page on screen is the one the app opened on. On the event day opening the app lands
// on Live, but a tap on the logo from inside the app has to reach Home.
export class Landing {
  private moved = false;
  /** Called after every navigation with the path it came from (null on the first load). */
  noteNavigation(fromPath: string | null) {
    // Signing in is still opening the app.
    if (fromPath && fromPath !== '/login') this.moved = true;
  }
  get isEntry(): boolean { return !this.moved; }
}

export const landing = new Landing();
