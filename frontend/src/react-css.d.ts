/** A CSS custom property name. Being an export, it also makes this file a module, so the declaration below augments
 * React's types instead of replacing them. */
export type CssVariable = `--${string}`;

// CSS custom properties (`--gap`) in `style`, so components don't need an unsafe `as CSSProperties`.
declare module "react" {
  interface CSSProperties {
    [property: CssVariable]: string | number | undefined;
  }
}
