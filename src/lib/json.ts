import type { JsonPath, JsonStats, JsonType, JsonValue, WorkspaceObject, WorkspaceValue } from '../types'

export const MAX_FILE_SIZE = 5 * 1024 * 1024

export function typeOfJson(value: JsonValue): JsonType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value as JsonType
}

export function defaultForType(type: JsonType): JsonValue {
  return { string: '', number: 0, boolean: false, null: null, object: {}, array: [] }[type]
}

export function getAtPath(root: WorkspaceValue, path: JsonPath): WorkspaceValue {
  return path.reduce<WorkspaceValue>((node, segment) => {
    if (typeof segment === 'number' && Array.isArray(node)) return node[segment]
    if (typeof segment === 'string' && node !== null && typeof node === 'object' && !Array.isArray(node)) return (node as WorkspaceObject)[segment]
    throw new Error('Invalid JSON path')
  }, root)
}

export function updateAtPath(root: WorkspaceValue, path: JsonPath, value: WorkspaceValue): WorkspaceValue {
  if (path.length === 0) return value
  const [segment, ...rest] = path
  if (typeof segment === 'number' && Array.isArray(root)) {
    return root.map((item, index) => (index === segment ? updateAtPath(item, rest, value) : item))
  }
  if (typeof segment === 'string' && root !== null && typeof root === 'object' && !Array.isArray(root)) {
    const object = root as WorkspaceObject
    return { ...object, [segment]: updateAtPath(object[segment], rest, value) }
  }
  throw new Error('Invalid JSON path')
}

export function removeAtPath(root: WorkspaceValue, path: JsonPath): WorkspaceValue {
  if (path.length === 0) throw new Error('The root value cannot be removed')
  const parentPath = path.slice(0, -1)
  const key = path.at(-1)!
  const parent = getAtPath(root, parentPath)
  let nextParent: WorkspaceValue

  if (typeof key === 'number' && Array.isArray(parent)) {
    nextParent = parent.filter((_, index) => index !== key)
  } else if (typeof key === 'string' && parent !== null && typeof parent === 'object' && !Array.isArray(parent)) {
    const remaining: WorkspaceObject = { ...(parent as WorkspaceObject) }
    delete remaining[key]
    nextParent = remaining
  } else {
    throw new Error('Invalid JSON path')
  }
  return updateAtPath(root, parentPath, nextParent)
}

export function addObjectField(root: WorkspaceValue, path: JsonPath, key: string, value: WorkspaceValue): WorkspaceValue {
  const parent = getAtPath(root, path)
  if (parent === null || typeof parent !== 'object' || Array.isArray(parent)) throw new Error('Target is not an object')
  if (Object.prototype.hasOwnProperty.call(parent, key)) throw new Error(`“${key}” already exists in this object`)
  return updateAtPath(root, path, { ...parent, [key]: value })
}

export function addArrayItem(root: WorkspaceValue, path: JsonPath, value: WorkspaceValue): WorkspaceValue {
  const parent = getAtPath(root, path)
  if (!Array.isArray(parent)) throw new Error('Target is not an array')
  return updateAtPath(root, path, [...parent, value])
}

export function moveArrayItem(root: WorkspaceValue, path: JsonPath, from: number, to: number): WorkspaceValue {
  const parent = getAtPath(root, path)
  if (!Array.isArray(parent) || to < 0 || to >= parent.length) return root
  const next = [...parent]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return updateAtPath(root, path, next)
}

export function parseJsonText(text: string): JsonValue {
  if (!text.trim()) throw new Error('This file is empty. Choose a JSON file with content.')
  try {
    return JSON.parse(text) as JsonValue
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON'
    const position = /position\s+(\d+)/i.exec(message)?.[1]
    if (!position) throw new Error(`Invalid JSON: ${message}`)
    const offset = Number(position)
    const before = text.slice(0, offset)
    const line = before.split('\n').length
    const column = offset - before.lastIndexOf('\n')
    throw new Error(`Invalid JSON at line ${line}, column ${column}.`)
  }
}

export function validateJsonTree(value: JsonValue): void {
  const seen = new WeakSet<object>()
  const visit = (node: JsonValue): void => {
    if (typeof node === 'number' && !Number.isFinite(node)) throw new Error('Numbers must be finite.')
    if (node === null || typeof node !== 'object') return
    if (seen.has(node)) throw new Error('Circular references are not valid JSON.')
    seen.add(node)
    Object.values(node).forEach(visit)
  }
  visit(value)
  JSON.stringify(value)
}

export function getJsonStats(value: WorkspaceValue): JsonStats {
  const stats: JsonStats = { properties: 0, objects: 0, arrays: 0, depth: 0 }
  const visit = (node: WorkspaceValue, depth: number): void => {
    stats.depth = Math.max(stats.depth, depth)
    if (node !== null && typeof node === 'object' && !Array.isArray(node) && '__jsonDevNode' in node && node.__jsonDevNode === 'plugin') return
    if (Array.isArray(node)) {
      stats.arrays += 1
      node.forEach((item) => visit(item, depth + 1))
    } else if (node !== null && typeof node === 'object') {
      stats.objects += 1
      stats.properties += Object.keys(node).length
      Object.values(node).forEach((item) => visit(item, depth + 1))
    }
  }
  visit(value, 1)
  return stats
}

export function matchesSearch(label: string, value: WorkspaceValue, query: string): boolean {
  if (!query) return true
  const target = query.toLocaleLowerCase()
  if (label.toLocaleLowerCase().includes(target)) return true
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && '__jsonDevNode' in value && value.__jsonDevNode === 'plugin') {
    return String(value.pluginId).toLocaleLowerCase().includes(target)
  }
  if (Array.isArray(value)) return value.some((item, index) => matchesSearch(String(index), item, target))
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(([key, item]) => matchesSearch(key, item, target))
  }
  return String(value).toLocaleLowerCase().includes(target)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(bytes < 1024 * 1024 ? 1 : 0)} ${bytes < 1024 * 1024 ? 'KB' : 'MB'}`
}

export function downloadName(filename: string): string {
  const base = filename.replace(/\.json$/i, '') || 'data'
  return `${base}_updated.json`
}

export function isNonEmptyContainer(value: WorkspaceValue): value is WorkspaceObject | WorkspaceValue[] {
  return value !== null && typeof value === 'object' && Object.keys(value).length > 0
}
