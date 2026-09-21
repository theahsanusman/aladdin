export type AppLook = "classic" | "liquid-glass"

export const APP_LOOKS: AppLook[] = ["classic", "liquid-glass"]

export const defaultAppLook: AppLook = "liquid-glass"

export function appLook(value: string | null | undefined): AppLook {
  return APP_LOOKS.find((look) => look === value) ?? defaultAppLook
}
