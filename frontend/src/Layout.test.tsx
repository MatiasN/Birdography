import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Layout from "./Layout";
import { me, mockApi } from "./test/api";

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
    expect(router.state.location.pathname).toBe("/login");
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
