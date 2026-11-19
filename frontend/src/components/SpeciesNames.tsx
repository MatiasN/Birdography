import type { Species } from "@/api";
import { useSpeciesNames } from "@/hooks/useSpeciesNames";
import { cn } from "cn";

/** A species' name in the user's language, with its other names on a smaller second line. */
export default function SpeciesNames({ species, className }: { species: Species; className?: string }) {
  const { name, otherNames } = useSpeciesNames();
  return (
    <span className={cn("block min-w-0", className)}>
      <span className="block truncate font-medium">{name(species)}</span>
      <span className="block truncate text-xs text-muted-foreground">{otherNames(species)}</span>
    </span>
  );
}
