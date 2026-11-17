import { ArrowLeftIcon } from "lucide-react";
import { useRef, type ReactNode } from "react";
import SidePanel from "@/components/SidePanel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery, WIDE } from "@/hooks/useMediaQuery";

type Props = {
  title: string;
  onClose: () => void;
  /** Buttons in the title bar (the map's "Zoom in"). */
  actions?: ReactNode;
  children: ReactNode;
};

/**
 * Details beside the page on wide screens, a full-screen sheet on phones (plan 0007 §6). The side panel leaves the
 * page usable; the sheet is modal, so Radix traps focus, hides the rest from screen readers and handles Escape.
 */
export default function ResponsivePanel({ title, onClose, actions, children }: Props) {
  const wide = useMediaQuery(WIDE);
  // The sheet has no Radix trigger, so Radix can't return focus on close by itself: remember what opened it.
  const opener = useRef(document.activeElement);

  if (wide) {
    return (
      <SidePanel title={title} onClose={onClose} actions={actions} className="sticky top-0">
        {children}
      </SidePanel>
    );
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener.current instanceof HTMLElement) opener.current.focus();
        }}
        className="top-0 gap-0 bg-background p-0 motion-reduce:animate-none data-[side=bottom]:h-dvh data-[side=bottom]:border-t-0"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b px-2">
          <Button variant="ghost" size="icon" aria-label="Back" onClick={onClose}>
            <ArrowLeftIcon className="size-5" />
          </Button>
          <SheetTitle className="flex-1 truncate font-semibold">{title}</SheetTitle>
          {actions}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
