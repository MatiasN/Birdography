import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./routes";
import { health, me, mockApi } from "./test/api";

vi.mock("react-leaflet", () => import("./test/leaflet"));

function open(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe("routes", () => {
  it("/login is public", () => {
    open("/login");
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
  });

  it("/ goes to the catalogue, inside the layout", async () => {
    mockApi({
      "GET /auth/me": { body: me() },
      "GET /photos": { body: [] },
      "GET /health": { body: health },
    });
    const router = open("/");
    expect(await screen.findByText("No photos yet.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/catalogue");
    expect(screen.getAllByRole("button", { name: "Account: me@example.com" })).toHaveLength(2);
  });

  it("/account, the old address, goes to the profile page", async () => {
    mockApi({ "GET /auth/me": { body: me() } });
    const router = open("/account");
    expect(await screen.findByRole("heading", { name: "Password" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/profile");
  });

  it.each([
    ["/species", "Your species, one page each"],
    ["/upload", "Uploading gets its own tab"],
    ["/near-me", "What's around you"],
  ])("%s is a placeholder saying what is coming", async (path, title) => {
    mockApi({ "GET /auth/me": { body: me() } });
    open(path);
    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
  });

  it("the Upload placeholder leads to the catalogue's upload button", async () => {
    mockApi({
      "GET /auth/me": { body: me() },
      "GET /photos": { body: [] },
      "GET /health": { body: health },
    });
    const router = open("/upload");
    await userEvent.click(await screen.findByRole("link", { name: "Upload from the Catalogue" }));
    expect(await screen.findByText("Upload photos")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/catalogue");
  });

  it("/map is the map, inside the layout", async () => {
    mockApi({
      "GET /auth/me": { body: me() },
      "GET /photos/points": { body: [{ id: 1, lat: 37, lon: -8 }] },
    });
    open("/map");
    expect(await screen.findByTestId("map-marker")).toBeInTheDocument();
  });
});
