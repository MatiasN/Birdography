import type { ReactNode } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type SegmentedOption<T extends string> = { value: T; label: ReactNode };

/** A segmented control (the profile's theme and species name choices): exactly one option is always chosen. */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      // Radix deselects when the chosen option is clicked again (""): keep the choice instead.
      onValueChange={(next) => {
        const option = options.find((o) => o.value === next);
        if (option && option.value !== value) onChange(option.value);
      }}
      disabled={disabled}
      aria-label={label}
      className="flex w-full rounded-lg bg-muted p-1"
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className="h-9 flex-1 gap-2 rounded-md text-muted-foreground hover:bg-transparent data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
