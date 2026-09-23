import { createSharedNodeScope, getPersistentNodeId } from '@tik-choco/mistai'
import { MistNode } from '../vendor/mistlib/index.js'
import { mistSignalingConfig } from './mistSignaling'

export const NETWORK_NODE_KEY = 'tc-papers:network-node-v1'
export const createNetworkNode = createSharedNodeScope(id => new MistNode(id, mistSignalingConfig()))

let storageReady: Promise<void> | null = null
/** The CID store (storage_get/storage_add) only works once the page's single MistNode is initialized. */
export function ensureMistStorage(): Promise<void> {
  storageReady ||= createNetworkNode(getPersistentNodeId(NETWORK_NODE_KEY)).init().catch(error => { storageReady = null; throw error })
  return storageReady
}
