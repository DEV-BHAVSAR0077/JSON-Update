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
