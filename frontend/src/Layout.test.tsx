import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Layout from "@/Layout";
import { me, mockApi, type Routes } from "@/test/api";

function renderLayout(entry = "/") {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <p>Login page</p> },
      {
        element: <Layout />,
        children: [
          { path: "/", element: <p>Photos page</p> },
          { path: "/map", element: <p>Map page</p> },
          { path: "/profile", element: <p>Profile page</p> },
        ],
      },
    ],
    { initialEntries: [entry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("Layout", () => {
  it("shows the page, with the five tabs in the sidebar and in the bottom bar", async () => {
    mockApi({ "GET /auth/me": { body: me() } });
    renderLayout("/map");
    expect(await screen.findByText("Map page")).toBeInTheDocument();
    const tabs = ["Catalogue", "Species", "Upload", "Map", "Near me"];
    for (const nav of [
      screen.getByRole("navigation", { name: "Main" }),
      screen.getByRole("navigation", { name: "Tabs" }),
    ]) {
      expect(
        within(nav)
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(expect.arrayContaining(tabs));
      expect(within(nav).getByRole("link", { name: "Map" })).toHaveAttribute("aria-current", "page");
      expect(within(nav).getByRole("link", { name: "Catalogue" })).not.toHaveAttribute("aria-current");
      expect(within(nav).getByRole("link", { name: "Near me" })).toHaveAttribute("href", "/near-me");
    }
    expect(
      within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Birdography" }),
    ).toHaveAttribute("href", "/catalogue");
  });

  it("titles the phone top bar after the page", async () => {
    mockApi({ "GET /auth/me": { body: me() } });
    renderLayout("/map");
    expect(await screen.findByRole("banner")).toHaveTextContent("Map");
  });

  it("sends anonymous visitors to the login page, rendering nothing meanwhile", async () => {
    mockApi({ "GET /auth/me": { status: 401, body: { detail: "Not authenticated" } } });
    const router = renderLayout();
    expect(screen.queryByText("Photos page")).not.toBeInTheDocument();
    expect(await screen.findByText("Login page")).toBeInTheDocument();
    expect(router.state.location.search).toBe("?expired=1&next=%2F");
  });

  it("returns to the login page when any request answers 401, remembering where the user was", async () => {
    mockApi({ "GET /auth/me": { body: me() } });
    const router = renderLayout();
    await screen.findByText("Photos page");
    act(() => {
      window.dispatchEvent(new Event("session-expired")); // as api() fires on any 401
    });
    expect(await screen.findByText("Login page")).toBeInTheDocument();
    expect(router.state.location.search).toBe("?expired=1&next=%2F");
  });

  it("checks the session again when it is due to end", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const routes: Routes = { "GET /auth/me": { body: me({ expires_at: new Date(Date.now() + 5000).toISOString() }) } };
    const calls = mockApi(routes);
    renderLayout();
    await screen.findByText("Photos page");
    // Renewed meanwhile: the re-check brings a later expires_at and the layout stays.
    routes["GET /auth/me"] = { body: me({ expires_at: new Date(Date.now() + 90_000_000_000).toISOString() }) };
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByText("Photos page")).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((c) => c.path === "/auth/me")).toHaveLength(2));
    // The second timer sits beyond setTimeout's 2^31-1 cap; when it fires early, the session has really ended.
    routes["GET /auth/me"] = { status: 401, body: { detail: "Not authenticated" } };
    await act(() => vi.advanceTimersByTimeAsync(2 ** 31));
    expect(await screen.findByText("Login page")).toBeInTheDocument();
  });

  it("opens the account menu from the sidebar and the top bar, leading to the profile page", async () => {
    mockApi({ "GET /auth/me": { body: me() } });
    const router = renderLayout();
    const triggers = await screen.findAllByRole("button", { name: "Account: me@example.com" });
    expect(triggers).toHaveLength(2); // the sidebar's and the phone top bar's
    await userEvent.click(triggers[0]);
    expect(screen.getByRole("menu")).toHaveTextContent("me@example.com");
    await userEvent.click(screen.getByRole("menuitem", { name: "Profile" }));
    expect(await screen.findByText("Profile page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/profile");

    await userEvent.click(triggers[1]);
    expect(screen.getByRole("menuitem", { name: "Log out" })).toBeInTheDocument();
  });

  it("logs out from the account menu", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: me() },
      "POST /auth/logout": { status: 204 },
    });
    const router = renderLayout();
    await userEvent.click((await screen.findAllByRole("button", { name: "Account: me@example.com" }))[0]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Log out" }));
    expect(await screen.findByText("Login page")).toBeInTheDocument();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /auth/me", "POST /auth/logout"]);
    expect(router.state.location.pathname).toBe("/login");
  });
});
