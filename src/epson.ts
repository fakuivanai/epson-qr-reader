// Decoder for the QR code an Epson projector shows for its iProjection app.
//
// Ported from the decompiled Epson iProjection Android app:
// https://github.com/adrwtrm/njn/blob/0a14b2d666830377aebb722bd0f30aa2fd07a0bd/jiji/sources/com/epson/iprojection/linkagedata/decoder/LinkageDataCommonDecoder.java
// https://github.com/adrwtrm/njn/blob/0a14b2d666830377aebb722bd0f30aa2fd07a0bd/jiji/sources/com/epson/iprojection/linkagedata/decoder/qr/QRDecoderV0.java
// https://github.com/adrwtrm/njn/blob/0a14b2d666830377aebb722bd0f30aa2fd07a0bd/jiji/sources/com/epson/iprojection/linkagedata/decoder/qr/QRDecoderV2.java
// Only format version 2 is supported. Versions 0 and 1 carry a projector name
// instead of a MAC address and are rejected rather than guessed at.

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type Ipv4 = readonly [number, number, number, number];
export type Mac = readonly [number, number, number, number, number, number];

/** Wi-Fi security as written in the record. Quick mode may carry the passphrase. */
export type Connection =
  | {
      mode: "quick";
      security: { kind: "open" } | { kind: "wpa2-psk-aes"; passphrase: string | null };
    }
  | { mode: "advanced"; security: { kind: "open" } | { kind: "wpa2-psk-aes" } };

export type Interfaces =
  | { kind: "wireless"; wirelessIp: Ipv4 }
  | { kind: "wired"; wiredIp: Ipv4 }
  | { kind: "both"; wiredIp: Ipv4; wirelessIp: Ipv4; preferred: "wired" | "wireless" }
  | { kind: "none" };

export type EpsonRecord = {
  version: 2;
  recordType: "projector" | "whiteboard";
  connection: Connection;
  automaticSsid: boolean;
  interfaces: Interfaces;
  mac: Mac;
  /** Null when the record carries an empty SSID. */
  ssid: string | null;
};

export type Field = "header" | "wired-ip" | "wireless-ip" | "mac" | "passphrase" | "ssid";

export type ParseError =
  | { kind: "too-short" }
  | { kind: "length-exceeds-data"; declared: number; available: number }
  | { kind: "missing-end-marker" }
  | { kind: "unsupported-version"; version: number }
  | { kind: "reserved-bit-set" }
  | { kind: "unknown-record-type"; value: number }
  | { kind: "truncated"; field: Field }
  | { kind: "string-too-long"; field: "passphrase" | "ssid"; length: number; max: number };

/** Every byte of the QR payload is XORed with this key. */
export const XOR_KEY = 0xe5;
export const END_MARKER = 0x80;
const PASSPHRASE_MAX = 63;
const SSID_MAX = 32;

const bit = (byte: number, index: number): boolean => ((byte >> index) & 1) === 1;
const bitField = (byte: number, lowestBit: number, width: number): number =>
  (byte >> lowestBit) & ((1 << width) - 1);

// Byte 1, connection settings.
const isAdvancedMode = (b: number) => bit(b, 0);
const isWpa2 = (b: number) => bit(b, 1);
const isManualSsid = (b: number) => bit(b, 2);
const reservedBit = (b: number) => bit(b, 3);
const formatVersion = (b: number) => bitField(b, 4, 4);
// Byte 2, interfaces and record type.
const hasWired = (b: number) => bit(b, 0);
const hasWireless = (b: number) => bit(b, 1);
const prefersWired = (b: number) => bit(b, 2);
const recordTypeBits = (b: number) => bitField(b, 3, 5);

export function unmask(payload: Uint8Array): Uint8Array {
  return payload.map((byte) => byte ^ XOR_KEY);
}

/** Reads fields in order from the record body, never past the end marker. */
class Reader {
  private offset = 3;
  constructor(
    private readonly record: Uint8Array,
    private readonly end: number,
  ) {}

  take(count: number, field: Field): Result<Uint8Array, ParseError> {
    if (this.offset + count > this.end) return { ok: false, error: { kind: "truncated", field } };
    const bytes = this.record.subarray(this.offset, this.offset + count);
    this.offset += count;
    return { ok: true, value: bytes };
  }

  // Length-prefixed string; the app stops at the first NUL inside it.
  string(field: "passphrase" | "ssid", max: number): Result<string | null, ParseError> {
    const length = this.take(1, field);
    if (!length.ok) return length;
    const n = length.value[0]!;
    if (n > max) return { ok: false, error: { kind: "string-too-long", field, length: n, max } };
    const bytes = this.take(n, field);
    if (!bytes.ok) return bytes;
    const nul = bytes.value.indexOf(0);
    const text = new TextDecoder().decode(nul < 0 ? bytes.value : bytes.value.subarray(0, nul));
    return { ok: true, value: n === 0 ? null : text };
  }

  ipv4(field: "wired-ip" | "wireless-ip"): Result<Ipv4, ParseError> {
    const bytes = this.take(4, field);
    if (!bytes.ok) return bytes;
    const [a, b, c, d] = bytes.value;
    return { ok: true, value: [a!, b!, c!, d!] };
  }
}

/** Decodes the raw byte segment of the QR code (still XOR masked). */
export function decodeEpsonPayload(payload: Uint8Array): Result<EpsonRecord, ParseError> {
  const record = unmask(payload);
  if (record.length < 3) return { ok: false, error: { kind: "too-short" } };
  const declared = record[0]!;
  if (declared > record.length || declared < 3)
    return { ok: false, error: { kind: "length-exceeds-data", declared, available: record.length } };
  if (record[declared - 1] !== END_MARKER) return { ok: false, error: { kind: "missing-end-marker" } };

  const settings = record[1]!;
  const version = formatVersion(settings);
  if (version !== 2) return { ok: false, error: { kind: "unsupported-version", version } };
  if (reservedBit(settings)) return { ok: false, error: { kind: "reserved-bit-set" } };

  const wiring = record[2]!;
  const typeValue = recordTypeBits(wiring);
  const recordType = typeValue === 0 ? "projector" : typeValue === 1 ? "whiteboard" : null;
  if (recordType === null) return { ok: false, error: { kind: "unknown-record-type", value: typeValue } };

  const reader = new Reader(record, declared - 1);

  const wiredIp = hasWired(wiring) ? reader.ipv4("wired-ip") : null;
  if (wiredIp !== null && !wiredIp.ok) return wiredIp;
  const wirelessIp = hasWireless(wiring) ? reader.ipv4("wireless-ip") : null;
  if (wirelessIp !== null && !wirelessIp.ok) return wirelessIp;
  const interfaces: Interfaces =
    wiredIp && wirelessIp
      ? { kind: "both", wiredIp: wiredIp.value, wirelessIp: wirelessIp.value, preferred: prefersWired(wiring) ? "wired" : "wireless" }
      : wiredIp
        ? { kind: "wired", wiredIp: wiredIp.value }
        : wirelessIp
          ? { kind: "wireless", wirelessIp: wirelessIp.value }
          : { kind: "none" };

  const macBytes = reader.take(6, "mac");
  if (!macBytes.ok) return macBytes;
  const [m0, m1, m2, m3, m4, m5] = macBytes.value;
  const mac: Mac = [m0!, m1!, m2!, m3!, m4!, m5!];

  let connection: Connection;
  if (isAdvancedMode(settings)) {
    connection = { mode: "advanced", security: isWpa2(settings) ? { kind: "wpa2-psk-aes" } : { kind: "open" } };
  } else if (isWpa2(settings)) {
    const passphrase = reader.string("passphrase", PASSPHRASE_MAX);
    if (!passphrase.ok) return passphrase;
    connection = { mode: "quick", security: { kind: "wpa2-psk-aes", passphrase: passphrase.value } };
  } else {
    connection = { mode: "quick", security: { kind: "open" } };
  }

  const ssid = reader.string("ssid", SSID_MAX);
  if (!ssid.ok) return ssid;

  return {
    ok: true,
    value: { version: 2, recordType, connection, automaticSsid: !isManualSsid(settings), interfaces, mac, ssid: ssid.value },
  };
}
