import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Layout from "./Layout";
import { me, mockApi, type Routes } from "./test/api";

function renderLayout() {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <p>Login page</p> },
      { element: <Layout />, children: [{ path: "/", element: <p>Photos page</p> }] },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("Layout", () => {
  it("shows the page and who is logged in", async () => {
    mockApi({ "GET /auth/me": { body: me() } });
    renderLayout();
    expect(await screen.findByText("me@example.com")).toBeInTheDocument();
    expect(screen.getByText("Photos page")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Photos" })).toHaveClass("bg-emerald-700");
    expect(screen.getByRole("link", { name: "Map" })).not.toHaveClass("bg-emerald-700");
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

  it("links the email to the account page", async () => {
    mockApi({ "GET /auth/me": { body: me() } });
    renderLayout();
    expect(await screen.findByRole("link", { name: "me@example.com" })).toHaveAttribute("href", "/account");
  });

  it("logs out", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: me() },
      "POST /auth/logout": { status: 204 },
    });
    const router = renderLayout();
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    expect(await screen.findByText("Login page")).toBeInTheDocument();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /auth/me", "POST /auth/logout"]);
    expect(router.state.location.pathname).toBe("/login");
  });
});
