import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useState } from "react";
import Segmented, { type SegmentedOption } from "@/components/Segmented";
import { setTheme, storedTheme, type Theme } from "@/theme";

const OPTIONS: SegmentedOption<Theme>[] = [
  { value: "system", label: [<MonitorIcon key="icon" aria-hidden="true" />, "System"] },
  { value: "light", label: [<SunIcon key="icon" aria-hidden="true" />, "Light"] },
  { value: "dark", label: [<MoonIcon key="icon" aria-hidden="true" />, "Dark"] },
];

/** The segmented System / Light / Dark control from the profile mockup. */
export default function ThemePicker() {
  const [theme, setChoice] = useState<Theme>(storedTheme);
  return (
    <Segmented
      options={OPTIONS}
      value={theme}
      onChange={(value) => {
        setChoice(value);
        setTheme(value);
      }}
      label="Theme"
    />
  );
}
