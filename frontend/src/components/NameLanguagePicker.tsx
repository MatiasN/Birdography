import ErrorAlert from "@/components/ErrorAlert";
import Segmented, { type SegmentedOption } from "@/components/Segmented";
import SpeciesNames from "@/components/SpeciesNames";
import { api, json, type NameLanguage, type Species, type User } from "@/api";
import { useLayout } from "@/hooks/useLayout";
import { useSave } from "@/hooks/useSave";

const OPTIONS: SegmentedOption<NameLanguage>[] = [
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
export default function NameLanguagePicker() {
  const { user, setUser } = useLayout();
  const { saving, error, run } = useSave();

  const choose = (language: NameLanguage) =>
    void run(
      async () => setUser(await api<User>("/auth/me", json("PATCH", { species_name_language: language }))),
      "Could not save the setting",
    );

  return (
    <div className="space-y-3">
      <Segmented
        options={OPTIONS}
        value={user.species_name_language}
        onChange={choose}
        label="Species names"
        disabled={saving}
      />
      <p className="rounded-lg border bg-background px-3 py-2" aria-label="Example">
        <SpeciesNames species={EXAMPLE} />
      </p>
      <ErrorAlert message={error} />
    </div>
  );
}
