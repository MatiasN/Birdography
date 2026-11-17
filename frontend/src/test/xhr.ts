import { vi } from "vitest";

type Listener = (event: ProgressEvent) => void;

/** A stand-in for XMLHttpRequest that records each request and lets the test answer it (see `stubXhr`). */
export class FakeXhr {
  static sent: FakeXhr[] = [];
  method = "";
  url = "";
  body: FormData | null = null;
  status = 0;
  statusText = "";
  responseText = "";
  private listeners: Record<string, Listener[]> = {};
  private uploadListeners: Listener[] = [];
  upload = { addEventListener: (_: "progress", listener: Listener) => this.uploadListeners.push(listener) };

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  addEventListener(type: string, listener: Listener) {
    (this.listeners[type] ??= []).push(listener);
  }

  send(body: FormData) {
    this.body = body;
    FakeXhr.sent.push(this);
  }

  /** The file's name and the species ids sent with it. */
  get form() {
    const name = (field: string) => {
      const value = this.body?.get(field);
      return value instanceof File ? value.name : null;
    };
    return { file: name("file"), companion: name("companion"), species: this.body?.getAll("species_ids") ?? [] };
  }

  progress(loaded: number, total: number, lengthComputable = true) {
    for (const listener of this.uploadListeners)
      listener(new ProgressEvent("progress", { loaded, total, lengthComputable }));
  }

  respond(status: number, body: unknown, statusText = status < 400 ? "OK" : "Failed") {
    this.status = status;
    this.statusText = statusText;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    for (const listener of this.listeners.load ?? []) listener(new ProgressEvent("load"));
    return Promise.resolve(); // inside act(), lets the page's follow-up work finish
  }

  fail() {
    for (const listener of this.listeners.error ?? []) listener(new ProgressEvent("error"));
    return Promise.resolve();
  }
}

/** Replace XMLHttpRequest for this test; returns the list the requests land in, in order. */
export function stubXhr(): FakeXhr[] {
  FakeXhr.sent = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return FakeXhr.sent;
}
