import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

type Props = {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  /** A button or link to get started. */
  action?: ReactNode;
  /** A small pill under the text, such as "Coming in Phase 2". */
  note?: string;
  /** h1 when it is the whole page (the placeholders); h2 under a page's own heading (the Catalogue). */
  heading?: "h1" | "h2";
};

/** What a page shows when it has nothing yet: what the page is for and how to start (plan 0007 §4). */
export default function EmptyState({ icon: Icon, title, children, action, note, heading: Heading = "h1" }: Props) {
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
      <span className="grid size-16 place-items-center rounded-2xl bg-accent text-accent-foreground">
        <Icon className="size-8" aria-hidden="true" />
      </span>
      <Heading className="text-xl font-semibold tracking-tight">{title}</Heading>
      <p className="text-muted-foreground">{children}</p>
      {action}
      {note && (
        <Badge variant="outline" className="h-auto px-3 py-1 text-muted-foreground">
          {note}
        </Badge>
      )}
    </div>
  );
}
