import { createUniqueId, type ComponentProps } from "solid-js"

export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 516 110.5714"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g opacity="0.6">
        <g mask={`url(#${mask})`}>
          <g opacity="0.16">
            <path
              opacity="0.7"
              d="M73.7143 18.4286H0V36.8571H73.7143V18.4286ZM73.7143 36.8571H55.2857V55.2857H73.7143V36.8571ZM73.7143 55.2857H0V73.7143H73.7143V55.2857ZM18.4286 73.7143H0V92.1429H18.4286V73.7143ZM73.7143 73.7143H55.2857V92.1429H73.7143V73.7143ZM73.7143 92.1429H0V110.5714H73.7143V92.1429Z"
              fill="currentColor"
            />
            <path opacity="0.7" d="M110.5714 0H92.1429V110.5714H110.5714V0Z" fill="currentColor" />
            <path
              opacity="0.7"
              d="M202.7143 18.4286H129V36.8571H202.7143V18.4286ZM202.7143 36.8571H184.2857V55.2857H202.7143V36.8571ZM202.7143 55.2857H129V73.7143H202.7143V55.2857ZM147.4286 73.7143H129V92.1429H147.4286V73.7143ZM202.7143 73.7143H184.2857V92.1429H202.7143V73.7143ZM202.7143 92.1429H129V110.5714H202.7143V92.1429Z"
              fill="currentColor"
            />
            <path
              opacity="0.7"
              d="M294.8571 0H276.4286V18.4286H294.8571V0ZM294.8571 18.4286H221.1429V36.8571H294.8571V18.4286ZM239.5714 36.8571H221.1429V92.1429H239.5714V36.8571ZM294.8571 36.8571H276.4286V92.1429H294.8571V36.8571ZM294.8571 92.1429H221.1429V110.5714H294.8571V92.1429Z"
              fill="currentColor"
            />
            <path
              opacity="0.7"
              d="M387 0H368.5714V18.4286H387V0ZM387 18.4286H313.2857V36.8571H387V18.4286ZM331.7143 36.8571H313.2857V92.1429H331.7143V36.8571ZM387 36.8571H368.5714V92.1429H387V36.8571ZM387 92.1429H313.2857V110.5714H387V92.1429Z"
              fill="currentColor"
            />
            <path
              opacity="0.7"
              d="M423.8571 0H405.4286V18.4286H423.8571V0ZM423.8571 36.8571H405.4286V110.5714H423.8571V36.8571Z"
              fill="currentColor"
            />
            <path
              opacity="0.7"
              d="M497.5714 18.4286H442.2857V36.8571H497.5714V18.4286ZM460.7143 36.8571H442.2857V110.5714H460.7143V36.8571ZM516 36.8571H497.5714V110.5714H516V36.8571Z"
              fill="currentColor"
            />
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="516" height="110.5714">
          <rect width="516" height="110.5714" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="258" y1="58.5" x2="258" y2="110.5714" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
