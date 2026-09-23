// 仅从标准输入读取凭据；不要把令牌作为进程参数传入。
import Foundation
import Security

struct Request: Decodable {
    let operation: String
    let service: String
    let account: String
    let token: String?
}

func output(_ value: [String: Any]) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{\"ok\":false}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(0)
}

let bytes = FileHandle.standardInput.readDataToEndOfFile()
guard bytes.count < 16384,
      let request = try? JSONDecoder().decode(Request.self, from: bytes),
      request.service == "com.vocab-tracker.codex" || request.service.hasPrefix("com.vocab-tracker.codex.test-"),
      request.account.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
    output(["ok": false, "status": Int(errSecParam)])
}

let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: request.service,
    kSecAttrAccount as String: request.account,
]

switch request.operation {
case "set":
    guard let token = request.token,
          token.range(of: "^vt_[A-Za-z0-9_-]{16,4096}$", options: .regularExpression) != nil else {
        output(["ok": false, "status": Int(errSecParam)])
    }
    let secret = Data(token.utf8)
    var attributes = query
    attributes[kSecValueData as String] = secret
    attributes[kSecAttrLabel as String] = "Vocab Tracker · Codex"
    var status = SecItemAdd(attributes as CFDictionary, nil)
    if status == errSecDuplicateItem {
        status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: secret] as CFDictionary)
    }
    output(["ok": status == errSecSuccess, "status": Int(status)])
case "get":
    var attributes = query
    attributes[kSecReturnData as String] = true
    attributes[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(attributes as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data, let token = String(data: data, encoding: .utf8) else {
        output(["ok": false, "status": Int(status)])
    }
    output(["ok": true, "token": token])
case "delete":
    let status = SecItemDelete(query as CFDictionary)
    output(["ok": status == errSecSuccess || status == errSecItemNotFound, "status": Int(status)])
default:
    output(["ok": false, "status": Int(errSecParam)])
}
