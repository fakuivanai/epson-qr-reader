import { describe, expect, it } from "vitest";
import type { Connection, EpsonRecord } from "./epson";
import { wifiQrText } from "./wifi";

const record = (connection: Connection, ssid: string | null = "Room 5"): EpsonRecord => ({
  version: 2,
  recordType: "projector",
  connection,
  automaticSsid: true,
  interfaces: { kind: "wireless", wirelessIp: [192, 168, 88, 1] },
  mac: [0, 1, 2, 3, 4, 5],
  ssid,
});

describe("wifiQrText", () => {
  it("writes a WPA network with an escaped SSID and passphrase", () => {
    const r = wifiQrText(record({ mode: "quick", security: { kind: "wpa2-psk-aes", passphrase: 'a;b,c:d"e\\f' } }, "x;y"));
    expect(r).toEqual({ ok: true, value: String.raw`WIFI:T:WPA;S:x\;y;P:a\;b\,c\:d\"e\\f;;` });
  });

  it("writes an open network without a passphrase", () => {
    expect(wifiQrText(record({ mode: "quick", security: { kind: "open" } }))).toEqual({ ok: true, value: "WIFI:T:nopass;S:Room 5;;" });
  });

  it("needs a passphrase for a WPA network", () => {
    expect(wifiQrText(record({ mode: "advanced", security: { kind: "wpa2-psk-aes" } }))).toEqual({ ok: false, error: { kind: "missing-passphrase" } });
    expect(wifiQrText(record({ mode: "quick", security: { kind: "wpa2-psk-aes", passphrase: null } }))).toEqual({ ok: false, error: { kind: "missing-passphrase" } });
  });

  it("needs an SSID", () => {
    expect(wifiQrText(record({ mode: "quick", security: { kind: "open" } }, null))).toEqual({ ok: false, error: { kind: "missing-ssid" } });
  });
});
