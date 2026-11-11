import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makePhoto, mockApi } from "../test/api";
import MapPage from "./MapPage";

vi.mock("react-leaflet", () => import("../test/leaflet"));

describe("MapPage", () => {
  it("draws the latest located photos, each with its thumbnail in a popup", async () => {
    const calls = mockApi({
      "GET /photos?limit=200": {
        body: [makePhoto({ id: 1, lat: 37, lon: -8 }), makePhoto({ id: 2, lat: null, lon: null })],
      },
    });
    render(<MapPage />);
    const marker = await screen.findByTestId("marker");
    expect(screen.getAllByTestId("marker")).toHaveLength(1); // the photo without a position is left out
    expect(marker).toHaveAttribute("data-center", "37,-8");
    expect(marker.querySelector("img")).toHaveAttribute("src", "/api/photos/1/file?kind=thumbnail");
    expect(calls.map((c) => c.path)).toEqual(["/photos?limit=200"]);
  });
});
