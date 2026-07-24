import { describe, expect, it } from "vitest";
import { decodePcm16LeBase64 } from "./pcm";

function toBase64(bytes: number[]) {
  return btoa(String.fromCharCode(...bytes));
}

describe("decodePcm16LeBase64", () => {
  it("decodes signed little-endian PCM samples", () => {
    const result = decodePcm16LeBase64(
      toBase64([0x00, 0x00, 0x00, 0x80, 0xff, 0x7f]),
    );

    expect(Array.from(result.samples)).toEqual([
      0,
      -1,
      32767 / 32768,
    ]);
    expect(result.pendingByte).toBeNull();
  });

  it("carries an odd byte into the next streamed chunk", () => {
    const first = decodePcm16LeBase64(toBase64([0x00]));
    const second = decodePcm16LeBase64(
      toBase64([0x80]),
      first.pendingByte,
    );

    expect(first.samples).toHaveLength(0);
    expect(first.pendingByte).toBe(0);
    expect(Array.from(second.samples)).toEqual([-1]);
    expect(second.pendingByte).toBeNull();
  });
});
