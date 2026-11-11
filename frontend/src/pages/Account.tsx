import { useState, type FormEvent } from "react";
import { ApiError, json, send } from "../api";

/** Change the password. Every other session of the account ends; this one continues with a fresh cookie. */
export default function Account() {
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

  const field = "w-full border rounded px-3 py-2";

  return (
    <div className="p-4">
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-sm space-y-3 bg-white p-6 rounded-lg shadow"
      >
        <h1 className="text-lg font-semibold">Change password</h1>
        <label className="block text-sm text-stone-600">
          Current password
          <input
            className={field}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm text-stone-600">
          New password
          <input
            className={field}
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={fresh}
            onChange={(e) => setFresh(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm text-stone-600">
          Repeat new password
          <input
            className={field}
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            required
          />
        </label>
        <p className="text-xs text-stone-500">At least 10 characters. Your other devices will be logged out.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {done && <p className="text-sm text-emerald-700">Password changed.</p>}
        <button
          disabled={saving}
          className="w-full bg-emerald-700 text-white rounded py-2 hover:bg-emerald-800 disabled:opacity-40"
        >
          Change password
        </button>
      </form>
    </div>
  );
}
