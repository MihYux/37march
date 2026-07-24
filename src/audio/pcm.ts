export interface DecodedPcmChunk {
  samples: Float32Array;
  pendingByte: number | null;
}

export function decodePcm16LeBase64(
  audioBase64: string,
  pendingByte: number | null = null,
): DecodedPcmChunk {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(
    binary.length + (pendingByte === null ? 0 : 1),
  );
  let offset = 0;
  if (pendingByte !== null) {
    bytes[0] = pendingByte;
    offset = 1;
  }
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index + offset] = binary.charCodeAt(index);
  }

  const completeByteLength = bytes.length - (bytes.length % 2);
  const samples = new Float32Array(completeByteLength / 2);
  for (let index = 0; index < completeByteLength; index += 2) {
    const unsigned = bytes[index] | (bytes[index + 1] << 8);
    const signed = unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
    samples[index / 2] = signed / 0x8000;
  }

  return {
    samples,
    pendingByte:
      completeByteLength < bytes.length
        ? bytes[bytes.length - 1]
        : null,
  };
}
