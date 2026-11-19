import { Outlet, ScrollRestoration } from 'react-router-dom';

/** Top of the route tree: restores scroll position on navigation like a multi-page site. */
export function RootLayout() {
  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
