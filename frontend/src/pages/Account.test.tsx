import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mockApi, type Routes } from "../test/api";
import Account from "./Account";

async function fill(current: string, fresh: string, repeat = fresh) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), fresh);
  await user.type(screen.getByLabelText("Repeat new password"), repeat);
  await user.click(screen.getByRole("button", { name: "Change password" }));
}

const NEW = "a new password long enough";

describe("Account", () => {
  it("changes the password and clears the form", async () => {
    const calls = mockApi({ "POST /auth/password": { status: 204 } });
    render(<Account />);
    await fill("old password!", NEW);
    expect(await screen.findByText("Password changed.")).toBeInTheDocument();
    expect(calls[0].body).toEqual({ current_password: "old password!", new_password: NEW });
    expect(screen.getByLabelText("Current password")).toHaveValue("");
    expect(screen.getByLabelText("New password")).toHaveValue("");
  });

  it("refuses mismatched new passwords without asking the server", async () => {
    const calls = mockApi({});
    render(<Account />);
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
    render(<Account />);
    await fill("old password!", NEW);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText("Password changed.")).not.toBeInTheDocument();
  });

  it("replaces an old success note on the next attempt", async () => {
    const routes: Routes = { "POST /auth/password": { status: 204 } };
    mockApi(routes);
    render(<Account />);
    await fill("old password!", NEW);
    await screen.findByText("Password changed.");
    routes["POST /auth/password"] = { status: 400, body: { detail: "Current password is wrong" } };
    await fill("wrong one!!", NEW);
    expect(await screen.findByText("Current password is wrong")).toBeInTheDocument();
    expect(screen.queryByText("Password changed.")).not.toBeInTheDocument();
  });
});
