import { LogOutIcon, UserIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initial } from "@/lib/initial";
import { cn } from "cn";

type Props = {
  email: string;
  onLogout: () => void;
  /** Sidebar: avatar, and from 1280 px the email. Top bar: the avatar alone. */
  place: "sidebar" | "topbar";
};

/** The account menu: Profile and Log out, opened from the avatar (plan 0007 §5). */
export default function AccountMenu({ email, onLogout, place }: Props) {
  const sidebar = place === "sidebar";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account: ${email}`}
        className={cn(
          "flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          sidebar && "justify-center p-2 hover:bg-sidebar-accent xl:justify-start",
        )}
      >
        <Avatar>
          <AvatarFallback>{initial(email)}</AvatarFallback>
        </Avatar>
        {sidebar && <span className="hidden min-w-0 flex-1 truncate text-left text-sm xl:block">{email}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={sidebar ? "start" : "end"} side={sidebar ? "top" : "bottom"} className="w-56">
        <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile">
            <UserIcon />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onLogout}>
          <LogOutIcon />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
