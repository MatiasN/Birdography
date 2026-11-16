// Loaded blocking in <head>, before the app: puts `.dark` on <html> before the first paint, so a dark page doesn't
// flash white. Same rules as src/theme.ts, which takes over once the app runs. An external file rather than
// inline, so a future Content-Security-Policy needs no hash for it.
(function () {
  var choice;
  try {
    choice = localStorage.getItem("theme");
  } catch {
    choice = null; // storage blocked: follow the system
  }
  var dark = choice === "dark" || (choice !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();
