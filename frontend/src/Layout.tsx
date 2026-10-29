import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api, type User } from "./api";

const link = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1 rounded ${isActive ? "bg-emerald-700 text-white" : "hover:bg-emerald-100"}`;

export default function Layout() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User>();

  useEffect(() => {
    api<User>("/auth/me").then(setUser, () => navigate("/login"));
  }, [navigate]);

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    navigate("/login");
  }

  if (!user) return null;

  return (
    <div className="min-h-screen flex flex-col bg-stone-50 text-stone-900">
      <header className="flex items-center gap-2 px-4 py-2 border-b bg-white">
        <span className="font-semibold mr-4">Birdography</span>
        <NavLink to="/" end className={link}>
          Photos
        </NavLink>
        <NavLink to="/map" className={link}>
          Map
        </NavLink>
        <span className="ml-auto text-sm text-stone-500 hidden sm:inline">{user.email}</span>
        <button onClick={logout} className="text-sm px-3 py-1 rounded hover:bg-stone-100">
          Log out
        </button>
      </header>
      <main className="flex-1 flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}
