/** Full-page navigation away from the app (e.g. to Facebook's login). Wrapped so tests can observe it. */
export const browser = {
  assign(url: string): void {
    window.location.assign(url);
  },
};
