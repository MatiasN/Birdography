import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "@/index.css";
import { routes } from "@/routes";
import { followSystemTheme } from "@/theme";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

followSystemTheme(); // public/theme.js set the first theme; this keeps "System" in step with the device

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={createBrowserRouter(routes)} />
  </StrictMode>,
);
