import { useCallback, useState } from "react";
import { errorText } from "@/api";

/**
 * The saving flag and error message of a form or button that calls the API. `run(action, fallback)` clears the
 * error, runs the action and keeps the API's message, or `fallback` on a lost connection; it resolves to whether
 * the action succeeded.
 */
export function useSave() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (action: () => Promise<unknown>, fallback: string) => {
    setSaving(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (problem) {
      setError(errorText(problem, fallback));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);
  return { saving, error, setError, run };
}
