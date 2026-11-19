import { PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import ErrorAlert from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { api, ApiError, json, type Species } from "@/api";
import SpeciesNames from "@/components/SpeciesNames";
import { useSave } from "@/hooks/useSave";
import { cn } from "cn";

/** How long typing pauses before the search runs. */
const SEARCH_DELAY_MS = 200;
const RESULTS = 8;

type Props = {
  /** Called with the species chosen, or the one just created. */
  onPick: (species: Species) => void;
  /** Species already chosen, left out of the results. */
  exclude?: number[];
  /** Offer "Add … as a new species" (the photo detail, uploads); off where the picker only filters. */
  allowCreate?: boolean;
  /** Search only the species the user has photographed (the Catalogue's filter); otherwise all of them. */
  photographed?: boolean;
  label?: string;
  /** Focus the field when it appears, as after clicking "Add species". */
  focusOnMount?: boolean;
  className?: string;
};

type Draft = { scientific_name: string; name_en: string; name_pt: string };
type Option = { kind: "species"; species: Species } | { kind: "create" };

/** Two words, the genus capitalised: "Ardea cinerea". */
const BINOMIAL = /^[A-Z][a-z]+ [a-z]+$/;
/** Letters and hyphens English bird names don't use: "Garça-real". */
const PORTUGUESE = /[çãõáéíóúâêôà-]/i;

/** The typed text, put in the field it most likely belongs to. */
export function draftFrom(text: string): Draft {
  const value = text.trim();
  const draft = { scientific_name: "", name_en: "", name_pt: "" };
  if (BINOMIAL.test(value)) return { ...draft, scientific_name: value };
  if (PORTUGUESE.test(value)) return { ...draft, name_pt: value };
  return { ...draft, name_en: value };
}

/**
 * Search species by any of their three names and pick one (plan 0008 §5): an ARIA combobox whose list opens in a
 * popover under the field. With `allowCreate`, the last option adds the text as a new species: the scientific
 * name and at least one common name, English or Portuguese.
 */
export default function SpeciesPicker({
  onPick,
  exclude = [],
  allowCreate = true,
  photographed = false,
  label = "Species",
  focusOnMount = false,
  className,
}: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Species[] | null>(null); // null: not searched for this text yet
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (focusOnMount) input.current?.focus();
  }, [focusOnMount]);

  const text = query.trim();
  useEffect(() => {
    if (!text) return undefined;
    let current = true;
    const timer = setTimeout(() => {
      api<Species[]>(
        `/species?q=${encodeURIComponent(text)}&limit=${RESULTS}${photographed ? "&photographed=true" : ""}`,
      ).then(
        (found) => current && setResults(found),
        () => current && setError("Could not search the species"),
      );
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text, photographed]);

  const shown = (results ?? []).filter((species) => !exclude.includes(species.id));
  const options: Option[] = [
    ...shown.map((species): Option => ({ kind: "species", species })),
    ...(allowCreate && results !== null ? [{ kind: "create" } as const] : []),
  ];
  const open = text !== "" && results !== null && !dismissed;
  const optionId = (index: number) => `${id}-option-${index}`;

  function type(value: string) {
    setQuery(value);
    setResults(null);
    setActive(0);
    setDismissed(false);
    setError(null);
  }

  function choose(option: Option) {
    if (option.kind === "create") setDraft(draftFrom(text));
    else onPick(option.species);
    type("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => Math.min(Math.max(index + step, 0), options.length - 1));
    } else if (event.key === "Enter" && options[active]) {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === "Escape") {
      event.stopPropagation(); // closes the list, not the panel around it
      setDismissed(true);
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <Popover open={open} onOpenChange={(next) => !next && setDismissed(true)}>
        <PopoverAnchor asChild>
          <label className="relative block">
            <span className="sr-only">{label}</span>
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              ref={input}
              role="combobox"
              aria-expanded={open}
              aria-controls={`${id}-list`}
              aria-autocomplete="list"
              aria-activedescendant={open && options[active] ? optionId(active) : undefined}
              placeholder="English, Portuguese or Latin"
              autoComplete="off"
              className="pl-9"
              value={query}
              onChange={(event) => type(event.target.value)}
              onKeyDown={onKeyDown}
            />
          </label>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) min-w-64 p-1"
          onOpenAutoFocus={(event) => event.preventDefault()} // typing stays in the field
          onInteractOutside={(event) => event.target === input.current && event.preventDefault()}
        >
          <div id={`${id}-list`} role="listbox" aria-label={label}>
            {options.map((option, index) => (
              <div
                key={option.kind === "create" ? "create" : option.species.id}
                id={optionId(index)}
                role="option"
                tabIndex={-1}
                aria-selected={index === active}
                className={cn(
                  "flex cursor-default flex-col rounded-md px-2 py-1.5",
                  index === active && "bg-accent text-accent-foreground",
                )}
                onMouseDown={(event) => event.preventDefault()} // keep the focus in the field
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
              >
                {option.kind === "create" ? (
                  <span className="flex items-center gap-2 font-medium">
                    <PlusIcon className="size-4" aria-hidden="true" />
                    Add “{text}” as a new species
                  </span>
                ) : (
                  <SpeciesNames species={option.species} />
                )}
              </div>
            ))}
            {options.length === 0 && <p className="px-2 py-1.5 text-muted-foreground">No species match</p>}
          </div>
        </PopoverContent>
      </Popover>

      <ErrorAlert message={error} />

      {draft && (
        <NewSpecies
          draft={draft}
          onCancel={() => setDraft(null)}
          onCreated={(species) => {
            setDraft(null);
            onPick(species);
          }}
        />
      )}
    </div>
  );
}

/** The form for a species not in the list yet. */
function NewSpecies({
  draft: initial,
  onCreated,
  onCancel,
}: {
  draft: Draft;
  onCreated: (species: Species) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const { saving, error, run } = useSave();
  const valid = draft.scientific_name.trim() !== "" && (draft.name_en.trim() !== "" || draft.name_pt.trim() !== "");

  function submit(event: FormEvent) {
    event.preventDefault();
    const body = {
      scientific_name: draft.scientific_name,
      name_en: draft.name_en || null,
      name_pt: draft.name_pt || null,
    };
    void run(async () => {
      try {
        onCreated(await api<Species>("/species", json("POST", body)));
      } catch (problem) {
        // A 409 names the species when it exists already (another case, or a name the search didn't match): use it.
        const existing = problem instanceof ApiError ? problem.body.species_id : undefined;
        const found =
          typeof existing === "number" ? await api<Species>(`/species/${existing}`).catch(() => null) : null;
        if (!found) throw problem;
        onCreated(found);
      }
    }, "Could not add the species");
  }

  const field = (key: keyof Draft, text: string) => (
    <div className="space-y-1">
      <Label htmlFor={`${id}-${key}`}>{text}</Label>
      <Input
        id={`${id}-${key}`}
        value={draft[key]}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
      />
    </div>
  );

  return (
    <form
      aria-label="New species"
      className="space-y-3 rounded-lg border bg-card p-3 text-card-foreground"
      onSubmit={submit}
    >
      <div className="flex items-center justify-between">
        <p className="font-medium">New species</p>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel new species" onClick={onCancel}>
          <XIcon />
        </Button>
      </div>
      {field("scientific_name", "Scientific name")}
      {field("name_en", "English name")}
      {field("name_pt", "Portuguese name")}
      <p className="text-xs text-muted-foreground">
        The scientific name, and the English name, the Portuguese name or both.
      </p>
      <ErrorAlert message={error} />
      <Button type="submit" disabled={!valid || saving}>
        {saving ? "Adding…" : "Add species"}
      </Button>
    </form>
  );
}
