import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SESSION_EXPIRED } from "@/api";
import UploadsProvider from "@/components/UploadsProvider";
import { useUploads } from "@/hooks/useUploads";
import Upload from "@/pages/Upload";
import { health, makePhoto, makeSpecies, mockApi, type Call, type Routes } from "@/test/api";
import { renderAt } from "@/test/router";
import { stubXhr, type FakeXhr } from "@/test/xhr";
import { cameraJpeg } from "@/test/exif";
import { readFileSync } from "node:fs";

const MB = 1024 * 1024;
const HERON = makeSpecies({ id: 1 });
const EGRET = makeSpecies({ id: 2, scientific_name: "Egretta garzetta", name_en: "Little Egret", name_pt: null });

function file(name: string, size = 1000, type = "image/jpeg") {
  const made = new File(["x"], name, { type });
  Object.defineProperty(made, "size", { value: size });
  return made;
}

/** The Upload tab inside its provider, with the limits loaded. */
async function start(routes: Routes = {}) {
  const calls = mockApi({ "GET /health": { body: health }, ...routes });
  const sent = stubXhr();
  const router = renderAt(
    <UploadsProvider>
      <Upload />
    </UploadsProvider>,
    "/upload",
  );
  if (!routes["GET /health"]) await screen.findByText(/up to 40 MB, 70 MB for RAW/);
  return { calls, sent, router };
}

/** The real NEF sample (shrunk) under another name, and a camera JPEG with the given date and model. */
const NEF_TAKEN = "2025:04:27 17:57:05";
const nef = (name: string) => new File([readFileSync("../backend/tests/fixtures/raw/nikon_z5_2.nef")], name);
const exifJpeg = (name: string, taken: string, model?: string, subsec?: string) =>
  new File([new Uint8Array(cameraJpeg(taken, model, subsec))], name, { type: "image/jpeg" });

const input = () => screen.getByTestId<HTMLInputElement>("file-input");
const choose = (...files: File[]) => fireEvent.change(input(), { target: { files } });
const row = (name: string) => screen.getByText(name).closest("li")!;
const answer = (xhr: FakeXhr, status: number, body: unknown) => act(() => xhr.respond(status, body));
const lose = (xhr: FakeXhr) => act(() => xhr.fail());

async function pickSpecies(field: HTMLElement, text: string, option: RegExp) {
  mockApiAdd({ [`GET /species?q=${text}&limit=8`]: { body: [HERON, EGRET] } });
  await userEvent.type(field, text);
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

/** The routes of the current test, so a helper can add to them. */
let routesNow: Routes = {};
let callsNow: Call[] = [];
function mockApiAdd(routes: Routes) {
  routesNow = { ...routesNow, ...routes };
  callsNow = mockApi(routesNow);
}

describe("Upload", () => {
  it("offers the photo picker for every supported type, with the limits", async () => {
    await start();
    expect(screen.getByRole("button", { name: "Choose photos" })).toBeInTheDocument();
    expect(input().accept).toContain(".nef");
    expect(input().accept).toContain(".heic");
    expect(input().multiple).toBe(true);
    expect(screen.queryByRole("list", { name: "Files" })).not.toBeInTheDocument();
  });

  it("opens the picker from the button", async () => {
    await start();
    const click = vi.spyOn(input(), "click").mockImplementation(() => undefined);
    await userEvent.click(screen.getByRole("button", { name: "Choose photos" }));
    expect(click).toHaveBeenCalledOnce();
  });

  it("sends two files at a time, showing each one's progress, then the next", async () => {
    const { sent } = await start();
    choose(file("a.jpg"), file("b.nef", 50 * MB, ""), file("c.jpg"));
    expect(input().value).toBe("");

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map((xhr) => [xhr.method, xhr.url, xhr.form.file])).toEqual([
      ["POST", "/api/photos", "a.jpg"],
      ["POST", "/api/photos", "b.nef"],
    ]);
    expect(within(row("c.jpg")).getByText("Waiting")).toBeInTheDocument();
    expect(row("a.jpg").querySelector("img")).toHaveAttribute("src", expect.stringMatching(/^blob:/));
    expect(row("b.nef").querySelector("img")).toBeNull(); // RAW: an icon, not a preview

    act(() => sent[0].progress(1, 4));
    expect(within(row("a.jpg")).getByText("25%")).toBeInTheDocument();
    expect(within(row("a.jpg")).getByRole("progressbar", { name: "Uploading a.jpg" })).toHaveValue(25);
    act(() => sent[0].progress(1, 4, false)); // a size the browser doesn't know: no change
    expect(within(row("a.jpg")).getByText("25%")).toBeInTheDocument();

    await answer(sent[0], 201, makePhoto({ id: 11 }));
    expect(within(row("a.jpg")).getByText("Done")).toBeInTheDocument();
    expect(within(row("a.jpg")).getByRole("link", { name: "Open" })).toHaveAttribute("href", "/catalogue?photo=11");
    expect(screen.getByText("1 of 3 uploaded")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View in catalogue" })).toHaveAttribute("href", "/catalogue");
    await waitFor(() => expect(sent).toHaveLength(3)); // the third starts when one finishes
    expect(sent[2].form.file).toBe("c.jpg");
  });

  it("refuses files over the limit without sending them", async () => {
    const { sent } = await start();
    choose(file("big.jpg", 41 * MB), file("huge.nef", 71 * MB, ""), file("ok.nef", 69 * MB, ""));
    expect(within(row("big.jpg")).getByText(/big\.jpg: .*40 MB/)).toBeInTheDocument();
    expect(within(row("huge.nef")).getByText(/70 MB/)).toBeInTheDocument();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].form.file).toBe("ok.nef");
    expect(within(row("big.jpg")).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("pairs a RAW and a JPEG with the same name into one photo, the JPEG as its preview", async () => {
    const { sent } = await start();
    choose(
      file("DSC_0001.JPG", 11 * MB),
      file("DSC_0001.NEF", 52 * MB, ""),
      file("DSC_0002.NEF", 50 * MB, ""),
      file("other.jpg"),
      file("IMG_0412.HEIC", 1000, "image/heic"), // neither RAW nor JPEG: never part of a pair
    );
    expect(screen.getByRole("list", { name: "Files" }).children).toHaveLength(4);
    const pair = row("DSC_0001.NEF");
    expect(pair).toHaveTextContent("DSC_0001.NEF + DSC_0001.JPG");
    expect(pair).toHaveTextContent("52.0 MB + 11.0 MB");
    expect(pair).toHaveTextContent("RAW+JPEG pair, the JPEG becomes the preview");
    expect(pair.querySelector("img")).toHaveAttribute("src", expect.stringMatching(/^blob:/)); // the JPEG's
    expect(row("DSC_0002.NEF").querySelector("img")).toBeNull();

    // These test files have no EXIF: the check can't tell, says so, and lets the pair go.
    expect(await within(pair).findByText(/Couldn't check that the JPEG belongs to this RAW/)).toBeInTheDocument();
    await waitFor(() => expect(sent).toHaveLength(2)); // the two others got there first: the pair was checking
    await answer(sent[0], 201, makePhoto({ id: 1 }));
    await waitFor(() => expect(sent.map((x) => x.form.file)).toContain("DSC_0001.NEF"));
    expect(sent.find((x) => x.form.file === "DSC_0001.NEF")?.form.companion).toBe("DSC_0001.JPG");
  });

  it("sends a pair whose files are the same shot without a word", async () => {
    const { sent } = await start();
    choose(nef("DSC_0001.NEF"), exifJpeg("DSC_0001.JPG", NEF_TAKEN));
    expect(within(row("DSC_0001.NEF")).getByText("Checking…")).toBeInTheDocument();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].form).toEqual({ file: "DSC_0001.NEF", companion: "DSC_0001.JPG", species: [] });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(row("DSC_0001.NEF")).not.toHaveTextContent(/belong/);
  });

  it("holds a pair that looks like two shots until the user keeps it", async () => {
    const { sent } = await start();
    choose(nef("DSC_0001.NEF"), exifJpeg("DSC_0001.JPG", "2025:04:27 17:57:07"), file("next.jpg"));
    const notice = await within(row("DSC_0001.NEF")).findByRole("alert");
    expect(notice).toHaveTextContent(
      "The JPEG may not belong to this RAW: taken at 17:57:07, the RAW at 17:57:05. Upload them as one photo anyway",
    );
    expect(within(row("DSC_0001.NEF")).getByText("Waiting for you")).toBeInTheDocument();
    expect(screen.getByText(/A RAW\+JPEG pair looks like two different shots/)).toBeInTheDocument();
    await waitFor(() => expect(sent).toHaveLength(1)); // the next file goes; the pair doesn't
    expect(sent[0].form.file).toBe("next.jpg");

    await userEvent.click(within(notice).getByRole("button", { name: "Upload as a pair" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].form).toEqual({ file: "DSC_0001.NEF", companion: "DSC_0001.JPG", species: [] });
    expect(screen.queryByText(/pairs? looks? like two different shots/)).not.toBeInTheDocument();
    expect(row("DSC_0001.NEF")).toHaveTextContent("uploaded as a pair, as you chose");
  });

  it("counts every held pair, and sends each file of one on its own once separated", async () => {
    const { sent } = await start();
    choose(
      nef("DSC_0001.NEF"),
      exifJpeg("DSC_0001.JPG", NEF_TAKEN, "Canon EOS R5"),
      nef("DSC_0002.NEF"),
      exifJpeg("DSC_0002.JPG", NEF_TAKEN, "NIKON Z5_2", "12"),
    );
    expect(await screen.findByText(/2 RAW\+JPEG pairs look like two different shots/)).toBeInTheDocument();
    expect(within(row("DSC_0001.NEF")).getByRole("alert")).toHaveTextContent(
      "taken with a NIKON CORPORATION Canon EOS R5",
    );
    expect(within(row("DSC_0002.NEF")).getByRole("alert")).toHaveTextContent("not at the same instant");

    await userEvent.click(
      within(within(row("DSC_0001.NEF")).getByRole("alert")).getByRole("button", { name: "Separate" }),
    );
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map((x) => x.form)).toEqual([
      { file: "DSC_0001.NEF", companion: null, species: [] },
      { file: "DSC_0001.JPG", companion: null, species: [] },
    ]);
    expect(screen.getByText(/A RAW\+JPEG pair looks/)).toBeInTheDocument(); // the other one still waits
  });

  it("lets a JPEG join a RAW still waiting from before, checking them then", async () => {
    const { sent } = await start();
    choose(file("a.nef", 1000, ""), file("b.nef", 1000, ""), nef("dsc_0003.nef"));
    await waitFor(() => expect(sent).toHaveLength(2)); // a and b are going; dsc_0003 waits
    choose(exifJpeg("DSC_0003.JPG", "2025:04:27 18:00:00"), file("A.JPG"), file("b.jpg"));
    expect(row("dsc_0003.nef")).toHaveTextContent("dsc_0003.nef + DSC_0003.JPG");
    expect(row("A.JPG")).not.toHaveTextContent("+"); // a.nef is being sent: too late to join it
    expect(row("b.jpg")).not.toHaveTextContent("+");
    expect(await within(row("dsc_0003.nef")).findByRole("alert")).toHaveTextContent("taken at 18:00:00");
    await answer(sent[0], 201, makePhoto({ id: 1 }));
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2].form.file).toBe("A.JPG"); // the held pair stays behind
  });

  it("ignores a check that finishes after its pair was separated", async () => {
    const { sent } = await start();
    choose(nef("DSC_0001.NEF"), exifJpeg("DSC_0001.JPG", "2025:04:27 17:59:00"));
    await userEvent.click(screen.getByRole("button", { name: "Upload DSC_0001.NEF and DSC_0001.JPG separately" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refuses a pair whose JPEG is over the limit, and sends the RAW on its own once separated", async () => {
    const { sent } = await start();
    choose(file("a.nef", 1000, ""), file("b.nef", 1000, ""), file("c.nef", 1000, ""), file("c.jpg", 41 * MB));
    expect(within(row("c.nef")).getByText(/c\.jpg: .*40 MB/)).toBeInTheDocument();
    await waitFor(() => expect(sent).toHaveLength(2));
    await userEvent.click(screen.getByRole("button", { name: "Upload c.nef and c.jpg separately" }));
    expect(within(row("c.jpg")).getByText(/40 MB/)).toBeInTheDocument(); // still too large alone
    expect(within(row("c.nef")).getByText("Waiting")).toBeInTheDocument();
    await answer(sent[0], 201, makePhoto({ id: 1 }));
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2].form).toEqual({ file: "c.nef", companion: null, species: [] });
  });

  it("explains a pair the proxy refused as too large together, and lets it go separately", async () => {
    const { sent } = await start();
    choose(file("big.nef", 60 * MB, ""), file("big.jpg", 30 * MB));
    await waitFor(() => expect(sent).toHaveLength(1));
    await answer(sent[0], 413, "<html><body>413 Request Entity Too Large</body></html>"); // nginx's page
    expect(within(row("big.nef")).getByText("Too large for the server's request limit")).toBeInTheDocument();
    expect(within(row("big.nef")).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Upload big.nef and big.jpg separately" }));
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent.slice(1).map((x) => [x.form.file, x.form.companion])).toEqual([
      ["big.nef", null],
      ["big.jpg", null],
    ]);
  });

  it("gives a second JPEG for the same waiting RAW, or one that fails, its own row", async () => {
    const { sent } = await start();
    choose(file("a.nef", 1000, ""), file("b.nef", 1000, ""), file("c.nef", 1000, ""), file("d.nef", 1000, ""));
    await waitFor(() => expect(sent).toHaveLength(2));
    choose(file("c.jpg", 1000, ""), file("C.JPG")); // the first joins c.nef (no preview from an unknown type)
    expect(row("c.nef")).toHaveTextContent("c.nef + c.jpg");
    expect(row("c.nef").querySelector("img")).toBeNull();
    expect(row("C.JPG")).not.toHaveTextContent("+");
    choose(file("d.jpg", 41 * MB)); // joins d.nef, which then can't be sent
    expect(within(row("d.nef")).getByText(/d\.jpg: .*40 MB/)).toBeInTheDocument();
  });

  it("sends everything when the limits couldn't be loaded, leaving it to the server", async () => {
    const { sent } = await start({ "GET /health": { status: 500, body: {} } });
    choose(file("big.jpg", 41 * MB));
    await waitFor(() => expect(sent).toHaveLength(1));
  });

  it("does nothing when the browser gives no file list", async () => {
    const { sent } = await start();
    fireEvent.change(input(), { target: { files: null } });
    expect(sent).toHaveLength(0);
    expect(screen.queryByRole("list", { name: "Files" })).not.toBeInTheDocument();
  });

  it("takes files dropped anywhere on the tab, highlighting the drop zone meanwhile", async () => {
    const { sent } = await start();
    const zone = screen.getByText("Drop photos here").parentElement!;
    const page = zone.parentElement!;
    fireEvent.dragOver(page);
    expect(zone).toHaveClass("border-primary");
    fireEvent.dragLeave(zone); // leaving a child keeps it
    expect(zone).toHaveClass("border-primary");
    fireEvent.dragLeave(page);
    expect(zone).not.toHaveClass("border-primary");
    fireEvent.dragOver(page);
    fireEvent.drop(page, { dataTransfer: { files: [file("dropped.jpg")] } });
    expect(zone).not.toHaveClass("border-primary");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].form.file).toBe("dropped.jpg");
  });

  it.each([
    [
      409,
      { detail: "This file has already been uploaded", photo_id: 4 },
      "Already in your catalogue",
      "/catalogue?photo=4",
    ],
    [409, { detail: "This file has already been uploaded" }, "Already in your catalogue", null],
    [415, { detail: "Unsupported file type" }, "Unsupported file type", null],
  ])("shows why the server refused a file (%i), with no retry", async (status, body, message, link) => {
    const { sent } = await start();
    choose(file("a.jpg"));
    await waitFor(() => expect(sent).toHaveLength(1));
    await answer(sent[0], status, body);
    const shown = row("a.jpg");
    expect(within(shown).getByText(message)).toBeInTheDocument();
    expect(within(shown).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(within(shown).queryByRole("link", { name: "Open" })?.getAttribute("href") ?? null).toBe(link);
    expect(within(shown).queryByRole("button", { name: /Add species/ })).not.toBeInTheDocument();
  });

  it("offers a retry after a lost connection or a server error, and sends the file again", async () => {
    const { sent } = await start();
    choose(file("a.jpg"), file("b.jpg"));
    await waitFor(() => expect(sent).toHaveLength(2));
    await lose(sent[0]);
    await answer(sent[1], 502, "<html>Bad gateway</html>"); // a proxy's page, not JSON
    expect(within(row("a.jpg")).getByText("The connection was lost")).toBeInTheDocument();
    expect(within(row("b.jpg")).getByText("Failed")).toBeInTheDocument(); // the status text, lacking a detail

    await userEvent.click(within(row("a.jpg")).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2].form.file).toBe("a.jpg");
    expect(within(row("a.jpg")).getByText("0%")).toBeInTheDocument();
  });

  it("ends the session on a 401 like any other request, keeping the file to retry", async () => {
    const expired = vi.fn<() => void>();
    window.addEventListener(SESSION_EXPIRED, expired);
    const { sent } = await start();
    choose(file("a.jpg"));
    await waitFor(() => expect(sent).toHaveLength(1));
    await answer(sent[0], 401, { detail: "Not authenticated" });
    window.removeEventListener(SESSION_EXPIRED, expired);
    expect(expired).toHaveBeenCalledOnce();
    expect(within(row("a.jpg")).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("names a failure by its status when there is no text for it", async () => {
    const { sent } = await start();
    choose(file("a.jpg"));
    await waitFor(() => expect(sent).toHaveLength(1));
    await act(() => sent[0].respond(500, "", ""));
    expect(within(row("a.jpg")).getByText("Upload failed")).toBeInTheDocument();
  });

  it("clears what is finished, keeping what is still going", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const { sent } = await start();
    choose(file("a.jpg"), file("b.nef", 1000, ""), file("c.jpg"));
    await waitFor(() => expect(sent).toHaveLength(2));
    await answer(sent[0], 201, makePhoto({ id: 1 }));
    await answer(sent[1], 409, { detail: "dup" });
    await userEvent.click(screen.getByRole("button", { name: "Clear finished" }));
    expect(screen.queryByText("a.jpg")).not.toBeInTheDocument();
    expect(screen.queryByText("b.nef")).not.toBeInTheDocument();
    expect(screen.getByText("c.jpg")).toBeInTheDocument();
    expect(revoke).toHaveBeenCalledOnce(); // a.jpg's preview; b.nef had none
  });

  it("asks before the browser tab closes while files are going", async () => {
    const { sent } = await start();
    const before = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);

    choose(file("a.jpg"));
    await waitFor(() => expect(sent).toHaveLength(1));
    const during = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);

    await answer(sent[0], 201, makePhoto({ id: 1 }));
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});

describe("Upload species", () => {
  it("sends the batch's species with every file, and adds them to the files still waiting", async () => {
    routesNow = { "GET /health": { body: health } };
    const { sent } = await start(routesNow);
    choose(file("a.jpg"), file("b.jpg"), file("c.jpg")); // c waits; a and b are sent without species
    await waitFor(() => expect(sent).toHaveLength(2));

    await pickSpecies(screen.getByRole("combobox", { name: "Add a species for the batch" }), "heron", /Grey Heron/);
    const batch = screen.getByRole("list", { name: "Species for every photo in this batch" });
    expect(within(batch).getByText("Grey Heron")).toBeInTheDocument();
    expect(within(row("c.jpg")).getByText("Grey Heron")).toBeInTheDocument();
    expect(within(row("a.jpg")).queryByText("Grey Heron")).not.toBeInTheDocument(); // already on its way

    choose(file("d.jpg"));
    expect(within(row("d.jpg")).getByText("Grey Heron")).toBeInTheDocument(); // later files get it too
    await answer(sent[0], 201, makePhoto({ id: 1 }));
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2].form).toEqual({ file: "c.jpg", companion: null, species: ["1"] });

    // While being sent, a file's species can't change.
    expect(within(row("c.jpg")).queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    expect(within(row("c.jpg")).queryByRole("button", { name: /Add species/ })).not.toBeInTheDocument();

    await userEvent.click(within(batch).getByRole("button", { name: "Remove Grey Heron" }));
    expect(screen.queryByRole("list", { name: "Species for every photo in this batch" })).not.toBeInTheDocument();
    expect(within(row("d.jpg")).queryByText("Grey Heron")).not.toBeInTheDocument();
    expect(within(row("c.jpg")).getByText("Grey Heron")).toBeInTheDocument();
  });

  it("changes one waiting file's species before it is sent", async () => {
    routesNow = { "GET /health": { body: health } };
    const { sent } = await start(routesNow);
    choose(file("a.jpg"), file("b.jpg"), file("c.jpg"));
    await waitFor(() => expect(sent).toHaveLength(2));

    await userEvent.click(within(row("c.jpg")).getByRole("button", { name: "Add species to c.jpg" }));
    await pickSpecies(screen.getByRole("combobox", { name: "Species for c.jpg" }), "egret", /Little Egret/);
    await userEvent.click(within(row("c.jpg")).getByRole("button", { name: "Add species to c.jpg" }));
    await pickSpecies(screen.getByRole("combobox", { name: "Species for c.jpg" }), "heron", /Grey Heron/);
    await userEvent.click(within(row("c.jpg")).getByRole("button", { name: "Remove Little Egret" }));
    await userEvent.click(within(row("c.jpg")).getByRole("button", { name: "Add species to c.jpg" }));
    await userEvent.click(within(row("c.jpg")).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("combobox", { name: "Species for c.jpg" })).not.toBeInTheDocument();

    // The batch gaining a species the file has already doesn't add it twice.
    await pickSpecies(screen.getByRole("combobox", { name: "Add a species for the batch" }), "heron", /Grey Heron/);
    expect(within(row("c.jpg")).getAllByText("Grey Heron")).toHaveLength(1);

    await answer(sent[0], 201, makePhoto({ id: 1 }));
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2].form).toEqual({ file: "c.jpg", companion: null, species: ["1"] });
  });

  it("saves a species change on an uploaded photo, and says when it doesn't save", async () => {
    routesNow = { "GET /health": { body: health } };
    const { sent } = await start(routesNow);
    choose(file("a.jpg"));
    await waitFor(() => expect(sent).toHaveLength(1));
    await answer(sent[0], 201, makePhoto({ id: 7, species: [HERON] }));
    expect(within(row("a.jpg")).getByText("Grey Heron")).toBeInTheDocument(); // as the server stored them

    mockApiAdd({ "PATCH /photos/7": { status: 400, body: { detail: "Unknown species" } } });
    await userEvent.click(within(row("a.jpg")).getByRole("button", { name: "Remove Grey Heron" }));
    expect(await within(row("a.jpg")).findByText("Unknown species")).toBeInTheDocument();

    mockApiAdd({
      "PATCH /photos/7": () => {
        throw new TypeError("offline");
      },
    });
    await userEvent.click(within(row("a.jpg")).getByRole("button", { name: "Remove Grey Heron" }));
    expect(await within(row("a.jpg")).findByText("Could not save the species")).toBeInTheDocument();

    mockApiAdd({ "PATCH /photos/7": { body: makePhoto({ id: 7, species: [] }) } });
    await userEvent.click(within(row("a.jpg")).getByRole("button", { name: "Remove Grey Heron" }));
    await waitFor(() => expect(within(row("a.jpg")).queryByText("Grey Heron")).not.toBeInTheDocument());
    expect(within(row("a.jpg")).queryByText("Could not save the species")).not.toBeInTheDocument();

    mockApiAdd({ "PATCH /photos/7": { body: makePhoto({ id: 7, species: [EGRET] }) } });
    await userEvent.click(within(row("a.jpg")).getByRole("button", { name: "Add species to a.jpg" }));
    await pickSpecies(screen.getByRole("combobox", { name: "Species for a.jpg" }), "egret", /Little Egret/);
    expect(await within(row("a.jpg")).findByText("Little Egret")).toBeInTheDocument();
    expect(callsNow.at(-1)?.body).toEqual({ species_ids: [2] });
  });

  it("changes the species of a file that failed and can be retried", async () => {
    routesNow = { "GET /health": { body: health } };
    const { sent } = await start(routesNow);
    choose(file("a.jpg"));
    await waitFor(() => expect(sent).toHaveLength(1));
    await lose(sent[0]);
    await userEvent.click(within(row("a.jpg")).getByRole("button", { name: "Add species to a.jpg" }));
    await pickSpecies(screen.getByRole("combobox", { name: "Species for a.jpg" }), "heron", /Grey Heron/);
    await userEvent.click(within(row("a.jpg")).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].form.species).toEqual(["1"]);
  });
});

function Orphan() {
  useUploads();
  return null;
}

/** Drives the queue directly, for what the Upload tab's own buttons never ask for. */
function Separator() {
  const { items, add, unpair } = useUploads();
  return (
    <>
      <button onClick={() => add([file("lone.nef", 1000, "")])}>add</button>
      <button onClick={() => unpair(items[0]?.key ?? 0)}>separate first</button>
      <button onClick={() => unpair(999)}>separate none</button>
      <output>{items.map((i) => `${i.file.name}:${i.companion?.name ?? "-"}`).join(" ")}</output>
    </>
  );
}

describe("useUploads", () => {
  it("leaves the queue alone when asked to separate what isn't a waiting pair", async () => {
    stubXhr();
    render(
      <UploadsProvider>
        <Separator />
      </UploadsProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "separate none" }));
    expect(screen.getByRole("status")).toHaveTextContent("");
    await userEvent.click(screen.getByRole("button", { name: "add" }));
    await userEvent.click(screen.getByRole("button", { name: "separate first" })); // no companion: nothing to split
    await userEvent.click(screen.getByRole("button", { name: "separate none" }));
    expect(screen.getByRole("status")).toHaveTextContent("lone.nef:-");
  });

  it("needs the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined); // React logs the error it rethrows
    expect(() => render(<Orphan />)).toThrow("useUploads needs an UploadsProvider above it");
  });
});
