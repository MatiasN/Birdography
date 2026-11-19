import { createContext, useContext } from "react";
import { speciesName, speciesOtherNames, type NameLanguage, type Species } from "@/api";

/** The logged-in user's main name language, provided by `Layout`; English outside it (tests, the login page). */
export const NameLanguageContext = createContext<NameLanguage>("en");

/** Species names in the order the user chose on the profile page. */
export function useSpeciesNames() {
  const language = useContext(NameLanguageContext);
  return {
    language,
    name: (species: Species) => speciesName(species, language),
    otherNames: (species: Species) => speciesOtherNames(species, language),
  };
}
