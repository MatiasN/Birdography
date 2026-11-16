import { BirdIcon, LocateFixedIcon, UploadIcon } from "lucide-react";
import { Link } from "react-router-dom";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";

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

/** Uploading stays in the Catalogue until Part 2 moves it here (plan 0007 D8). */
export function Upload() {
  return (
    <div className="flex flex-1 flex-col p-4 md:p-6 xl:p-8">
      <EmptyState
        icon={UploadIcon}
        title="Uploading gets its own tab"
        note="Coming soon"
        action={
          <Button asChild>
            <Link to="/catalogue">Upload from the Catalogue</Link>
          </Button>
        }
      >
        Drag and drop, the phone's photo picker, progress per file and species picked while uploading are coming here.
        For now, upload from the Catalogue.
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
