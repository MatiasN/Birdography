import { useOutletContext } from "react-router-dom";
import type { User } from "@/api";

/** What `Layout` hands the pages through the router's outlet. */
export type LayoutContext = {
  user: User;
  /** Replace the user after a change made on the profile page, such as the species name language. */
  setUser: (user: User) => void;
  logout: () => Promise<void>;
};
export const useLayout = () => useOutletContext<LayoutContext>();
