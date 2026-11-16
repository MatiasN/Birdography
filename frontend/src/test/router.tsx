import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

/**
 * Render a page at `path` (with its query, e.g. "/map?photo=7") inside a router, for pages that keep state in the
 * URL. Returns the router, to read `router.state.location` or go back with `router.navigate(-1)`.
 */
export function renderAt(element: ReactElement, path = "/") {
  const router = createMemoryRouter([{ path: path.split("?")[0], element }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}
