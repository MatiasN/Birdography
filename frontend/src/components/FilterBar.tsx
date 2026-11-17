import { CalendarIcon, CameraIcon, ChevronDownIcon, MapPinIcon, XIcon, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import SpeciesPicker from "@/components/SpeciesPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { speciesName, type Camera, type Species } from "@/api";
import { dateLabel, isoDay, type Filters } from "@/lib/filters";
import { cn } from "cn";

type Props = {
  filters: Filters;
  onChange: (filters: Filters) => void;
  cameras: Camera[];
  /** Names of the species in the filter, by id; one still loading shows as "…". */
  species: Record<number, Species>;
  /** A species picked in the search, so its name is known without asking the API again. */
  onSpeciesPicked: (species: Species) => void;
  /** "104 of 312 photos", at the end of the bar while a filter is on. */
  count?: ReactNode;
};

type MenuProps = {
  icon: LucideIcon;
  label: string;
  /** Names the filter for the clear button: "Clear the camera filter". */
  name: string;
  active: boolean;
  onClear: () => void;
  children: (close: () => void) => ReactNode;
};

/** A filter button opening its choices in a popover; while the filter is on it shows the value and a clear button. */
function FilterMenu({ icon: Icon, label, name, active, onClear, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        "flex shrink-0 items-center rounded-md border bg-background shadow-xs",
        active && "border-primary/40 bg-accent text-accent-foreground",
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className={cn("border-0 shadow-none", active && "pr-1.5")}
            aria-label={`${name}: ${label}`}
          >
            <Icon />
            {label}
            {!active && <ChevronDownIcon className="text-muted-foreground" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto min-w-56 p-1">
          {children(() => setOpen(false))}
        </PopoverContent>
      </Popover>
      {active && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="mr-0.5"
          aria-label={`Clear the ${name.toLowerCase()} filter`}
          onClick={onClear}
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}

/** A choice in a filter's popover. */
function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-4 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent",
        selected && "font-medium text-primary",
      )}
    >
      {children}
    </button>
  );
}

function DateChoices({
  filters,
  onChange,
  close,
}: {
  filters: Filters;
  onChange: Props["onChange"];
  close: () => void;
}) {
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");
  const apply = (next: { from: string; to: string }) => {
    onChange({ ...filters, from: next.from || null, to: next.to || null });
    close();
  };
  return (
    <form
      className="space-y-3 p-2"
      onSubmit={(event) => {
        event.preventDefault();
        apply({ from, to });
      }}
    >
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => apply({ from: isoDay(daysAgo(30)), to: "" })}>
          Last 30 days
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => apply({ from: `${new Date().getFullYear()}-01-01`, to: "" })}
        >
          This year
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="filter-from">From</Label>
          <Input
            id="filter-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="filter-to">To</Label>
          <Input
            id="filter-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>
      <Button type="submit" size="sm" className="w-full">
        Apply
      </Button>
    </form>
  );
}

/** The local date `days` before today. */
function daysAgo(days: number) {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
}

/** The cameras grouped by brand: "All Nikon" first, then each model. */
function cameraGroups(cameras: Camera[]) {
  const groups = new Map<string | null, Camera[]>();
  for (const camera of cameras) groups.set(camera.make, [...(groups.get(camera.make) ?? []), camera]);
  return [...groups];
}

const cameraLabel = (make: string | null, model: string | null) => [make, model].filter(Boolean).join(" ");

/**
 * The Catalogue's filters (plan 0008 §6): a species search and buttons for the date, the camera and the position.
 * Each change goes to `onChange`; the page keeps the filters in the URL.
 */
export default function FilterBar({ filters, onChange, cameras, species, onSpeciesPicked, count }: Props) {
  const set = (changes: Partial<Filters>) => onChange({ ...filters, ...changes });
  const positionLabel =
    filters.located === null ? "Any position" : filters.located ? "With position" : "Without position";
  const camera = filters.make || filters.model ? cameraLabel(filters.make, filters.model) : "Any camera";

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <SpeciesPicker
          className="md:w-80"
          label="Filter by species"
          allowCreate={false}
          exclude={filters.species}
          onPick={(picked) => {
            onSpeciesPicked(picked);
            set({ species: [...filters.species, picked.id] });
          }}
        />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
          <FilterMenu
            icon={CalendarIcon}
            name="Date"
            label={dateLabel(filters)}
            active={filters.from !== null || filters.to !== null}
            onClear={() => set({ from: null, to: null })}
          >
            {(close) => <DateChoices filters={filters} onChange={onChange} close={close} />}
          </FilterMenu>
          <FilterMenu
            icon={CameraIcon}
            name="Camera"
            label={camera}
            active={filters.make !== null || filters.model !== null}
            onClear={() => set({ make: null, model: null })}
          >
            {(close) =>
              cameras.length === 0 ? (
                <p className="px-2 py-1.5 text-muted-foreground">No camera recorded in your photos yet</p>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  {cameraGroups(cameras).map(([make, models]) => (
                    <div key={make ?? ""} className="border-b py-1 last:border-b-0">
                      {make && (
                        <Choice
                          selected={filters.make === make && filters.model === null}
                          onClick={() => {
                            set({ make, model: null });
                            close();
                          }}
                        >
                          <span>All {make}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {models.reduce((sum, m) => sum + m.photos, 0)}
                          </span>
                        </Choice>
                      )}
                      {models
                        .filter((m) => m.model !== null)
                        .map((m) => (
                          <Choice
                            key={m.model}
                            selected={filters.make === m.make && filters.model === m.model}
                            onClick={() => {
                              set({ make: m.make, model: m.model });
                              close();
                            }}
                          >
                            <span className={cn(make && "pl-3")}>{cameraLabel(m.make, m.model)}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">{m.photos}</span>
                          </Choice>
                        ))}
                    </div>
                  ))}
                </div>
              )
            }
          </FilterMenu>
          <FilterMenu
            icon={MapPinIcon}
            name="Position"
            label={positionLabel}
            active={filters.located !== null}
            onClear={() => set({ located: null })}
          >
            {(close) =>
              (
                [
                  [null, "Any position"],
                  [true, "With position"],
                  [false, "Without position"],
                ] as const
              ).map(([value, text]) => (
                <Choice
                  key={text}
                  selected={filters.located === value}
                  onClick={() => {
                    set({ located: value });
                    close();
                  }}
                >
                  {text}
                </Choice>
              ))
            }
          </FilterMenu>
        </div>
        {count && (
          <span className="hidden text-sm whitespace-nowrap text-muted-foreground md:ml-auto md:inline">{count}</span>
        )}
      </div>

      {filters.species.length > 0 && (
        <ul aria-label="Species in the filter" className="flex flex-wrap gap-2">
          {filters.species.map((id) => {
            const known = species[id];
            const name = known ? speciesName(known) : "…";
            return (
              <li
                key={id}
                className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-accent py-0.5 pr-0.5 pl-3 text-sm text-accent-foreground"
              >
                {name}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-6 rounded-full"
                  aria-label={`Remove ${name} from the filter`}
                  onClick={() => set({ species: filters.species.filter((other) => other !== id) })}
                >
                  <XIcon />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
