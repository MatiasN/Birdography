import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import type { User } from "@/api";
import type { LayoutContext } from "@/hooks/useLayout";
import { NameLanguageContext } from "@/hooks/useSpeciesNames";
import NameLanguagePicker from "@/components/NameLanguagePicker";
import { me, mockApi } from "@/test/api";

/** The picker inside a parent that provides what Layout gives its pages; returns the `setUser` it gets. */
function renderPicker(user = me()) {
  const setUser = vi.fn<(user: User) => void>();
  const context: LayoutContext = { user, setUser, logout: vi.fn<() => Promise<void>>() };
  const router = createMemoryRouter([
    { element: <Outlet context={context} />, children: [{ path: "/", element: <NameLanguagePicker /> }] },
  ]);
  render(
    <NameLanguageContext value={user.species_name_language}>
      <RouterProvider router={router} />
    </NameLanguageContext>,
  );
  return setUser;
}

const example = () => screen.getByLabelText("Example");

describe("NameLanguagePicker", () => {
  it("shows the current choice with an example", () => {
    renderPicker(me({ species_name_language: "pt" }));
    expect(screen.getByRole("radio", { name: "Portuguese" })).toBeChecked();
    expect(example()).toHaveTextContent("Pisco-de-peito-ruivo");
    expect(example()).toHaveTextContent("European Robin · Erithacus rubecula");
  });

  it("saves a new choice to the account", async () => {
    const saved = me({ species_name_language: "sci" });
    const calls = mockApi({ "PATCH /auth/me": { body: saved } });
    const onChange = renderPicker();
    await userEvent.click(screen.getByRole("radio", { name: "Scientific" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved));
    expect(calls[0].body).toEqual({ species_name_language: "sci" });
  });

  it("keeps the choice when it is clicked again", async () => {
    const calls = mockApi({});
    const onChange = renderPicker();
    await userEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(calls).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "English" })).toBeChecked();
  });

  it.each([
    ["the API's message", { status: 422, body: { detail: "Invalid language" } }, "Invalid language"],
    [
      "a plain one on a network error",
      () => {
        throw new TypeError("offline");
      },
      "Could not save the setting",
    ],
  ])("shows %s when saving fails", async (_, reply, message) => {
    mockApi({ "PATCH /auth/me": reply });
    const onChange = renderPicker();
    await userEvent.click(screen.getByRole("radio", { name: "Portuguese" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
