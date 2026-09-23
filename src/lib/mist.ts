import { createSharedNodeScope } from '@tik-choco/mistai'
import { MistNode } from '../vendor/mistlib/index.js'
import { mistSignalingConfig } from './mistSignaling'

export const NETWORK_NODE_KEY = 'tc-papers:network-node-v1'
export const createNetworkNode = createSharedNodeScope(id => new MistNode(id, mistSignalingConfig()))
