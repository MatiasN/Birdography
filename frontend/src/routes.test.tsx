import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./routes";
import { health, me, mockApi } from "./test/api";

vi.mock("react-leaflet", () => import("./test/leaflet"));

function open(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

describe("routes", () => {
  it("/login is public", () => {
    open("/login");
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
  });

  it("/ is the photo catalog, inside the layout", async () => {
    mockApi({
      "GET /auth/me": { body: me() },
      "GET /photos": { body: [] },
      "GET /health": { body: health },
    });
    open("/");
    expect(await screen.findByText("No photos yet.")).toBeInTheDocument();
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
  });

  it("/account is the account page, inside the layout", async () => {
    mockApi({ "GET /auth/me": { body: me() } });
    open("/account");
    expect(await screen.findByRole("heading", { name: "Change password" })).toBeInTheDocument();
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
