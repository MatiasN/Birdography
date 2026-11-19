import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import AccountMenu from "@/components/AccountMenu";
import UploadsProvider from "@/components/UploadsProvider";
import { inProgress, useUploads } from "@/hooks/useUploads";
import type { LayoutContext } from "@/hooks/useLayout";
import { cn } from "cn";
import { api, send, SESSION_EXPIRED, type User } from "@/api";
import { NameLanguageContext } from "@/hooks/useSpeciesNames";
import { pageTitle, TABS } from "@/nav";

/** setTimeout saturates at 2^31-1 ms (~25 days); longer waits just re-check when the timer fires. */
const MAX_DELAY_MS = 2 ** 31 - 1;

function Logo({ className }: { className?: string }) {
  return <img src="/logo.svg" alt="" className={className} />;
}

/**
 * How many files are still waiting or being sent, so it shows from any tab: a number on the Upload tab's icon, and
 * for screen readers after the tab's name ("Upload, 3 in progress").
 */
function UploadBadge({ spoken = false }: { spoken?: boolean }) {
  const { items } = useUploads();
  const count = items.filter(inProgress).length;
  if (count === 0) return null;
  if (spoken) return <span className="sr-only">, {count} in progress</span>;
  return (
    <span
      aria-hidden="true"
      className="absolute -top-1.5 -right-2 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground tabular-nums"
    >
      {count}
    </span>
  );
}

/** Wide screens (768 px and up): an icon rail, with labels beside the icons from 1280 px. */
function Sidebar({ email, onLogout }: { email: string; onLogout: () => void }) {
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-3 text-sidebar-foreground md:flex xl:w-60"
    >
      <Link to="/catalogue" className="mb-6 flex items-center justify-center gap-2 xl:justify-start xl:px-2">
        <Logo className="size-9" />
        <span className="sr-only text-lg font-semibold tracking-tight xl:not-sr-only">Birdography</span>
      </Link>
      <div className="flex flex-col gap-1">
        {TABS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] font-medium whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50 xl:flex-row xl:gap-3 xl:px-3 xl:text-sm",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )
            }
          >
            <span className="relative">
              <Icon className="size-5" aria-hidden="true" />
              {to === "/upload" && <UploadBadge />}
            </span>
            {label}
            {to === "/upload" && <UploadBadge spoken />}
          </NavLink>
        ))}
      </div>
      <div className="mt-auto">
        <AccountMenu email={email} onLogout={onLogout} place="sidebar" />
      </div>
    </nav>
  );
}

/** Narrow screens: a bar with the page title and the account menu on top, the five tabs at the bottom. */
function PhoneBars({ email, onLogout, title }: { email: string; onLogout: () => void; title: string }) {
  return (
    <>
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:hidden">
        <Logo className="size-7" />
        <p className="flex-1 text-lg font-semibold">{title}</p>
        <AccountMenu email={email} onLogout={onLogout} place="topbar" />
      </header>
      <nav
        aria-label="Tabs"
        className="fixed inset-x-0 bottom-0 z-20 flex h-(--tab-bar-height) border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {TABS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "group flex h-16 flex-1 flex-col items-center gap-1 pt-2 text-[11px] font-medium outline-none focus-visible:bg-accent",
                isActive ? "text-primary" : "text-muted-foreground",
              )
            }
          >
            <span className="grid h-7 w-14 place-items-center rounded-full group-aria-[current=page]:bg-accent">
              <span className="relative">
                <Icon className="size-5" aria-hidden="true" />
                {to === "/upload" && <UploadBadge />}
              </span>
            </span>
            {label}
            {to === "/upload" && <UploadBadge spoken />}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

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

  const logout = useCallback(async () => {
    await send("/auth/logout", { method: "POST" });
    await navigate("/login");
  }, [navigate]);

  if (!user) return null;

  const onLogout = () => void logout();
  return (
    <UploadsProvider>
      <div className="flex min-h-dvh bg-background text-foreground">
        <Sidebar email={user.email} onLogout={onLogout} />
        {/* Keeps the end of the page above the phone's bottom tab bar, home indicator included. */}
        <div className="flex min-w-0 flex-1 flex-col pb-(--tab-bar-height) md:pb-0">
          <PhoneBars email={user.email} onLogout={onLogout} title={pageTitle(location.pathname)} />
          <main className="flex flex-1 flex-col">
            <NameLanguageContext.Provider value={user.species_name_language}>
              <Outlet context={{ user, setUser, logout } satisfies LayoutContext} />
            </NameLanguageContext.Provider>
          </main>
        </div>
      </div>
    </UploadsProvider>
  );
}
