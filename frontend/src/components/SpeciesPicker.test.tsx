import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ResponsivePanel from "@/components/ResponsivePanel";
import { stubMatchMedia } from "@/test/media";
import SpeciesPicker, { draftFrom } from "@/components/SpeciesPicker";
import { makeSpecies, mockApi } from "@/test/api";
import type { Species } from "@/api";

const HERON = makeSpecies({ id: 1, scientific_name: "Ardea cinerea", name_en: "Grey Heron", name_pt: "Garça-real" });
const EGRET = makeSpecies({
  id: 2,
  scientific_name: "Egretta garzetta",
  name_en: "Little Egret",
  name_pt: "Garça-branca-pequena",
});
const search = (q: string) => `GET /species?q=${encodeURIComponent(q)}&limit=8`;

function setup(props: Partial<Parameters<typeof SpeciesPicker>[0]> = {}) {
  const onPick = vi.fn<(species: Species) => void>();
  render(<SpeciesPicker onPick={onPick} {...props} />);
  return { onPick, field: screen.getByRole("combobox", { name: props.label ?? "Species" }) };
}

describe("SpeciesPicker", () => {
  it("searches the three names as you type and picks with the mouse", async () => {
    const calls = mockApi({ [search("garça")]: { body: [HERON, EGRET] } });
    const { onPick, field } = setup();
    await userEvent.type(field, "garça");

    const list = await screen.findByRole("listbox");
    expect(field).toHaveAttribute("aria-expanded", "true");
    const options = within(list).getAllByRole("option");
    expect(options[0]).toHaveTextContent("Grey HeronGarça-real · Ardea cinerea");
    expect(options[2]).toHaveTextContent("Add “garça” as a new species");
    expect(calls.map((c) => c.path)).toEqual(["/species?q=gar%C3%A7a&limit=8"]); // once, after typing pauses

    await userEvent.click(options[1]);
    expect(onPick).toHaveBeenCalledWith(EGRET);
    expect(field).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("moves through the options with the arrow keys and picks with Enter", async () => {
    mockApi({ [search("her")]: { body: [HERON, EGRET] } });
    const { onPick, field } = setup();
    await userEvent.type(field, "her");
    const options = await screen.findAllByRole("option");
    expect(field).toHaveAttribute("aria-activedescendant", options[0].id);

    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(field).toHaveAttribute("aria-activedescendant", options[1].id);
    await userEvent.keyboard("{ArrowUp}{ArrowUp}{Enter}");
    expect(onPick).toHaveBeenCalledWith(HERON);
  });

  it("follows the mouse over the options", async () => {
    mockApi({ [search("her")]: { body: [HERON, EGRET] } });
    const { field } = setup();
    await userEvent.type(field, "her");
    const options = await screen.findAllByRole("option");
    await userEvent.hover(options[1]);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });

  it("leaves out species already chosen, and keys do nothing while the list is closed", async () => {
    mockApi({ [search("gar")]: { body: [HERON, EGRET] } });
    const { onPick, field } = setup({ exclude: [1], allowCreate: false });
    await userEvent.type(field, "{ArrowDown}{Enter}");
    expect(onPick).not.toHaveBeenCalled();

    await userEvent.type(field, "gar");
    expect(await screen.findAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("Little Egret");
  });

  it("only filters without allowCreate: nothing to add, and says when nothing matches", async () => {
    mockApi({ [search("zzz")]: { body: [] } });
    const { onPick, field } = setup({ allowCreate: false });
    await userEvent.type(field, "zzz");
    expect(await screen.findByText("No species match")).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("Escape closes the list but not the panel around it; a second Escape does", async () => {
    mockApi({ [search("her")]: { body: [HERON] } });
    const onClose = vi.fn<() => void>();
    stubMatchMedia(false, true); // the side panel, which closes on Escape itself
    render(
      <ResponsivePanel title="Photo details" onClose={onClose}>
        <SpeciesPicker onPick={() => undefined} />
      </ResponsivePanel>,
    );
    await userEvent.type(screen.getByRole("combobox"), "her");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes the list when clicking elsewhere, but not when clicking its own field", async () => {
    mockApi({ [search("her")]: { body: [HERON] } });
    render(
      <>
        <SpeciesPicker onPick={() => undefined} />
        <button>Elsewhere</button>
      </>,
    );
    const field = screen.getByRole("combobox");
    await userEvent.type(field, "her");
    await screen.findByRole("listbox");
    await userEvent.click(field);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("says so when the search fails, and clears it when typing again", async () => {
    mockApi({
      [search("her")]: () => {
        throw new TypeError("offline");
      },
      [search("he")]: { body: [] },
    });
    const { field } = setup();
    await userEvent.type(field, "her");
    expect(await screen.findByText("Could not search the species")).toBeInTheDocument();
    await userEvent.type(field, "{Backspace}");
    expect(screen.queryByText("Could not search the species")).not.toBeInTheDocument();
  });

  it("can take the focus when it appears", () => {
    mockApi({});
    const { field } = setup({ focusOnMount: true, label: "Add species" });
    expect(field).toHaveFocus();
  });
});

/** Type text that matches nothing and choose to add it, which opens the form. */
async function openForm(text: string, routes = {}) {
  const calls = mockApi({ [search(text)]: { body: [] }, ...routes });
  const picked = setup();
  await userEvent.type(picked.field, text);
  await userEvent.click(await screen.findByRole("option", { name: `Add “${text}” as a new species` }));
  return { ...picked, calls, form: screen.getByRole("form", { name: "New species" }) };
}

describe("SpeciesPicker's new species", () => {
  it("puts the typed text in the likeliest field", () => {
    const empty = { scientific_name: "", name_en: "", name_pt: "" };
    expect(draftFrom(" Alcedo atthis ")).toEqual({ ...empty, scientific_name: "Alcedo atthis" });
    expect(draftFrom("Garça-real")).toEqual({ ...empty, name_pt: "Garça-real" });
    expect(draftFrom("guarda rios")).toEqual({ ...empty, name_en: "guarda rios" });
    expect(draftFrom("Grey Heron")).toEqual({ ...empty, name_en: "Grey Heron" });
  });

  it("needs the scientific name and an English or Portuguese name", async () => {
    const species = makeSpecies({ id: 9, scientific_name: "Alcedo atthis", name_en: null, name_pt: "Guarda-rios" });
    const { onPick, calls, form } = await openForm("Alcedo atthis", {
      "POST /species": { status: 201, body: species },
    });
    const add = within(form).getByRole("button", { name: "Add species" });
    expect(within(form).getByLabelText("Scientific name")).toHaveValue("Alcedo atthis");
    expect(add).toBeDisabled(); // no common name yet

    await userEvent.type(within(form).getByLabelText("Portuguese name"), "Guarda-rios");
    expect(add).toBeEnabled();
    await userEvent.clear(within(form).getByLabelText("Scientific name"));
    expect(add).toBeDisabled();
    await userEvent.type(within(form).getByLabelText("Scientific name"), "Alcedo atthis");

    await userEvent.click(add);
    expect(onPick).toHaveBeenCalledWith(species);
    expect(calls.at(-1)).toEqual({
      method: "POST",
      path: "/species",
      body: { scientific_name: "Alcedo atthis", name_en: null, name_pt: "Guarda-rios" },
    });
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("picks the existing species when it was there already", async () => {
    const { onPick, form } = await openForm("Grey Heron", {
      "POST /species": { status: 409, body: { detail: "exists", species_id: 1 } },
      "GET /species/1": { body: HERON },
    });
    await userEvent.type(within(form).getByLabelText("Scientific name"), "ardea cinerea");
    await userEvent.click(within(form).getByRole("button", { name: "Add species" }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(HERON));
  });

  it.each([
    ["a 409 that names no species", { status: 409, body: { detail: "In the trash" } }, "In the trash"],
    [
      "a network error",
      () => {
        throw new TypeError("offline");
      },
      "Could not add the species",
    ],
  ])("shows the problem for %s and stays open", async (_, reply, message) => {
    const { onPick, form } = await openForm("Grey Heron", { "POST /species": reply });
    await userEvent.type(within(form).getByLabelText("Scientific name"), "Ardea cinerea");
    await userEvent.click(within(form).getByRole("button", { name: "Add species" }));
    expect(await within(form).findByText(message)).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Add species" })).toBeEnabled();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("shows the 409 when the species it names can't be loaded", async () => {
    const { form } = await openForm("Grey Heron", {
      "POST /species": { status: 409, body: { detail: "exists", species_id: 1 } },
      "GET /species/1": { status: 404, body: { detail: "Species not found" } },
    });
    await userEvent.type(within(form).getByLabelText("Scientific name"), "Ardea cinerea");
    await userEvent.click(within(form).getByRole("button", { name: "Add species" }));
    expect(await within(form).findByText("exists")).toBeInTheDocument();
  });

  it("can be cancelled", async () => {
    const { form } = await openForm("Grey Heron");
    await userEvent.click(within(form).getByRole("button", { name: "Cancel new species" }));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });
});
