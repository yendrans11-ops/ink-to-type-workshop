import { downloadBlob } from "./imageio";

export interface MobileConfigOptions {
  fontBytes: Uint8Array | number[];
  fontName: string;
  organization?: string;
  description?: string;
}

/**
 * Encodes a Uint8Array or byte array to a Base64 string safely without stack limits.
 */
export function uint8ArrayToBase64(bytes: Uint8Array | number[]): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const len = u8.byteLength;
  const chunkSize = 0x8000; // 32KB chunking
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = u8.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Escapes XML entities in strings.
 */
function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback UUID v4 generator
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generates an Apple Configuration Profile (.mobileconfig XML) embedding font data.
 * When downloaded in iOS / iPadOS Safari with MIME type application/x-apple-aspen-config,
 * iOS prompts the user with "Profile Downloaded" to install directly into iOS Settings.
 */
export function generateMobileConfig({
  fontBytes,
  fontName,
  organization = "TypeCraft",
  description,
}: MobileConfigOptions): string {
  const fontBase64 = uint8ArrayToBase64(fontBytes);
  const safeId = fontName.toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "custom-font";
  const itemUuid = generateUuid();
  const topUuid = generateUuid();
  const desc = description ?? `Installs the ${fontName} font on iOS and iPadOS.`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>Font</key>
            <data>
${fontBase64}
            </data>
            <key>PayloadDescription</key>
            <string>Configures font settings</string>
            <key>PayloadDisplayName</key>
            <string>${escapeXml(fontName)}</string>
            <key>PayloadIdentifier</key>
            <string>app.typecraft.font.${safeId}.${itemUuid}</string>
            <key>PayloadType</key>
            <string>com.apple.font</string>
            <key>PayloadUUID</key>
            <string>${itemUuid}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
        </dict>
    </array>
    <key>PayloadDescription</key>
    <string>${escapeXml(desc)}</string>
    <key>PayloadDisplayName</key>
    <string>${escapeXml(fontName)} (Font)</string>
    <key>PayloadIdentifier</key>
    <string>app.typecraft.profile.${safeId}.${topUuid}</string>
    <key>PayloadOrganization</key>
    <string>${escapeXml(organization)}</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>${topUuid}</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>`;
}

/**
 * Triggers a browser download of the Apple Configuration Profile (.mobileconfig)
 * with the correct MIME type for native iOS profile installer invocation.
 */
export function downloadMobileConfig(xml: string, fontName: string): void {
  const safeName = fontName.toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "custom-font";
  const blob = new Blob([xml], { type: "application/x-apple-aspen-config" });
  downloadBlob(blob, `${safeName}.mobileconfig`);
}
