import Foundation
import Security

func check(_ status: OSStatus, _ operation: String) throws {
    guard status == errSecSuccess else {
        throw NSError(domain: "AgentChromeSigning", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "\(operation) failed (\(status))"])
    }
}

do {
    guard CommandLine.arguments.count == 3 || CommandLine.arguments.count == 4 else {
        throw NSError(domain: "AgentChromeSigning", code: 1, userInfo: [NSLocalizedDescriptionKey: "Expected private signing keychain, password file, and optional import file"])
    }
    let path = CommandLine.arguments[1]
    let password = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
    var keychain: SecKeychain?
    if FileManager.default.fileExists(atPath: path) {
        try check(SecKeychainOpen(path, &keychain), "Open dedicated signing keychain")
        try password.withUnsafeBytes { buffer in
            try check(SecKeychainUnlock(keychain, UInt32(buffer.count), buffer.baseAddress, true), "Unlock dedicated signing keychain")
        }
    } else {
        // Creating a file keychain may add it to the global search list. Restore
        // that list immediately; browser encryption continues using its existing keychain.
        var searchList: CFArray?
        try check(SecKeychainCopySearchList(&searchList), "Read keychain search list")
        guard let searchList else { throw NSError(domain: "AgentChromeSigning", code: 6) }
        try password.withUnsafeBytes { buffer in
            try check(SecKeychainCreate(path, UInt32(buffer.count), buffer.baseAddress, false, nil, &keychain), "Create dedicated signing keychain")
        }
        try check(SecKeychainSetSearchList(searchList), "Preserve keychain search list")
    }
    guard let keychain else { throw NSError(domain: "AgentChromeSigning", code: 2) }
    if CommandLine.arguments.count == 4 {
        var signer: SecTrustedApplication?
        try check(SecTrustedApplicationCreateFromPath("/usr/bin/codesign", &signer), "Identify system signing tool")
        guard let signer else { throw NSError(domain: "AgentChromeSigning", code: 3) }
        var access: SecAccess?
        try check(SecAccessCreate("Agent Chrome local signing key" as CFString, [signer] as CFArray, &access), "Restrict signing key access")
        guard let access else { throw NSError(domain: "AgentChromeSigning", code: 4) }
        let options = [
            kSecImportExportPassphrase as String: String(decoding: password, as: UTF8.self),
            kSecImportExportKeychain as String: keychain,
            kSecImportExportAccess as String: access,
        ] as [String: Any]
        var imported: CFArray?
        try check(SecPKCS12Import(try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[3])) as CFData, options as CFDictionary, &imported), "Import local signing identity")
        guard let imported, CFArrayGetCount(imported) == 1 else { throw NSError(domain: "AgentChromeSigning", code: 5) }
    }
    print("Dedicated signing identity ready")
} catch {
    fputs("Agent Chrome signing: \(error.localizedDescription)\n", stderr)
    exit(1)
}
