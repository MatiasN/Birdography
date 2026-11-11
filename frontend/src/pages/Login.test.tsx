import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { mockApi } from "../test/api";
import Login from "./Login";

function renderLogin() {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <Login /> },
      { path: "/", element: <p>Home</p> },
    ],
    { initialEntries: ["/login"] },
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
