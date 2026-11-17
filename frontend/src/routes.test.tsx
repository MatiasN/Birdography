import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "@/routes";
import { health, makePhoto, me, mockApi } from "@/test/api";
import { stubXhr } from "@/test/xhr";

vi.mock("react-leaflet", () => import("@/test/leaflet"));

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
      "GET /photos?limit=60&offset=0": { body: [] },
      "GET /photos/summary": { body: { photos: 0, species: 0 } },
      "GET /photos/cameras": { body: [] },
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
    ["/near-me", "What's around you"],
  ])("%s is a placeholder saying what is coming", async (path, title) => {
    mockApi({ "GET /auth/me": { body: me() } });
    open(path);
    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
  });

  it("/upload is the Upload tab; uploads keep going on other tabs, counted on the tab", async () => {
    mockApi({
      "GET /auth/me": { body: me() },
      "GET /health": { body: health },
      "GET /photos?limit=60&offset=0": { body: [] },
      "GET /photos/summary": { body: { photos: 0, species: 0 } },
      "GET /photos/cameras": { body: [] },
    });
    const sent = stubXhr();
    const router = open("/upload");
    const input = await screen.findByTestId<HTMLInputElement>("file-input");
    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.jpg"), new File(["x"], "b.jpg"), new File(["x"], "c.jpg")] },
    });
    const tabs = screen.getByRole("navigation", { name: "Tabs" });
    expect(within(tabs).getByRole("link", { name: "Upload, 3 in progress" })).toBeInTheDocument();

    await act(() => router.navigate("/catalogue"));
    await waitFor(() => expect(sent).toHaveLength(2));
    await act(() => sent[0].respond(201, makePhoto({ id: 1 })));
    expect(within(tabs).getByRole("link", { name: "Upload, 2 in progress" })).toBeInTheDocument();

    await act(() => router.navigate("/upload"));
    expect(await screen.findByText("1 of 3 uploaded")).toBeInTheDocument();
    await act(() => sent[1].respond(201, makePhoto({ id: 2 })));
    await waitFor(() => expect(sent).toHaveLength(3));
    await act(() => sent[2].respond(201, makePhoto({ id: 3 })));
    expect(within(tabs).getByRole("link", { name: "Upload" })).toBeInTheDocument(); // no count once done
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
