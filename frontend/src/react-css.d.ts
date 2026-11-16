import type { CSSProperties as _ReactCSS } from "react";

// CSS custom properties (`--gap`) in `style`, so components don't need an unsafe `as CSSProperties`.
declare module "react" {
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
}
