import { BirdIcon, LocateFixedIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";

// Tabs whose features arrive later show what is coming (roadmap Phase 1.5), so the navigation is settled now.

export function Species() {
  return (
    <div className="flex flex-1 flex-col p-4 md:p-6 xl:p-8">
      <EmptyState icon={BirdIcon} title="Your species, one page each" note="Coming in Phase 2">
        Every species you photograph gets a page with its photos and its English, Portuguese and scientific names.
      </EmptyState>
    </div>
  );
}

export function NearMe() {
  return (
    <div className="flex flex-1 flex-col p-4 md:p-6 xl:p-8">
      <EmptyState icon={LocateFixedIcon} title="What's around you" note="Coming in Phase 2">
        Species likely near you or a place you search, from recent eBird sightings, each marked as photographed or not
        yet.
      </EmptyState>
    </div>
  );
}
