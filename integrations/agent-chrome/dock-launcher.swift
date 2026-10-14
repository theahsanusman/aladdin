import AppKit
import Darwin
import Foundation

struct BrowserStartup: Decodable {
    let pid: Int32?
    let executable: String
    let arguments: [String]
}

final class AgentChromeLauncher: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        let process = Process()
        let output = Pipe()
        let errors = Pipe()
        process.executableURL = URL(fileURLWithPath: "/opt/homebrew/bin/python3")
        process.arguments = ["-B", "-c", """
            import json, sys
            from pathlib import Path
            sys.path.insert(0, str(Path.home() / 'Library/Application Support/Agent Chrome/automation'))
            import launcher
            directory = launcher.DIRECTORY
            if directory.is_symlink() or directory.resolve() != directory:
                raise RuntimeError('Agent Chrome data directory must not redirect elsewhere')
            if not directory.is_dir() or directory.stat().st_uid != __import__('os').getuid():
                raise RuntimeError('Agent Chrome data directory must exist and belong to you')
            print(json.dumps({'pid': launcher.checked_listener(), 'executable': str(launcher.CHROME), 'arguments': launcher.FLAGS}))
            """]
        process.standardOutput = output
        process.standardError = errors
        do {
            try process.run()
            process.waitUntilExit()
            let result = output.fileHandleForReading.readDataToEndOfFile()
            let detail = String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            guard process.terminationStatus == 0 else {
                fail(detail)
                return
            }
            let startup = try JSONDecoder().decode(BrowserStartup.self, from: result)
            if let pid = startup.pid {
                guard let browser = NSRunningApplication(processIdentifier: pid) else {
                    fail("The dedicated Chrome process closed before activation.")
                    return
                }
                NSApp.yieldActivation(to: browser)
                guard browser.activate(from: NSRunningApplication.current, options: [.activateAllWindows]) else {
                    fail("Agent Chrome could not be brought forward.")
                    return
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(150)) { NSApp.terminate(nil) }
                return
            }
            // Retain the app's LaunchServices process identity instead of
            // opening a child application with a separate Dock tile.
            var arguments = ([startup.executable] + startup.arguments).map { strdup($0) }
            arguments.append(nil)
            startup.executable.withCString { executable in
                arguments.withUnsafeMutableBufferPointer { values in
                    _ = execv(executable, values.baseAddress!)
                }
            }
            arguments.compactMap { $0 }.forEach { free($0) }
            fail("Chrome could not start: \(String(cString: strerror(errno)))")
        } catch {
            fail(error.localizedDescription)
        }
    }

    private func fail(_ detail: String) {
        let alert = NSAlert()
        alert.messageText = "Agent Chrome could not open"
        alert.informativeText = detail
        alert.alertStyle = .warning
        alert.runModal()
        NSApp.terminate(nil)
    }
}

let application = NSApplication.shared
let delegate = AgentChromeLauncher()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
