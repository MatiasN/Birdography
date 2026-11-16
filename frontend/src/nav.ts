import { BirdIcon, ImagesIcon, LocateFixedIcon, MapIcon, UploadIcon, type LucideIcon } from "lucide-react";

export type Tab = { to: string; label: string; Icon: LucideIcon };

/** The five tabs, in the order of the sidebar and the bottom bar (plan 0007 §5). */
export const TABS: readonly Tab[] = [
  { to: "/catalogue", label: "Catalogue", Icon: ImagesIcon },
  { to: "/species", label: "Species", Icon: BirdIcon },
  { to: "/upload", label: "Upload", Icon: UploadIcon },
  { to: "/map", label: "Map", Icon: MapIcon },
  { to: "/near-me", label: "Near me", Icon: LocateFixedIcon },
];

/** The phone top bar's title for a path: its tab, or the profile page. */
export function pageTitle(pathname: string): string {
  if (pathname.startsWith("/profile")) return "Profile";
  return TABS.find((tab) => pathname.startsWith(tab.to))?.label ?? "Birdography";
}
