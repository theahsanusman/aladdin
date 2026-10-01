import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"

export type PermissionMode = "auto" | "normal"

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    // Auto-approve is the default for every chat; the danger gate keeps
    // dangerous requests prompting even while this mode is on.
    const [store, setStore] = createStore<{ mode: PermissionMode }>({
      mode: "auto",
    })
    return {
      get mode() {
        return store.mode
      },
      set(mode: PermissionMode) {
        setStore("mode", mode)
      },
      toggle() {
        setStore("mode", (mode) => (mode === "auto" ? "normal" : "auto"))
      },
    }
  },
})
