import { t } from '../i18n'
/**
 * Project file on disk (`<name>.opnflvr`): a signature, then the exact JSON text of `serializeProject`, gzip-compressed.
 * Eight bytes of header: the ASCII signature `OPNFLVR` and one version byte, 1 = gzip stream follows, 2 = the JSON text
 * follows as is (written where `CompressionStream` does not exist; any reader opens both). Older projects, plain JSON
 * text (`.openflyover.json`, and the documents of « Mes projets »), have no signature and are read as they are.
 * Pure functions over `Blob`s and strings, no dependency: the browser's own (De)CompressionStream does the work.
 */

/** Extension of project files, without the dot. */
export const PROJECT_EXTENSION = 'opnflvr'
export const PROJECT_MIME_TYPE = 'application/x-opnflvr'
/** First bytes of a project file (ASCII). */
export const PROJECT_SIGNATURE = 'OPNFLVR'
/** Version byte after the signature: gzip stream of the JSON text. */
export const FILE_VERSION_GZIP = 1
/** Version byte after the signature: JSON text, not compressed (no CompressionStream here). */
export const FILE_VERSION_PLAIN = 2

const HEADER_LENGTH = PROJECT_SIGNATURE.length + 1
/** characters encoded and compressed per step: the text is never copied to bytes as a whole */
const CHUNK_CHARS = 1 << 20

/** The streams of the platform, taken from a scope so that a test can remove them. */
export interface CompressionScope {
  CompressionStream?: typeof CompressionStream
  DecompressionStream?: typeof DecompressionStream
}

function header(version: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(HEADER_LENGTH)
  for (let i = 0; i < PROJECT_SIGNATURE.length; i++) bytes[i] = PROJECT_SIGNATURE.charCodeAt(i)
  bytes[HEADER_LENGTH - 1] = version
  return bytes
}

/** UTF-8 bytes of `text`, one chunk at a time (a chunk never ends inside a surrogate pair). */
function textStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let at = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= text.length) {
        controller.close()
        return
      }
      let end = Math.min(text.length, at + CHUNK_CHARS)
      const last = text.charCodeAt(end - 1)
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end++
      controller.enqueue(encoder.encode(text.slice(at, end)))
      at = end
    },
  })
}

/** Stream of the bytes of `blob` (older engines and test environments have no `Blob.stream`). */
function blobStream(blob: Blob): ReadableStream<Uint8Array> {
  if (typeof blob.stream === 'function') return blob.stream()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(new Uint8Array(await blob.arrayBuffer()))
      controller.close()
    },
  })
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return chunks
    chunks.push(value)
  }
}

/** The file to write for `text` (the JSON of the project): compressed when the platform can, else flagged as plain. */
export async function encodeProjectFile(text: string, scope: CompressionScope = globalThis): Promise<Blob> {
  const compress = scope.CompressionStream
  if (typeof compress !== 'function') return new Blob([header(FILE_VERSION_PLAIN), text], { type: PROJECT_MIME_TYPE })
  const chunks = await drain(textStream(text).pipeThrough(new compress('gzip') as ReadableWritablePair<Uint8Array, Uint8Array>))
  return new Blob([header(FILE_VERSION_GZIP), ...(chunks as Uint8Array<ArrayBuffer>[])], { type: PROJECT_MIME_TYPE })
}

function hasSignature(head: Uint8Array): boolean {
  return head.length >= HEADER_LENGTH && [...PROJECT_SIGNATURE].every((c, i) => head[i] === c.charCodeAt(0))
}

/** JSON text of a project file; throws an Error with a French message when `file` is not a project. */
export async function decodeProjectFile(file: Blob, scope: CompressionScope = globalThis): Promise<string> {
  if (file.size === 0) throw new Error(t('project.file.empty'))
  const head = new Uint8Array(await file.slice(0, HEADER_LENGTH).arrayBuffer())
  if (!hasSignature(head)) {
    // a project saved before the .opnflvr format: JSON text
    const text = await file.text()
    if (!/^﻿?\s*\{/.test(text)) throw new Error(t('project.file.notProject'))
    return text
  }
  const version = head[HEADER_LENGTH - 1]
  if (version === FILE_VERSION_PLAIN) return file.slice(HEADER_LENGTH).text()
  if (version !== FILE_VERSION_GZIP) {
    throw new Error(t('project.file.newer'))
  }
  const decompress = scope.DecompressionStream
  if (typeof decompress !== 'function') throw new Error(t('project.file.noDecompress'))
  try {
    const chunks = await drain(blobStream(file.slice(HEADER_LENGTH)).pipeThrough(new decompress('gzip') as ReadableWritablePair<Uint8Array, Uint8Array>))
    const decoder = new TextDecoder()
    let text = ''
    for (const chunk of chunks) text += decoder.decode(chunk, { stream: true })
    return text + decoder.decode()
  } catch {
    throw new Error(t('project.file.damaged'))
  }
}
