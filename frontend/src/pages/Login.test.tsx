import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { mockApi } from "../test/api";
import Login from "./Login";

function renderLogin(entry = "/login") {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <Login /> },
      { path: "/map", element: <p>Map</p> },
      { path: "/", element: <p>Home</p> },
    ],
    { initialEntries: [entry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function submit(email = "me@example.com", password = "a long password") {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("Email"), email);
  await user.type(screen.getByPlaceholderText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Log in" }));
}

describe("Login", () => {
  it("logs in and goes home", async () => {
    const calls = mockApi({ "POST /auth/login": { body: { access_token: "t", token_type: "bearer" } } });
    renderLogin();
    await submit();
    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(calls[0].body).toEqual({ email: "me@example.com", password: "a long password" });
  });

  it("shows the API's message", async () => {
    mockApi({ "POST /auth/login": { status: 401, body: { detail: "Invalid email or password" } } });
    const router = renderLogin();
    await submit();
    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("has a message for failures that aren't errors", async () => {
    vi.stubGlobal("fetch", () => Promise.reject("offline"));
    renderLogin();
    await submit();
    expect(await screen.findByText("Could not log in")).toBeInTheDocument();
  });
});

describe("after a session expired", () => {
  it("says so and returns to where the user was", async () => {
    mockApi({ "POST /auth/login": { body: { access_token: "t", token_type: "bearer" } } });
    renderLogin("/login?expired=1&next=%2Fmap");
    expect(screen.getByText("Your session expired, log in again.")).toBeInTheDocument();
    await submit();
    expect(await screen.findByText("Map")).toBeInTheDocument();
  });

  it("hides the expiry notice once there is an error to show", async () => {
    mockApi({ "POST /auth/login": { status: 401, body: { detail: "Invalid email or password" } } });
    renderLogin("/login?expired=1");
    await submit();
    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
    expect(screen.queryByText(/session expired/)).not.toBeInTheDocument();
  });

  it.each(["//evil.example", "https://evil.example", "map"])("ignores an unsafe next (%s)", async (next) => {
    mockApi({ "POST /auth/login": { body: { access_token: "t", token_type: "bearer" } } });
    renderLogin(`/login?next=${encodeURIComponent(next)}`);
    await submit();
    expect(await screen.findByText("Home")).toBeInTheDocument();
  });
});
