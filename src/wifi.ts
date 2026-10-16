import type { EpsonRecord, Result } from "./epson";

// Wi-Fi network QR text as read by Android and iOS camera apps:
// https://github.com/zxing/zxing/wiki/Barcode-Contents#wi-fi-network-config-android-ios-11
// Kept local because the only packaged builder found (wifi-qr-code-generator
// 1.1.1, unmaintained since 2020) bundles another QR library.

export type WifiQrError = { kind: "missing-ssid" } | { kind: "missing-passphrase" };

const escape = (value: string) => value.replace(/[\\;,:"]/g, (c) => `\\${c}`);

export function wifiQrText(record: EpsonRecord): Result<string, WifiQrError> {
  if (record.ssid === null) return { ok: false, error: { kind: "missing-ssid" } };
  const ssid = `S:${escape(record.ssid)};`;
  const { connection } = record;
  if (connection.security.kind === "open") return { ok: true, value: `WIFI:T:nopass;${ssid};` };
  if (connection.mode === "advanced" || connection.security.passphrase === null)
    return { ok: false, error: { kind: "missing-passphrase" } };
  return { ok: true, value: `WIFI:T:WPA;${ssid}P:${escape(connection.security.passphrase)};;` };
}
