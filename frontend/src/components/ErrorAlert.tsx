import { Alert, AlertTitle } from "@/components/ui/alert";

/** A failed action's message, or nothing while there is none. */
export default function ErrorAlert({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertTitle>{message}</AlertTitle>
    </Alert>
  );
}
