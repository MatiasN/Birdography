import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

/** A pill in a list (a species on a photo, in the batch or in the filter), with a remove button when it can go. */
export default function Chip({
  label,
  onRemove,
  removeLabel = `Remove ${label}`,
  small,
  className,
}: {
  label: string;
  onRemove?: () => void;
  removeLabel?: string;
  small?: boolean;
  className?: string;
}) {
  return (
    <li
      className={cn(
        "inline-flex items-center gap-1 rounded-full border bg-background pr-0.5 pl-2.5 text-accent-foreground",
        small ? "py-0 text-xs" : "py-0.5 text-sm",
        !onRemove && "pr-2.5",
        className,
      )}
    >
      {label}
      {onRemove && (
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("rounded-full", small ? "size-5" : "size-6")}
          aria-label={removeLabel}
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      )}
    </li>
  );
}
