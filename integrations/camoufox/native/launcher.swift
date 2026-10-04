import AppKit
import Foundation

// Finder launches this wrapper; the browser itself stays owned by the shared
// service so manual use and MCP always use the same persistent profile.
let base = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/Aladdin Browser")

do {
    let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: base.appendingPathComponent("installation.json")))
    guard let values = manifest as? [String: Any],
          let node = values["node"] as? String,
          let entry = values["entry"] as? String,
          let root = values["root"] as? String,
          let executable = values["executable"] as? String,
          [node, entry, root, executable].allSatisfy({ $0.hasPrefix("/") }) else {
        throw NSError(domain: "AladdinBrowser", code: 1)
    }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: node)
    process.arguments = [entry, "open", "--root", root, "--executable", executable, "--profile", "default"]
    process.environment = ProcessInfo.processInfo.environment.filter { !["NODE_OPTIONS", "NODE_PATH", "DYLD_INSERT_LIBRARIES", "LD_PRELOAD"].contains($0.key) }
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw NSError(domain: "AladdinBrowser", code: 2) }

    let browserBundle = URL(fileURLWithPath: executable).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().standardizedFileURL
    // Activate only the pinned installed app. Never launch another Firefox
    // installation or a browser using an unconfigured profile.
    let browser = NSWorkspace.shared.runningApplications.first { $0.bundleURL?.standardizedFileURL == browserBundle }
    if let browser = browser {
        browser.activate(options: [.activateAllWindows])
    }
} catch {
    NSApplication.shared.setActivationPolicy(.accessory)
    NSApplication.shared.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.messageText = "Aladdin Browser could not open"
    alert.informativeText = "The private Camoufox service could not open its visible profile. Check the browser installation and try again. Chrome was not used."
    alert.addButton(withTitle: "OK")
    alert.runModal()
    exit(1)
}
