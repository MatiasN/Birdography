import { render, screen } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LayoutContext } from "@/hooks/useLayout";
import { me, mockApi, type Routes } from "@/test/api";
import Profile from "@/pages/Profile";

/** Profile inside a parent that provides what Layout gives its pages. */
function renderProfile(logout = vi.fn<() => Promise<void>>()) {
  const context: LayoutContext = { user: me({ expires_at: "2026-12-16T12:00:00Z" }), logout };
  const router = createMemoryRouter(
    [{ element: <Outlet context={context} />, children: [{ path: "/profile", element: <Profile /> }] }],
    { initialEntries: ["/profile"] },
  );
  render(<RouterProvider router={router} />);
  return logout;
}

async function fill(current: string, fresh: string, repeat = fresh) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), fresh);
  await user.type(screen.getByLabelText("Repeat new password"), repeat);
  await user.click(screen.getByRole("button", { name: "Change password" }));
}

const NEW = "a new password long enough";

describe("Profile password", () => {
  it("changes the password and clears the form", async () => {
    const calls = mockApi({ "POST /auth/password": { status: 204 } });
    renderProfile();
    await fill("old password!", NEW);
    expect(await screen.findByText("Password changed.")).toBeInTheDocument();
    expect(calls[0].body).toEqual({ current_password: "old password!", new_password: NEW });
    expect(screen.getByLabelText("Current password")).toHaveValue("");
    expect(screen.getByLabelText("New password")).toHaveValue("");
  });

  it("refuses mismatched new passwords without asking the server", async () => {
    const calls = mockApi({});
    renderProfile();
    await fill("old password!", NEW, "something else entirely");
    expect(await screen.findByText("The new passwords do not match")).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it.each<[string, Routes, string]>([
    [
      "a wrong current password",
      { "POST /auth/password": { status: 400, body: { detail: "Current password is wrong" } } },
      "Current password is wrong",
    ],
    [
      "throttling",
      { "POST /auth/password": { status: 429, body: { detail: "Too many failed attempts, try again later" } } },
      "Too many failed attempts, try again later",
    ],
    [
      "network errors",
      {
        "POST /auth/password": () => {
          throw new TypeError("offline");
        },
      },
      "Could not change the password",
    ],
  ])("shows the reason on %s", async (_, routes, message) => {
    mockApi(routes);
    renderProfile();
    await fill("old password!", NEW);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText("Password changed.")).not.toBeInTheDocument();
  });

  it("replaces an old success note on the next attempt", async () => {
    const routes: Routes = { "POST /auth/password": { status: 204 } };
    mockApi(routes);
    renderProfile();
    await fill("old password!", NEW);
    await screen.findByText("Password changed.");
    routes["POST /auth/password"] = { status: 400, body: { detail: "Current password is wrong" } };
    await fill("wrong one!!", NEW);
    expect(await screen.findByText("Current password is wrong")).toBeInTheDocument();
    expect(screen.queryByText("Password changed.")).not.toBeInTheDocument();
  });
});

describe("Profile", () => {
  it("shows who is logged in and until when", () => {
    renderProfile();
    expect(screen.getByRole("heading", { level: 1, name: "me@example.com" })).toBeInTheDocument();
    expect(screen.getByText(/Signed in on this device until/)).toHaveTextContent("2026");
    expect(screen.getByText("M")).toBeInTheDocument();
  });

  it("has the theme choice and the password and session sections", () => {
    renderProfile();
    for (const name of ["Appearance", "Password", "Session"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
  });

  it("logs out", async () => {
    const logout = renderProfile(vi.fn<() => Promise<void>>().mockResolvedValue());
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(logout).toHaveBeenCalledOnce();
  });
});
