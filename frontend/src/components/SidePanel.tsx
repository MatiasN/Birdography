import { XIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

type Props = {
  title: string;
  onClose: () => void;
  /** Extra buttons in the title bar, before Close (the map's "Zoom in"). */
  actions?: ReactNode;
  /** False while something opened from this panel handles Escape itself (a photo opened from a map group). */
  closeOnEscape?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * The non-modal panel beside the grid or the map on wide screens (plan 0007 §6): the page behind stays usable,
 * so this is a plain region, not a dialog. Phones get a full-screen Sheet instead.
 */
export default function SidePanel({ title, onClose, actions, closeOnEscape = true, className, children }: Props) {
  useEffect(() => {
    if (!closeOnEscape) return undefined;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeOnEscape, onClose]);

  return (
    <aside
      aria-label={title}
      className={cn("flex h-dvh w-[420px] shrink-0 flex-col border-l bg-card text-card-foreground", className)}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <h2 className="flex-1 truncate font-semibold">{title}</h2>
        {actions}
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose} className="text-muted-foreground">
          <XIcon className="size-5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}
