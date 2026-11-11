import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api, send, SESSION_EXPIRED, type User } from "./api";

const link = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1 rounded ${isActive ? "bg-emerald-700 text-white" : "hover:bg-emerald-100"}`;

/** setTimeout saturates at 2^31-1 ms (~25 days); longer waits just re-check when the timer fires. */
const MAX_DELAY_MS = 2 ** 31 - 1;

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<User>();

  const toLogin = useCallback(() => {
    const next = encodeURIComponent(location.pathname + location.search);
    void navigate(`/login?expired=1&next=${next}`);
  }, [navigate, location.pathname, location.search]);

  // Any 401 means the session ended: expired, or the password was changed elsewhere.
  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED, toLogin);
    return () => window.removeEventListener(SESSION_EXPIRED, toLogin);
  }, [toLogin]);

  useEffect(() => {
    api<User>("/auth/me").then(setUser, () => undefined); // a 401 fires SESSION_EXPIRED
  }, []);

  // Check again when the session is due to end, so an idle tab returns to the login page instead of sitting on
  // stale data. An active session was renewed meanwhile: the fresh expires_at just re-arms the timer.
  useEffect(() => {
    if (!user) return undefined;
    const delay = Math.min(Math.max(new Date(user.expires_at).getTime() - Date.now(), 0), MAX_DELAY_MS);
    const timer = setTimeout(() => void api<User>("/auth/me").then(setUser, () => undefined), delay);
    return () => clearTimeout(timer);
  }, [user]);

  async function logout() {
    await send("/auth/logout", { method: "POST" });
    await navigate("/login");
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
        <Link to="/account" className="ml-auto text-sm text-stone-500 hover:text-stone-800 hidden sm:inline">
          {user.email}
        </Link>
        <button onClick={() => void logout()} className="text-sm px-3 py-1 rounded hover:bg-stone-100">
          Log out
        </button>
      </header>
      <main className="flex-1 flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}
