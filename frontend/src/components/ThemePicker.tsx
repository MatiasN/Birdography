import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { setTheme, storedTheme, type Theme } from "@/theme";

const OPTIONS: { value: Theme; label: string; Icon: LucideIcon }[] = [
  { value: "system", label: "System", Icon: MonitorIcon },
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
];

/** The segmented System / Light / Dark control from the profile mockup. */
export default function ThemePicker() {
  const [theme, setChoice] = useState<Theme>(storedTheme);

  function choose(value: string) {
    const option = OPTIONS.find((o) => o.value === value);
    if (!option) return; // clicking the chosen one again deselects it in Radix; keep the choice instead
    setChoice(option.value);
    setTheme(option.value);
  }

  return (
    <ToggleGroup
      type="single"
      value={theme}
      onValueChange={choose}
      aria-label="Theme"
      className="flex w-full rounded-lg bg-muted p-1"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          className="h-9 flex-1 gap-2 rounded-md text-muted-foreground hover:bg-transparent data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs"
        >
          <Icon aria-hidden="true" />
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
