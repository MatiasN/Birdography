import { LogOutIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { initial } from "@/lib/initial";
import ThemePicker from "@/components/ThemePicker";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLayout } from "@/hooks/useLayout";
import { ApiError, json, send } from "@/api";

const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Change the password. Every other session of the account ends; this one continues with a fresh cookie. */
function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [fresh, setFresh] = useState("");
  const [repeat, setRepeat] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    if (fresh !== repeat) {
      setError("The new passwords do not match");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await send("/auth/password", json("POST", { current_password: current, new_password: fresh }));
      setCurrent("");
      setFresh("");
      setRepeat("");
      setDone(true);
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : "Could not change the password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Password</h2>
        </CardTitle>
        <CardDescription>At least 10 characters. Your other devices will be logged out.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={fresh}
              onChange={(e) => setFresh(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="repeat-password">Repeat new password</Label>
            <Input
              id="repeat-password"
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
            />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}
          {done && (
            <Alert>
              <AlertTitle className="text-success">Password changed.</AlertTitle>
            </Alert>
          )}
          <Button type="submit" disabled={saving}>
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** The account: who is logged in, the theme, the password and logging out (plan 0007 §5.1). */
export default function Profile() {
  const { user, logout } = useLayout();
  return (
    <div className="p-4 md:p-6 xl:p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-4">
          <Avatar className="size-16">
            <AvatarFallback className="text-2xl">{initial(user.email)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{user.email}</h1>
            <p className="text-sm text-muted-foreground">Signed in on this device until {dateText(user.expires_at)}</p>
          </div>
        </div>
        {/* Phase 3's stats go here, above the settings. */}
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Appearance</h2>
            </CardTitle>
            <CardDescription>System follows your device's light or dark setting.</CardDescription>
          </CardHeader>
          <CardContent>
            <ThemePicker />
          </CardContent>
        </Card>
        <PasswordCard />
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Session</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void logout()}>
              <LogOutIcon />
              Log out
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
