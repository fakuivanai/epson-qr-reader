import decodeQR from "qr/decode.js";
import { frameLoop, QRCanvas, rearCamera } from "qr/dom.js";

// The Epson payload is binary, so byte segments are decoded one character per
// byte and turned back into bytes afterwards.
const latin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes);

/** Null when the symbol holds characters outside a byte segment, such as kanji. */
function toBytes(text: string): Uint8Array | null {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) return null;
    bytes[i] = code;
  }
  return bytes;
}

export type ScanError = { kind: "no-qr" } | { kind: "not-binary" };
export type ScanResult = { ok: true; bytes: Uint8Array } | { ok: false; error: ScanError };

function fromText(text: string): ScanResult {
  const bytes = toBytes(text);
  return bytes === null ? { ok: false, error: { kind: "not-binary" } } : { ok: true, bytes };
}

// Large phone photos decode more reliably after downscaling.
const PHOTO_SIZES = [1200, 1800, 800, 2400];

export async function scanPhoto(file: Blob): Promise<ScanResult> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("2D canvas context unavailable");
    for (const size of PHOTO_SIZES) {
      const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      try {
        return fromText(decodeQR(image, { textDecoder: latin1 }));
      } catch {
        // decodeQR throws when it finds no symbol at this size; try the next one.
      }
    }
    return { ok: false, error: { kind: "no-qr" } };
  } finally {
    bitmap.close();
  }
}

export type CameraScan = { stop: () => void };
export type CameraResult = ScanResult | { ok: false; error: { kind: "camera-failed" } };

/** Scans the rear camera until a symbol decodes or reading fails, then stops and reports it. */
export async function scanCamera(video: HTMLVideoElement, onResult: (result: CameraResult) => void): Promise<CameraScan> {
  const camera = await rearCamera(video);
  const canvas = new QRCanvas({}, { textDecoder: latin1 });
  let busy = false;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancel();
    camera.stop();
  };
  const cancel = frameLoop(() => {
    if (busy || stopped) return;
    busy = true;
    void camera
      .readFrame(canvas)
      .then((result) => {
        if (typeof result === "string" && !stopped) {
          stop();
          onResult(fromText(result));
        }
      })
      .catch(() => {
        stop();
        onResult({ ok: false, error: { kind: "camera-failed" } });
      })
      .finally(() => {
        busy = false;
      });
  }, video);
  return { stop };
}
