/**
 * Minimal client-side ZIP builder.
 *
 * Uses the APPNOTE specification to create a valid ZIP file
 * without any external dependencies. Supports STORE (no compression)
 * and DEFLATE via the browser's CompressionStream API where available.
 *
 * This is intentionally lightweight — it only needs to package
 * already-downloaded blobs into a ZIP container.
 */

/** One entry in the ZIP file being built. */
interface ZipEntry {
  name: string;
  data: Uint8Array;
  compressed: Uint8Array;
  method: number; // 0 = stored, 8 = deflated
  crc32: number;
}

// CRC32 lookup table
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[i] = c;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** Try to compress with CompressionStream (available in modern browsers). */
async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const cs = new CompressionStream("deflate-raw");
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();

    // Copy to a plain ArrayBuffer to avoid SharedArrayBuffer type issues
    const ab = new ArrayBuffer(data.byteLength);
    new Uint8Array(ab).set(data);

    writer.write(new Uint8Array(ab));
    writer.close();

    const chunks: Uint8Array[] = [];
    let totalLen = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLen += value.length;
    }

    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  } catch {
    return null;
  }
}

function writeU16(buf: Uint8Array, offset: number, val: number) {
  buf[offset] = val & 0xFF;
  buf[offset + 1] = (val >> 8) & 0xFF;
}

function writeU32(buf: Uint8Array, offset: number, val: number) {
  buf[offset] = val & 0xFF;
  buf[offset + 1] = (val >> 8) & 0xFF;
  buf[offset + 2] = (val >> 16) & 0xFF;
  buf[offset + 3] = (val >> 24) & 0xFF;
}

/**
 * Build a ZIP blob from a list of DriveFile items.
 * Fetches each file with auth and packages them into a ZIP.
 */
export async function buildClientZip(items: import("@pagaska/shared").DriveFile[]): Promise<Blob> {
  const { API_URL, authHeaders } = await import("./api");
  const entries: ZipEntry[] = [];

  for (const item of items) {
    try {
      const url = item.mimeType === "application/vnd.google-apps.folder"
        ? `${API_URL}/download/folder?id=${encodeURIComponent(item.id)}`
        : `${API_URL}/download?id=${encodeURIComponent(item.id)}`;

      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) continue;

      const blob = await res.blob();
      const data = new Uint8Array(await blob.arrayBuffer());

      // Try deflate compression
      const compressed = await deflate(data);
      const method = compressed && compressed.length < data.length ? 8 : 0;
      const finalData = method === 8 ? compressed! : data;

      entries.push({
        name: item.mimeType === "application/vnd.google-apps.folder" ? `${item.name}.zip` : item.name,
        data,
        compressed: finalData,
        method,
        crc32: crc32(data),
      });
    } catch {
      // Skip failed items
    }
  }

  // Calculate total size
  let localSize = 0;
  let centralSize = 0;
  const offsets: number[] = [];

  for (const entry of entries) {
    offsets.push(localSize);
    const nameBytes = new TextEncoder().encode(entry.name);
    localSize += 30 + nameBytes.length + entry.compressed.length;
    centralSize += 46 + nameBytes.length;
  }

  const eocdSize = 22;
  const totalSize = localSize + centralSize + eocdSize;
  const buf = new Uint8Array(totalSize);
  let pos = 0;

  // Write local file headers + data
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const nameBytes = new TextEncoder().encode(entry.name);
    const offset = offsets[i];

    // Local file header
    writeU32(buf, pos, 0x04034b50); pos += 4; // signature
    writeU16(buf, pos, 20); pos += 2; // version needed
    writeU16(buf, pos, 0); pos += 2; // flags
    writeU16(buf, pos, entry.method); pos += 2; // compression method
    writeU16(buf, pos, 0); pos += 2; // mod time
    writeU16(buf, pos, 0); pos += 2; // mod date
    writeU32(buf, pos, entry.crc32); pos += 4; // crc32
    writeU32(buf, pos, entry.compressed.length); pos += 4; // compressed size
    writeU32(buf, pos, entry.data.length); pos += 4; // uncompressed size
    writeU16(buf, pos, nameBytes.length); pos += 2; // name length
    writeU16(buf, pos, 0); pos += 2; // extra length
    buf.set(nameBytes, pos); pos += nameBytes.length;
    buf.set(entry.compressed, pos); pos += entry.compressed.length;
  }

  // Write central directory
  const centralStart = pos;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const nameBytes = new TextEncoder().encode(entry.name);

    writeU32(buf, pos, 0x02014b50); pos += 4; // signature
    writeU16(buf, pos, 20); pos += 2; // version made by
    writeU16(buf, pos, 20); pos += 2; // version needed
    writeU16(buf, pos, 0); pos += 2; // flags
    writeU16(buf, pos, entry.method); pos += 2; // compression
    writeU16(buf, pos, 0); pos += 2; // mod time
    writeU16(buf, pos, 0); pos += 2; // mod date
    writeU32(buf, pos, entry.crc32); pos += 4; // crc32
    writeU32(buf, pos, entry.compressed.length); pos += 4; // compressed size
    writeU32(buf, pos, entry.data.length); pos += 4; // uncompressed size
    writeU16(buf, pos, nameBytes.length); pos += 2; // name length
    writeU16(buf, pos, 0); pos += 2; // extra length
    writeU16(buf, pos, 0); pos += 2; // comment length
    writeU16(buf, pos, 0); pos += 2; // disk number
    writeU16(buf, pos, 0); pos += 2; // internal attrs
    writeU32(buf, pos, 0); pos += 4; // external attrs
    writeU32(buf, pos, offsets[i]); pos += 4; // local header offset
    buf.set(nameBytes, pos); pos += nameBytes.length;
  }

  // End of central directory
  writeU32(buf, pos, 0x06054b50); pos += 4;
  writeU16(buf, pos, 0); pos += 2; // disk number
  writeU16(buf, pos, 0); pos += 2; // disk with central dir
  writeU16(buf, pos, entries.length); pos += 2; // entries on disk
  writeU16(buf, pos, entries.length); pos += 2; // total entries
  writeU32(buf, pos, centralSize); pos += 4; // central dir size
  writeU32(buf, pos, centralStart); pos += 4; // central dir offset
  writeU16(buf, pos, 0); pos += 2; // comment length

  return new Blob([buf], { type: "application/zip" });
}
