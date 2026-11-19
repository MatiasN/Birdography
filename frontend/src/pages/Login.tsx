import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ErrorAlert from "@/components/ErrorAlert";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorText, json } from "@/api";

/** Only same-site paths: "/map" yes, "//evil.example" or full URLs no; otherwise the Catalogue. */
const safePath = (next: string | null) => (next?.startsWith("/") && !next.startsWith("//") ? next : "/catalogue");

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/auth/login", json("POST", { email, password }));
      await navigate(safePath(params.get("next")));
    } catch (problem) {
      setError(errorText(problem, "Could not log in"));
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <img src="/logo.svg" alt="" className="size-20" />
          <h1 className="text-2xl font-semibold tracking-tight">Birdography</h1>
          <p className="text-sm text-muted-foreground">Your bird photography catalogue</p>
        </div>
        <Card className="w-full">
          <CardContent>
            <form onSubmit={(event) => void submit(event)} className="space-y-4">
              {params.get("expired") && !error && (
                <Alert>
                  <AlertTitle className="text-warning">Your session expired, log in again.</AlertTitle>
                </Alert>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="pr-10"
                  />
                  {/* An eye: open while the password is hidden (click to show), crossed out while it is shown. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-controls="password"
                    onClick={() => setShowPassword((shown) => !shown)}
                    className="absolute inset-y-0 right-0 my-auto text-muted-foreground hover:bg-transparent"
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </Button>
                </div>
              </div>
              <ErrorAlert message={error} />
              <Button type="submit" className="w-full">
                Log in
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
