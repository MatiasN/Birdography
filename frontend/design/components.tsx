// The real components (src/components), rendered for comparison with the static mockups. Not part of the app.
import { BirdIcon, LogOutIcon, PlusIcon, ZoomInIcon } from "lucide-react";
import { createRoot } from "react-dom/client";
import EmptyState from "@/components/EmptyState";
import SidePanel from "@/components/SidePanel";
import ThemePicker from "@/components/ThemePicker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import "./mockup.css";

document.documentElement.classList.toggle("dark", new URLSearchParams(location.search).get("theme") === "dark");

function Sheet() {
  return (
    <div className="flex min-h-dvh">
      <div className="flex-1 space-y-8 p-8">
        <section className="flex flex-wrap items-center gap-3">
          <Button>Change password</Button>
          <Button variant="outline">
            <LogOutIcon />
            Log out
          </Button>
          <Button variant="outline" size="sm">
            <ZoomInIcon />
            Zoom in
          </Button>
          <Button variant="ghost" className="text-primary">
            <PlusIcon />
            Add species
          </Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="destructive">Delete</Button>
          <Button disabled>Use this spot</Button>
          <Avatar>
            <AvatarFallback>M</AvatarFallback>
          </Avatar>
          <Avatar size="lg">
            <AvatarFallback>M</AvatarFallback>
          </Avatar>
          <Badge variant="outline">Coming in Phase 2</Badge>
          <Badge>Badge</Badge>
        </section>
        <div className="grid max-w-3xl grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Password</CardTitle>
              <CardDescription>At least 10 characters. Your other devices will be logged out.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="current">Current password</Label>
                <Input id="current" type="password" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="search">Species</Label>
                <Input id="search" placeholder="Species, in English, Portuguese or Latin" />
              </div>
              <Button>Change password</Button>
            </CardContent>
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>System follows your device's light or dark setting.</CardDescription>
              </CardHeader>
              <CardContent>
                <ThemePicker />
              </CardContent>
            </Card>
            <Alert variant="destructive">
              <AlertTitle>Could not change the password</AlertTitle>
              <AlertDescription>The current password is wrong.</AlertDescription>
            </Alert>
            <Alert>
              <AlertTitle>Password changed.</AlertTitle>
            </Alert>
          </div>
        </div>
        <EmptyState icon={BirdIcon} title="Your species, one page each" note="Coming in Phase 2">
          Every species you photograph gets a page with its photos and its English, Portuguese and scientific names.
        </EmptyState>
      </div>
      <SidePanel
        title="12 photos here"
        onClose={() => undefined}
        actions={
          <Button variant="outline" size="sm">
            <ZoomInIcon />
            Zoom in
          </Button>
        }
      >
        <p className="p-4 text-sm text-muted-foreground">Panel content</p>
      </SidePanel>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Sheet />);
