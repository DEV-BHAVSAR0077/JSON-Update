export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue }
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
  working: JsonValue
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
