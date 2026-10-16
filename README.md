# Epson QR Reader

Reads the QR code an Epson projector shows for its iProjection app and shows
the projector's Wi-Fi network, password and addresses. It also makes a
standard Wi-Fi QR code that any phone camera can use to join the network.

Everything runs in the browser. Photos and codes are not uploaded.

## The format

The projector's code holds one binary byte segment. Every byte is XORed with
`0xE5`. After unmasking, the record is laid out as follows (format version 2):

| Offset | Contents |
|---|---|
| 0 | Record length, including the end marker |
| 1 | Connection settings: format version in the high nibble; bit 0 clear for quick mode, bit 1 set for WPA2-PSK/AES, bit 2 clear for an automatic SSID, bit 3 reserved |
| 2 | Interfaces: bit 0 wired, bit 1 wireless, bit 2 clear when wireless is preferred, bits 3 to 7 record type (0 projector, 1 whiteboard) |
| then | Wired IPv4 if wired, wireless IPv4 if wireless, MAC address (6 bytes) |
| then | Passphrase as a length byte and ASCII, only in quick mode with WPA2 |
| then | SSID as a length byte and ASCII |
| last | `0x80` end marker |

The layout follows the decoder in a decompiled copy of the iProjection Android
app; [`src/epson.ts`](src/epson.ts) links the exact sources. The XOR mask is
obfuscation, not encryption: anyone who can see the code on screen can read
the password.

## Development

```sh
npm install
npm run dev
npm test
npm run build
```

Pushing to `main` deploys the build to GitHub Pages.
