import type { ComponentType } from 'react'
import type { JsonType, JsonValue, PluginConfig, PluginConfigValue } from '../types'

export type { PluginConfig, PluginConfigValue } from '../types'

export interface PluginConfigField {
  key: string
  label: string
  type: 'text' | 'number' | 'select'
  defaultValue: PluginConfigValue
  options?: ReadonlyArray<{ label: string; value: string }>
  min?: number
  max?: number
  step?: number
  placeholder?: string
}

export interface PluginConfigComponentProps {
  config: PluginConfig
  disabled?: boolean
  onChange: (config: PluginConfig) => void
}

export interface PluginExecutionContext {
  signal: AbortSignal
}

export interface JsonPlugin {
  id: string
  name: string
  description: string
  version: string
  defaultConfig?: PluginConfig
  configSchema?: readonly PluginConfigField[]
  outputType?: JsonType
  timeout?: number | ((config: PluginConfig) => number)
  execute: (config: PluginConfig, context: PluginExecutionContext) => unknown | Promise<unknown>
  validateConfig?: (config: PluginConfig) => string | null
  validate?: (value: JsonValue, config: PluginConfig) => string | null
  ConfigComponent?: ComponentType<PluginConfigComponentProps>
}

const registry = new Map<string, JsonPlugin>()
const jsonTypes: JsonType[] = ['string', 'number', 'boolean', 'null', 'object', 'array']

/** Register trusted, statically imported plugins during application startup. */
export function registerPlugin(plugin: JsonPlugin): void {
  if (!plugin.id.trim() || !plugin.name.trim() || !plugin.version.trim()) throw new Error('Plugins require an id, name, and version.')
  if (plugin.outputType && !jsonTypes.includes(plugin.outputType)) throw new Error(`Plugin “${plugin.name}” has an unsupported output type.`)
  if (typeof plugin.execute !== 'function') throw new Error(`Plugin “${plugin.name}” requires an execute function.`)
  if (registry.has(plugin.id)) throw new Error(`Plugin id “${plugin.id}” is already registered.`)
  registry.set(plugin.id, plugin)
}

export function getRegisteredPlugins(): readonly JsonPlugin[] {
  return [...registry.values()]
}

export function getRegisteredPlugin(id: string): JsonPlugin | undefined {
  return registry.get(id)
}

export function getDefaultPluginConfig(plugin: JsonPlugin): PluginConfig {
  return {
    ...Object.fromEntries((plugin.configSchema ?? []).map((field) => [field.key, field.defaultValue])),
    ...plugin.defaultConfig,
  }
}

export function validatePluginConfig(plugin: JsonPlugin, config: PluginConfig): void {
  for (const field of plugin.configSchema ?? []) {
    const value = config[field.key]
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field.label} must be a valid number.`)
      if (field.min !== undefined && value < field.min) throw new Error(`${field.label} must be at least ${field.min}.`)
      if (field.max !== undefined && value > field.max) throw new Error(`${field.label} must be at most ${field.max}.`)
    } else if (typeof value !== 'string') {
      throw new Error(`${field.label} must be text.`)
    }
    if (field.type === 'select' && !field.options?.some((option) => option.value === value)) {
      throw new Error(`Choose a valid ${field.label.toLocaleLowerCase()}.`)
    }
  }
  const error = plugin.validateConfig?.(config)
  if (error) throw new Error(error)
}

export function assertJsonValue(value: unknown, ancestors = new WeakSet<object>()): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Generated numbers must be finite.')
    return
  }
  if (typeof value !== 'object') throw new Error(`Generated data contains unsupported ${typeof value} values.`)
  if (ancestors.has(value)) throw new Error('Generated data contains a circular reference.')
  ancestors.add(value)

  if (Array.isArray(value)) {
    if (Object.keys(value).some((key) => !/^\d+$/.test(key)) || Object.keys(value).length !== value.length) {
      throw new Error('Generated arrays must contain standard JSON items.')
    }
    value.forEach((item) => assertJsonValue(item, ancestors))
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new Error('Generated objects must be plain JSON objects.')
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new Error('Generated objects cannot contain symbol properties.')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new Error('Generated objects must contain ordinary JSON properties.')
      assertJsonValue(descriptor.value, ancestors)
    }
  }
  ancestors.delete(value)
}

const builtInPlugins = [
  {
    id: 'number-plugin',
    name: 'Number Plugin',
    description: 'Returns the numbers 1 through 10 as a JSON array.',
    version: '1.0.0',
    outputType: 'array',
    execute: () => Array.from({ length: 10 }, (_, index) => index + 1),
  },
  {
    id: 'string-plugin',
    name: 'String Plugin',
    description: 'Returns a sample JSON string.',
    version: '1.0.0',
    outputType: 'string',
    execute: () => 'Hello from JSON Dev',
  },
  {
    id: 'object-plugin',
    name: 'Object Plugin',
    description: 'Returns a sample object containing an ID, name, and active status.',
    version: '1.0.0',
    outputType: 'object',
    execute: () => ({ id: 1, name: 'Sample', active: true }),
  },
  {
    id: 'array-of-objects-plugin',
    name: 'Array of Objects Plugin',
    description: 'Returns two sample objects in an array.',
    version: '1.0.0',
    outputType: 'array',
    execute: () => [{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }],
  },
  {
    id: 'current-date-time-plugin',
    name: 'Current Date and Time Plugin',
    description: 'Generates a fresh ISO 8601 timestamp each time it runs.',
    version: '1.0.0',
    outputType: 'object',
    execute: () => ({ timestamp: new Date().toISOString() }),
  },
] satisfies JsonPlugin[]

builtInPlugins.forEach(registerPlugin)
