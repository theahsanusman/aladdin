import { type ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-logo-mark-shadow" d="M12 12H4V16H12V12Z" fill="var(--icon-weak-base)" />
      <path
        data-slot="logo-logo-mark-a"
        d="M16 0H0V4H16V0ZM16 4H12V8H16V4ZM16 8H0V12H16V8ZM4 12H0V16H4V12ZM16 12H12V16H16V12ZM16 16H0V20H16V16Z"
        fill="var(--icon-strong-base)"
      />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M60 60H20V80H60V60Z" fill="var(--icon-base)" />
      <path
        d="M80 0H0V20H80V0ZM80 20H60V40H80V20ZM80 40H0V60H80V40ZM20 60H0V80H20V60ZM80 60H60V80H80V60ZM80 80H0V100H80V80Z"
        fill="var(--icon-strong-base)"
      />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 168 36"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        <path d="M18 24H6V30H18V24Z" fill="var(--icon-weak-base)" />
        <path
          d="M24 6H0V12H24V6ZM24 12H18V18H24V12ZM24 18H0V24H24V18ZM6 24H0V30H6V24ZM24 24H18V30H24V24ZM24 30H0V36H24V30Z"
          fill="var(--icon-base)"
        />
        <path d="M36 0H30V36H36V0Z" fill="var(--icon-base)" />
        <path d="M60 24H48V30H60V24Z" fill="var(--icon-weak-base)" />
        <path
          d="M66 6H42V12H66V6ZM66 12H60V18H66V12ZM66 18H42V24H66V18ZM48 24H42V30H48V24ZM66 24H60V30H66V24ZM66 30H42V36H66V30Z"
          fill="var(--icon-base)"
        />
        <path d="M90 18H78V24H90V18ZM90 24H78V30H90V24Z" fill="var(--icon-weak-base)" />
        <path
          d="M96 0H90V6H96V0ZM96 6H72V12H96V6ZM78 12H72V30H78V12ZM96 12H90V30H96V12ZM96 30H72V36H96V30Z"
          fill="var(--icon-strong-base)"
        />
        <path d="M120 18H108V24H120V18ZM120 24H108V30H120V24Z" fill="var(--icon-weak-base)" />
        <path
          d="M126 0H120V6H126V0ZM126 6H102V12H126V6ZM108 12H102V30H108V12ZM126 12H120V30H126V12ZM126 30H102V36H126V30Z"
          fill="var(--icon-strong-base)"
        />
        <path d="M138 0H132V6H138V0ZM138 12H132V36H138V12Z" fill="var(--icon-strong-base)" />
        <path d="M162 18H150V24H162V18ZM162 24H150V30H162V24Z" fill="var(--icon-weak-base)" />
        <path d="M162 6H144V12H162V6ZM150 12H144V36H150V12ZM168 12H162V36H168V12Z" fill="var(--icon-strong-base)" />
      </g>
    </svg>
  )
}
