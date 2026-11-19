import { useState } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, ApiError, json, speciesName, speciesOtherNames, type NameLanguage, type Species, type User } from "@/api";

const OPTIONS: { value: NameLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "pt", label: "Portuguese" },
  { value: "sci", label: "Scientific" },
];

const EXAMPLE: Species = {
  id: 0,
  scientific_name: "Erithacus rubecula",
  name_en: "European Robin",
  name_pt: "Pisco-de-peito-ruivo",
};

/** Which species name comes first everywhere (plan 0009 D16), saved to the account, with an example. */
export default function NameLanguagePicker({ user, onChange }: { user: User; onChange: (user: User) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const language = user.species_name_language;

  async function choose(value: string) {
    const option = OPTIONS.find((o) => o.value === value);
    if (!option || option.value === language) return; // Radix deselects on a second click; keep the choice
    setSaving(true);
    setError(null);
    try {
      onChange(await api<User>("/auth/me", json("PATCH", { species_name_language: option.value })));
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : "Could not save the setting");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <ToggleGroup
        type="single"
        value={language}
        onValueChange={(value) => void choose(value)}
        disabled={saving}
        aria-label="Species names"
        className="flex w-full rounded-lg bg-muted p-1"
      >
        {OPTIONS.map(({ value, label }) => (
          <ToggleGroupItem
            key={value}
            value={value}
            className="h-9 flex-1 rounded-md text-muted-foreground hover:bg-transparent data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs"
          >
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="rounded-lg border bg-background px-3 py-2" aria-label="Example">
        <span className="block font-medium">{speciesName(EXAMPLE, language)}</span>
        <span className="block text-xs text-muted-foreground">{speciesOtherNames(EXAMPLE, language)}</span>
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}
    </div>
  );
}
