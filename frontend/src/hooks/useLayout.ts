import { useOutletContext } from "react-router-dom";
import type { User } from "@/api";

/** What `Layout` hands the pages through the router's outlet. */
export type LayoutContext = { user: User; logout: () => Promise<void> };
export const useLayout = () => useOutletContext<LayoutContext>();
