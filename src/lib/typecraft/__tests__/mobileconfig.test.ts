import { describe, expect, it } from "vitest";
import { generateMobileConfig, uint8ArrayToBase64 } from "../mobileconfig";

describe("mobileconfig profile generator", () => {
  it("converts byte arrays to base64 correctly", () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    expect(uint8ArrayToBase64(bytes)).toBe("SGVsbG8=");
  });

  it("generates an Apple Configuration Profile with com.apple.font payload", () => {
    const dummyFontBytes = new Uint8Array([0, 1, 0, 0, 65, 66, 67]);
    const xml = generateMobileConfig({
      fontBytes: dummyFontBytes,
      fontName: "Handwriting 2026",
    });

    expect(xml).toContain("<!DOCTYPE plist PUBLIC");
    expect(xml).toContain("<key>PayloadType</key>\n    <string>Configuration</string>");
    expect(xml).toContain("<key>PayloadType</key>\n            <string>com.apple.font</string>");
    expect(xml).toContain("<key>PayloadDisplayName</key>\n            <string>Handwriting 2026</string>");
    expect(xml).toContain("app.typecraft.font.handwriting-2026.");
    expect(xml).toContain("app.typecraft.profile.handwriting-2026.");
    expect(xml).toContain(uint8ArrayToBase64(dummyFontBytes));
  });

  it("escapes XML special characters in font metadata", () => {
    const dummyFontBytes = new Uint8Array([1, 2, 3]);
    const xml = generateMobileConfig({
      fontBytes: dummyFontBytes,
      fontName: "Tom & Jerry's <Font>",
      organization: "Art & Type",
    });

    expect(xml).toContain("Tom &amp; Jerry&apos;s &lt;Font&gt;");
    expect(xml).toContain("Art &amp; Type");
  });
});
