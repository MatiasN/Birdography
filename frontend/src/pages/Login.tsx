import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, json } from "../api";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/auth/login", json("POST", { email, password }));
      navigate("/");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-stone-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 bg-white p-6 rounded-lg shadow">
        <h1 className="text-xl font-semibold">Birdography</h1>
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
