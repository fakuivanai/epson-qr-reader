import { encodeQR } from "qr";
import { createEffect, createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import { decodeEpsonPayload, type EpsonRecord, type Interfaces, type Ipv4, type Mac, type ParseError, unmask } from "./epson";
import { describeParseError, formatTime, locale, locales, setLocale, t } from "./i18n";
import { type CameraResult, type CameraScan, type PhotoResult, scanCamera, scanPhoto } from "./scanner";
import { createLatest } from "./latest";
import { wifiQrText } from "./wifi";

type Status =
  | { kind: "prompt" | "searching" | "reading" | "read" | "copied" | "selected-to-copy" }
  | { kind: "no-camera" | "camera-failed" | "not-found" | "not-epson" | "unreadable-image" }
  | { kind: "parse-error"; error: ParseError };

type Scan = { bytes: Uint8Array; record: EpsonRecord; at: Date };

const isWarning = (s: Status) => ["no-camera", "camera-failed", "not-found", "not-epson", "unreadable-image", "parse-error"].includes(s.kind);

function statusText(s: Status): string {
  switch (s.kind) {
    case "prompt":
      return t("scan.prompt");
    case "searching":
      return t("scan.searching");
    case "reading":
      return t("scan.reading");
    case "read":
      return t("scan.read");
    case "copied":
      return t("result.copied");
    case "selected-to-copy":
      return t("result.selectedToCopy");
    case "no-camera":
      return t("scan.noCamera");
    case "camera-failed":
      return t("scan.cameraFailed");
    case "not-found":
      return t("scan.notFound");
    case "unreadable-image":
      return t("scan.unreadableImage");
    case "not-epson":
      return t("error.notEpson");
    case "parse-error":
      return describeParseError(s.error);
  }
}

const formatIp = (ip: Ipv4) => ip.join(".");
const formatMac = (mac: Mac) => mac.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");

function interfacesText(i: Interfaces): string {
  switch (i.kind) {
    case "wireless":
      return `${formatIp(i.wirelessIp)} (${t("result.wireless")})`;
    case "wired":
      return `${formatIp(i.wiredIp)} (${t("result.wired")})`;
    case "both": {
      const mark = (kind: "wired" | "wireless") => (i.preferred === kind ? `, ${t("result.preferred")}` : "");
      return `${formatIp(i.wirelessIp)} (${t("result.wireless")}${mark("wireless")}), ${formatIp(i.wiredIp)} (${t("result.wired")}${mark("wired")})`;
    }
    case "none":
      return t("result.notIncluded");
  }
}

function passphraseText(r: EpsonRecord): string {
  const { connection } = r;
  if (connection.security.kind === "open") return t("result.openNetwork");
  if (connection.mode === "advanced" || connection.security.passphrase === null) return t("result.passphraseNotInCode");
  return connection.security.passphrase;
}

const passphraseOf = (r: EpsonRecord): string | null =>
  r.connection.mode === "quick" && r.connection.security.kind === "wpa2-psk-aes" ? r.connection.security.passphrase : null;

function securityText(r: EpsonRecord): string {
  const security = r.connection.security.kind === "open" ? t("result.open") : "WPA2-PSK/AES";
  const mode = r.connection.mode === "quick" ? t("result.quickMode") : t("result.advancedMode");
  return `${security}, ${mode}`;
}

function Field(props: { label: string; children: JSX.Element; mono?: boolean }) {
  return (
    <div class="min-w-0">
      <dt class="text-sm text-muted">{props.label}</dt>
      <dd class={`break-all ${props.mono ? "font-mono" : ""}`}>{props.children}</dd>
    </div>
  );
}

const buttonSecondary =
  "rounded-lg border border-line px-4 py-2 cursor-pointer focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";

function WifiQr(props: { record: EpsonRecord }) {
  const text = () => wifiQrText(props.record);
  return (
    <div class="flex flex-col gap-2">
      <h3 class="font-semibold">{t("result.wifiQr")}</h3>
      <Show
        when={(() => {
          const r = text();
          return r.ok ? r.value : null;
        })()}
        fallback={
          <p class="text-sm text-muted">
            {(() => {
              const r = text();
              return !r.ok && r.error.kind === "missing-ssid" ? t("result.noSsid") : t("result.noPassphrase");
            })()}
          </p>
        }
      >
        {(value) => (
          <>
            {/* SVG markup produced by the qr library. It only sets a viewBox, so the box sets its size. */}
            <div class="w-56 max-w-full self-start rounded-lg bg-white p-3 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full" innerHTML={encodeQR(value(), "svg")} />
            <p class="break-all font-mono text-xs text-muted">{value()}</p>
          </>
        )}
      </Show>
    </div>
  );
}

export function App() {
  const [status, setStatus] = createSignal<Status>({ kind: "prompt" });
  const [scan, setScan] = createSignal<Scan | null>(null);
  const [camera, setCamera] = createSignal<CameraScan | null>(null);
  // Photo reads and camera starts overlap; only the latest one may report.
  const requests = createLatest();
  let video!: HTMLVideoElement;

  createEffect(() => {
    document.documentElement.lang = locale();
    document.title = t("title");
  });
  onCleanup(() => camera()?.stop());

  function accept(bytes: Uint8Array) {
    const result = decodeEpsonPayload(bytes);
    if (!result.ok) {
      setStatus({ kind: "parse-error", error: result.error });
      return;
    }
    setScan({ bytes, record: result.value, at: new Date() });
    setStatus({ kind: "read" });
  }

  function handle(result: CameraResult | PhotoResult) {
    if (result.ok) {
      accept(result.bytes);
      return;
    }
    const kinds = {
      "no-qr": "not-found",
      "not-binary": "not-epson",
      "camera-failed": "camera-failed",
      "unreadable-image": "unreadable-image",
    } as const;
    setStatus({ kind: kinds[result.error.kind] });
  }

  async function toggleCamera() {
    const running = camera();
    if (running !== null) {
      running.stop();
      setCamera(null);
      setStatus({ kind: "prompt" });
      return;
    }
    const token = requests.begin();
    try {
      const started = await scanCamera(video, (result) => {
        setCamera(null);
        if (requests.isCurrent(token)) handle(result);
      });
      setCamera(started);
      if (requests.isCurrent(token)) setStatus({ kind: "searching" });
    } catch {
      // Permission denied, no camera, or an insecure context.
      if (requests.isCurrent(token)) setStatus({ kind: "no-camera" });
    }
  }

  async function readPhoto(event: Event & { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (file === undefined) return;
    const token = requests.begin();
    setStatus({ kind: "reading" });
    try {
      const result = await scanPhoto(file);
      // A photo picked later, or a camera started meanwhile, takes precedence.
      if (requests.isCurrent(token)) handle(result);
    } finally {
      // Clearing the input lets the same file be picked again.
      input.value = "";
    }
  }

  async function copy(text: string, element: HTMLElement) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus({ kind: "copied" });
    } catch {
      const range = document.createRange();
      range.selectNodeContents(element);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      setStatus({ kind: "selected-to-copy" });
    }
  }

  let passphraseEl!: HTMLElement;
  let ssidEl!: HTMLElement;

  return (
    <main class="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <header class="flex items-center justify-between gap-3">
        <h1 class="text-2xl font-semibold">{t("title")}</h1>
        <div class="flex overflow-hidden rounded-lg border border-line" role="group" aria-label={t("language")}>
          <For each={locales}>
            {(l) => (
              <button
                type="button"
                lang={l}
                aria-pressed={locale() === l}
                class="cursor-pointer px-3 py-1 text-sm text-muted aria-pressed:bg-accent aria-pressed:text-on-accent"
                onClick={() => setLocale(l)}
              >
                {l.toUpperCase()}
              </button>
            )}
          </For>
        </div>
      </header>

      <section class="flex flex-col gap-3 rounded-xl border border-line bg-card p-4">
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="cursor-pointer rounded-lg bg-accent px-4 py-2 font-semibold text-on-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={() => void toggleCamera()}
          >
            {camera() === null ? t("scan.camera") : t("scan.stop")}
          </button>
          <label class={buttonSecondary} for="photo">
            {t("scan.photo")}
          </label>
          <input id="photo" type="file" accept="image/*" capture="environment" class="sr-only" onChange={(e) => void readPhoto(e)} />
        </div>
        <video ref={video} playsinline muted class="w-full rounded-lg bg-black" hidden={camera() === null} />
        <p class={`text-sm ${isWarning(status()) ? "text-warn" : status().kind === "read" || status().kind === "copied" ? "text-ok" : "text-muted"}`} aria-live="polite">
          {statusText(status())}
        </p>
      </section>

      <Show when={scan()}>
        {(s) => (
          <section class="flex flex-col gap-4 rounded-xl border border-line bg-card p-4">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <h2 class="font-semibold">{t("result.heading")}</h2>
              <span class="text-sm text-ok">{t("result.readAt", { time: formatTime(s().at) })}</span>
            </div>
            <dl class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t("result.ssid")} mono>
                <span ref={ssidEl}>{s().record.ssid ?? t("result.notIncluded")}</span>
              </Field>
              <Field label={t("result.passphrase")} mono>
                <span ref={passphraseEl} class="text-lg">
                  {passphraseText(s().record)}
                </span>
              </Field>
              <Field label={t("result.security")}>{securityText(s().record)}</Field>
              <Field label={t("result.ip")} mono>
                {interfacesText(s().record.interfaces)}
              </Field>
              <Field label={t("result.mac")} mono>
                {formatMac(s().record.mac)}
              </Field>
              <Field label={t("result.format")}>
                {t("result.version", { version: s().record.version })},{" "}
                {s().record.recordType === "projector" ? t("result.projectorRecord") : t("result.whiteboardRecord")}
              </Field>
            </dl>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class={buttonSecondary}
                disabled={passphraseOf(s().record) === null}
                onClick={() => {
                  const p = passphraseOf(s().record);
                  if (p !== null) void copy(p, passphraseEl);
                }}
              >
                {t("result.copyPassphrase")}
              </button>
              <button
                type="button"
                class={buttonSecondary}
                disabled={s().record.ssid === null}
                onClick={() => {
                  const ssid = s().record.ssid;
                  if (ssid !== null) void copy(ssid, ssidEl);
                }}
              >
                {t("result.copySsid")}
              </button>
            </div>
            <WifiQr record={s().record} />
            <details class="text-sm">
              <summary class="cursor-pointer text-muted">{t("result.bytes")}</summary>
              <pre class="mt-2 overflow-x-auto font-mono text-xs">
                {`QR:      ${hex(s().bytes)}\nXOR E5:  ${hex(unmask(s().bytes))}`}
              </pre>
            </details>
          </section>
        )}
      </Show>
    </main>
  );
}
