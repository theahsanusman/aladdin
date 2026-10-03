import path from "path"

process.env.OPENCODE_DB = ":memory:"
process.env.NPM_CONFIG_AUDIT = "false"
process.env.OPENCODE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.OPENCODE_DISABLE_MODELS_FETCH = "true"
// The desktop app exports OPENCODE_CLIENT; tests assume the default CLI client,
// so a shell launched from the app would otherwise change user agents and
// observability tags and fail assertions that CI never sees.
delete process.env.OPENCODE_CLIENT
