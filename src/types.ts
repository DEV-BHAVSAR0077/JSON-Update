export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue }
export type PluginConfigValue = string | number | boolean
export type PluginConfig = Record<string, PluginConfigValue>
export interface PluginNode {
  __jsonDevNode: 'plugin'
  nodeId: string
  pluginId: string
  config: PluginConfig
  resolvedValue?: JsonValue
}
export type WorkspaceValue = JsonPrimitive | WorkspaceObject | WorkspaceValue[] | PluginNode
export type WorkspaceObject = { [key: string]: WorkspaceValue }
export type JsonType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array'
export type JsonPath = Array<string | number>

export interface JsonStats {
  properties: number
  objects: number
  arrays: number
  depth: number
}

export interface WorkspaceDocument {
  id: string
  filename: string
  size: number
  original: JsonValue
  working: WorkspaceValue
  pluginNodeIds: string[]
  savedJson: string | null
  isDirty: boolean
  searchQuery: string
  updatedAt: number
}

export interface WorkspaceState {
  version: 1
  documents: WorkspaceDocument[]
  activeDocumentId: string | null
}
