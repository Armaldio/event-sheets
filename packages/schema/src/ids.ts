import type { NodeId } from './types.js'

export function createNodeId(): NodeId {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
