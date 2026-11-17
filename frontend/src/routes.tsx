import { Navigate, type RouteObject } from "react-router-dom";
import Layout from "@/Layout";
import Login from "@/pages/Login";
import Catalogue from "@/pages/Catalogue";
import { NearMe, Species } from "@/pages/Placeholders";
import Profile from "@/pages/Profile";

export const routes: RouteObject[] = [
  { path: "/login", element: <Login /> },
  {
    element: <Layout />,
    children: [
      // The old addresses still work: bookmarks, and `next=` links from before the tabs.
      { path: "/", element: <Navigate to="/catalogue" replace /> },
      { path: "/account", element: <Navigate to="/profile" replace /> },
      { path: "/catalogue", element: <Catalogue /> },
      { path: "/species", element: <Species /> },
      // Loaded when first opened, like the Map: the queue itself lives in Layout, so uploads don't wait for it.
      { path: "/upload", lazy: async () => ({ Component: (await import("@/pages/Upload")).default }) },
      // Loaded when the Map tab is first opened: Leaflet, supercluster and the clustering aren't needed elsewhere.
      { path: "/map", lazy: async () => ({ Component: (await import("@/pages/MapPage")).default }) },
      { path: "/near-me", element: <NearMe /> },
      { path: "/profile", element: <Profile /> },
    ],
  },
];
