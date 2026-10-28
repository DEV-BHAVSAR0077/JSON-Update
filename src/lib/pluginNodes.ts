import type { JsonValue, PluginConfig, PluginNode, WorkspaceState, WorkspaceValue } from '../types'
import { assertJsonValue, getRegisteredPlugin } from './plugins'

const trustedPluginNodes = new WeakSet<object>()

function createNodeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `plugin-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function hasPluginShape(value: unknown): value is PluginNode {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<PluginNode>
  const valid = candidate.__jsonDevNode === 'plugin'
    && typeof candidate.nodeId === 'string'
    && Boolean(candidate.nodeId)
    && typeof candidate.pluginId === 'string'
    && Boolean(candidate.pluginId)
    && candidate.config !== null
    && typeof candidate.config === 'object'
    && !Array.isArray(candidate.config)
    && Object.values(candidate.config).every((item) => ['string', 'number', 'boolean'].includes(typeof item) && (typeof item !== 'number' || Number.isFinite(item)))
  if (!valid) return false
  try {
    if (candidate.resolvedValue !== undefined) assertJsonValue(candidate.resolvedValue)
    return true
  } catch {
    return false
  }
}

function trust(node: PluginNode): PluginNode {
  trustedPluginNodes.add(node)
  return node
}

export function createPluginNode(pluginId: string, config: PluginConfig, nodeId = createNodeId(), resolvedValue?: JsonValue): PluginNode {
  return trust({ __jsonDevNode: 'plugin', nodeId, pluginId, config: { ...config }, ...(resolvedValue === undefined ? {} : { resolvedValue }) })
}

export function isPluginNode(value: unknown): value is PluginNode {
  return value !== null && typeof value === 'object' && trustedPluginNodes.has(value)
}

export function updatePluginNode(node: PluginNode, pluginId: string, config: PluginConfig): PluginNode {
  return createPluginNode(pluginId, config, node.nodeId)
}

export function resolvePluginNode(node: PluginNode, resolvedValue: JsonValue): PluginNode {
  return createPluginNode(node.pluginId, node.config, node.nodeId, resolvedValue)
}

export function collectPluginNodeIds(value: WorkspaceValue): string[] {
  const ids: string[] = []
  const visit = (node: WorkspaceValue): void => {
    if (isPluginNode(node)) {
      ids.push(node.nodeId)
      return
    }
    if (Array.isArray(node)) node.forEach(visit)
    else if (node !== null && typeof node === 'object') Object.values(node).forEach(visit)
  }
  visit(value)
  return ids
}

export function hydratePluginNodes(value: WorkspaceValue, authorizedIds: ReadonlySet<string>): WorkspaceValue {
  if (hasPluginShape(value) && authorizedIds.has(value.nodeId)) {
    return createPluginNode(value.pluginId, value.config, value.nodeId, value.resolvedValue)
  }
  if (Array.isArray(value)) return value.map((item) => hydratePluginNodes(item, authorizedIds))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hydratePluginNodes(item, authorizedIds)]))
  }
  return value
}

export function hydrateWorkspacePlugins(workspace: WorkspaceState): WorkspaceState {
  return {
    ...workspace,
    documents: workspace.documents.map((document) => {
      const working = hydratePluginNodes(document.working, new Set(document.pluginNodeIds ?? []))
      return { ...document, working, pluginNodeIds: collectPluginNodeIds(working) }
    }),
  }
}

export function hasPluginNodes(value: WorkspaceValue): boolean {
  if (isPluginNode(value)) return true
  if (Array.isArray(value)) return value.some(hasPluginNodes)
  return value !== null && typeof value === 'object' && Object.values(value).some(hasPluginNodes)
}

export function workspacePreviewValue(value: WorkspaceValue): JsonCompatiblePreview {
  if (isPluginNode(value)) {
    if (value.resolvedValue !== undefined) return value.resolvedValue
    const name = getRegisteredPlugin(value.pluginId)?.name ?? `Unavailable plugin: ${value.pluginId}`
    return `[Plugin: ${name} — pending]`
  }
  if (Array.isArray(value)) return value.map(workspacePreviewValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, workspacePreviewValue(item)]))
  }
  return value
}

type JsonCompatiblePreview = string | number | boolean | null | JsonCompatiblePreview[] | { [key: string]: JsonCompatiblePreview }
