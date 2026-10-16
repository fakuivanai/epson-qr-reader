import { describe, expect, it } from "vitest";
import { decodeEpsonPayload, END_MARKER, XOR_KEY } from "./epson";

type Spec = {
  settings: number;
  wiring: number;
  wiredIp?: number[];
  wirelessIp?: number[];
  mac?: number[];
  passphrase?: string;
  ssid?: string;
};

const ascii = (s: string) => [...new TextEncoder().encode(s)];
const lengthPrefixed = (s: string) => [s.length, ...ascii(s)];

/** Builds a masked payload the way the projector does. */
function payload(spec: Spec): Uint8Array {
  const body = [
    spec.settings,
    spec.wiring,
    ...(spec.wiredIp ?? []),
    ...(spec.wirelessIp ?? []),
    ...(spec.mac ?? [0, 0x11, 0x22, 0x33, 0x44, 0x55]),
    ...(spec.passphrase === undefined ? [] : lengthPrefixed(spec.passphrase)),
    ...(spec.ssid === undefined ? [] : lengthPrefixed(spec.ssid)),
    END_MARKER,
  ];
  return Uint8Array.from([body.length + 1, ...body], (b) => b ^ XOR_KEY);
}

const decode = (spec: Spec) => decodeEpsonPayload(payload(spec));

describe("decodeEpsonPayload", () => {
  it("decodes a fixed quick-mode WPA2 record", () => {
    // Synthetic record with the same layout as a projector in quick mode.
    const hex =
      "cfc7e7254dbde4e5f4c7d6a1b0ec8689849380d4d7d6d1f4a0afa0a8b5a9aac8b5b7aabca0a6b1aab765";
    const bytes = Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
    const result = decodeEpsonPayload(bytes);
    expect(result).toEqual({
      ok: true,
      value: {
        version: 2,
        recordType: "projector",
        connection: { mode: "quick", security: { kind: "wpa2-psk-aes", passphrase: "clave1234" } },
        automaticSsid: true,
        interfaces: { kind: "wireless", wirelessIp: [192, 168, 88, 1] },
        mac: [0, 0x11, 0x22, 0x33, 0x44, 0x55],
        ssid: "EJEMPLO-PROYECTOR",
      },
    });
  });

  it("reads no passphrase in quick mode without security", () => {
    const r = decode({ settings: 0x20, wiring: 0x02, wirelessIp: [10, 0, 0, 1], ssid: "open" });
    expect(r.ok && r.value.connection).toEqual({ mode: "quick", security: { kind: "open" } });
    expect(r.ok && r.value.ssid).toBe("open");
  });

  it("reads no passphrase in advanced mode", () => {
    const r = decode({ settings: 0x23, wiring: 0x02, wirelessIp: [10, 0, 0, 1], ssid: "office" });
    expect(r.ok && r.value.connection).toEqual({ mode: "advanced", security: { kind: "wpa2-psk-aes" } });
  });

  it("reads both addresses and the preferred interface", () => {
    const r = decode({ settings: 0x20, wiring: 0x07, wiredIp: [192, 168, 0, 10], wirelessIp: [192, 168, 88, 1], ssid: "x" });
    expect(r.ok && r.value.interfaces).toEqual({
      kind: "both",
      wiredIp: [192, 168, 0, 10],
      wirelessIp: [192, 168, 88, 1],
      preferred: "wired",
    });
  });

  it("marks a manual SSID and the whiteboard record type", () => {
    const r = decode({ settings: 0x24, wiring: 0x0a, wirelessIp: [1, 2, 3, 4], ssid: "board" });
    expect(r.ok && r.value.automaticSsid).toBe(false);
    expect(r.ok && r.value.recordType).toBe("whiteboard");
  });

  it("treats an empty SSID as absent", () => {
    const r = decode({ settings: 0x20, wiring: 0x02, wirelessIp: [1, 2, 3, 4], ssid: "" });
    expect(r.ok && r.value.ssid).toBeNull();
  });

  it("stops a string at the first NUL byte", () => {
    const r = decode({ settings: 0x22, wiring: 0x02, wirelessIp: [1, 2, 3, 4], passphrase: "abc\0def", ssid: "s" });
    expect(r.ok && r.value.connection).toEqual({ mode: "quick", security: { kind: "wpa2-psk-aes", passphrase: "abc" } });
  });

  it("rejects text that is not an Epson record", () => {
    const r = decodeEpsonPayload(new TextEncoder().encode("https://example.com"));
    expect(r.ok).toBe(false);
  });

  it.each([
    ["too-short", Uint8Array.from([0x31 ^ XOR_KEY])],
    ["length-exceeds-data", Uint8Array.from([0x40, 0x22, 0x02].map((b) => b ^ XOR_KEY))],
    ["missing-end-marker", Uint8Array.from([0x03, 0x22, 0x02].map((b) => b ^ XOR_KEY))],
  ])("reports %s", (kind, bytes) => {
    const r = decodeEpsonPayload(bytes);
    expect(!r.ok && r.error.kind).toBe(kind);
  });

  it("rejects other format versions", () => {
    const r = decode({ settings: 0x12, wiring: 0x02, wirelessIp: [1, 2, 3, 4], ssid: "s" });
    expect(r).toEqual({ ok: false, error: { kind: "unsupported-version", version: 1 } });
  });

  it("rejects the reserved bit and unknown record types", () => {
    expect(decode({ settings: 0x28, wiring: 0x02, ssid: "s" })).toEqual({ ok: false, error: { kind: "reserved-bit-set" } });
    expect(decode({ settings: 0x20, wiring: 0x12, ssid: "s" })).toEqual({ ok: false, error: { kind: "unknown-record-type", value: 2 } });
  });

  it("reports a field cut off by the end marker", () => {
    const r = decode({ settings: 0x20, wiring: 0x02, wirelessIp: [1, 2, 3, 4], mac: [1, 2] });
    expect(!r.ok && r.error).toEqual({ kind: "truncated", field: "mac" });
  });

  it("rejects strings longer than the format allows", () => {
    const r = decode({ settings: 0x20, wiring: 0x02, wirelessIp: [1, 2, 3, 4], ssid: "s".repeat(33) });
    expect(!r.ok && r.error).toEqual({ kind: "string-too-long", field: "ssid", length: 33, max: 32 });
  });
});
