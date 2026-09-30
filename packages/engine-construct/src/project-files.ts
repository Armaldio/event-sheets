import type { JsonValue } from '@project/schema'

const binaryMarker = '__constructBinaryBase64'
const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export type ConstructProjectFileContent = string | Uint8Array

/** Keep binary project files serializable in document metadata. */
export function storeProjectFileContent(content: ConstructProjectFileContent): JsonValue {
  return typeof content === 'string'
    ? content
    : { [binaryMarker]: encodeBase64(content) }
}

/** Restore a preserved project file from document metadata. */
export function restoreProjectFileContent(value: JsonValue | undefined): ConstructProjectFileContent | undefined {
  if (typeof value === 'string') return value
  if (value === undefined || !isRecord(value)) return undefined
  const encoded = value[binaryMarker]
  if (typeof encoded !== 'string') return undefined
  return decodeBase64(encoded)
}

/** Check whether document metadata contains a preserved text or binary file. */
export function hasStoredProjectFileContent(value: JsonValue | undefined): boolean {
  if (typeof value === 'string') return true
  return value !== undefined && isRecord(value) && typeof value[binaryMarker] === 'string'
}

/** Decode project text files without converting arbitrary binary assets to replacement characters. */
export function decodeProjectText(content: ConstructProjectFileContent | undefined): string | undefined {
  if (typeof content === 'string') return content
  if (!(content instanceof Uint8Array)) return undefined
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch {
    return undefined
  }
}

function encodeBase64(bytes: Uint8Array): string {
  const output: string[] = []
  let chunk = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    chunk += base64Alphabet[first >> 2]
    chunk += base64Alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)]
    chunk += second === undefined
      ? '='
      : base64Alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)]
    chunk += third === undefined ? '=' : base64Alphabet[third & 63]
    if (chunk.length >= 16_384) {
      output.push(chunk)
      chunk = ''
    }
  }
  if (chunk) output.push(chunk)
  return output.join('')
}

function decodeBase64(text: string): Uint8Array | undefined {
  if (text.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    return undefined
  }
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const output = new Uint8Array((text.length / 4) * 3 - padding)
  let offset = 0
  for (let index = 0; index < text.length; index += 4) {
    const first = base64Alphabet.indexOf(text[index]!)
    const second = base64Alphabet.indexOf(text[index + 1]!)
    const third = text[index + 2] === '=' ? 0 : base64Alphabet.indexOf(text[index + 2]!)
    const fourth = text[index + 3] === '=' ? 0 : base64Alphabet.indexOf(text[index + 3]!)
    if (offset < output.length) output[offset++] = (first << 2) | (second >> 4)
    if (offset < output.length) output[offset++] = ((second & 15) << 4) | (third >> 2)
    if (offset < output.length) output[offset++] = ((third & 3) << 6) | fourth
  }
  return output
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
