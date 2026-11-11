import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, json } from "../api";

/** Only same-site paths: "/photos" yes, "//evil.example" or full URLs no. */
const safePath = (next: string | null) => (next?.startsWith("/") && !next.startsWith("//") ? next : "/");

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/auth/login", json("POST", { email, password }));
      await navigate(safePath(params.get("next")));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not log in");
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-stone-50 px-4">
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-sm space-y-3 bg-white p-6 rounded-lg shadow"
      >
        <h1 className="text-xl font-semibold">Birdography</h1>
        {params.get("expired") && !error && (
          <p className="text-sm text-amber-700">Your session expired, log in again.</p>
        )}
        <input
          className="w-full border rounded px-3 py-2"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="w-full border rounded px-3 py-2"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full bg-emerald-700 text-white rounded py-2 hover:bg-emerald-800">Log in</button>
      </form>
    </div>
  );
}
