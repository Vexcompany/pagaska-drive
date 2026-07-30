/**
 * Streams a single chunk-sized slice of a Blob without loading the whole
 * file into memory. Uses `Blob.slice` + `Blob.stream()` to be safe for
 * multi-gigabyte files.
 *
 * Returns a Uint8Array suitable for use as a fetch body.
 */
export async function readChunk(blob, offset, length, signal) {
    if (signal?.aborted)
        throw new Error("aborted");
    const slice = blob.slice(offset, offset + length);
    // For File objects this is backed by the OS file handle, so it does
    // NOT materialize the entire file in RAM.
    const buf = await slice.arrayBuffer();
    if (signal?.aborted)
        throw new Error("aborted");
    return new Uint8Array(buf);
}
//# sourceMappingURL=stream.js.map