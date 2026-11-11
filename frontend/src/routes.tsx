import type { RouteObject } from "react-router-dom";
import Layout from "./Layout";
import Login from "./pages/Login";
import MapPage from "./pages/MapPage";
import Photos from "./pages/Photos";

export const routes: RouteObject[] = [
  { path: "/login", element: <Login /> },
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Photos /> },
      { path: "/map", element: <MapPage /> },
    ],
  },
];
