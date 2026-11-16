// The EmptyState component as the Species and Near me tabs show it until Phase 2 (plan 0007 §5).
import { icon, page } from "./shell.js";

export function placeholder({ iconName, title, text, coming }) {
  page(() => {
    document.querySelector("main").innerHTML = `
      <div class="mx-auto flex min-h-[calc(100dvh-10rem)] max-w-md flex-col items-center justify-center gap-4 text-center md:min-h-[calc(100dvh-4rem)]">
        <span class="grid size-16 place-items-center rounded-2xl bg-accent text-accent-foreground">${icon(iconName, "size-8")}</span>
        <h1 class="text-xl font-semibold tracking-tight">${title}</h1>
        <p class="text-muted-foreground">${text}</p>
        <span class="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">${coming}</span>
      </div>`;
  });
}
