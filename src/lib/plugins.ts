import type { ComponentType } from 'react'
import type { JsonType, JsonValue } from '../types'
import { typeOfJson } from './json'

export type PluginConfigValue = string | number | boolean
export type PluginConfig = Record<string, PluginConfigValue>

export interface PluginConfigField {
  key: string
  label: string
  type: 'text' | 'number' | 'select'
  defaultValue: PluginConfigValue
  options?: ReadonlyArray<{ label: string; value: string }>
  min?: number
  max?: number
  step?: number
}

export interface PluginConfigComponentProps {
  config: PluginConfig
  onChange: (config: PluginConfig) => void
}

export interface JsonPlugin {
  id: string
  name: string
  description: string
  version: string
  outputType: JsonType
  createDefault: (config: PluginConfig) => unknown
  configSchema?: readonly PluginConfigField[]
  validate?: (value: JsonValue, config: PluginConfig) => string | null
  ConfigComponent?: ComponentType<PluginConfigComponentProps>
}

const registry = new Map<string, JsonPlugin>()
const jsonTypes: JsonType[] = ['string', 'number', 'boolean', 'null', 'object', 'array']

/** Register trusted, locally imported plugins during application startup. */
export function registerPlugin(plugin: JsonPlugin): void {
  if (!plugin.id.trim() || !plugin.name.trim() || !plugin.version.trim()) throw new Error('Plugins require an id, name, and version.')
  if (!jsonTypes.includes(plugin.outputType)) throw new Error(`Plugin “${plugin.name}” has an unsupported output type.`)
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
  return Object.fromEntries((plugin.configSchema ?? []).map((field) => [field.key, field.defaultValue]))
}

function validateConfig(plugin: JsonPlugin, config: PluginConfig): void {
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
}

function assertJsonValue(value: unknown, ancestors = new WeakSet<object>()): asserts value is JsonValue {
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

export function createPluginValue(pluginId: string, config: PluginConfig): JsonValue {
  const plugin = getRegisteredPlugin(pluginId)
  if (!plugin) throw new Error('The selected plugin is not registered.')
  validateConfig(plugin, config)

  let value: unknown
  try {
    value = plugin.createDefault(config)
  } catch (error) {
    throw new Error(`Plugin could not generate data: ${error instanceof Error ? error.message : 'Unknown error.'}`)
  }
  assertJsonValue(value)
  if (typeOfJson(value) !== plugin.outputType) throw new Error(`Plugin must generate a JSON ${plugin.outputType}.`)
  const validationError = plugin.validate?.(value, config)
  if (validationError) throw new Error(validationError)
  return value
}

const builtInPlugins = [
  {
    id: 'api-request',
    name: 'API Request Object',
    description: 'Creates an editable HTTP request structure. It does not make a network request.',
    version: '1.0.0',
    outputType: 'object',
    configSchema: [{
      key: 'method', label: 'Method', type: 'select', defaultValue: 'GET',
      options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => ({ label: method, value: method })),
    }],
    createDefault: (config: PluginConfig) => ({ method: config.method, url: '', headers: {}, body: null }),
  },
  {
    id: 'database-config',
    name: 'Database Configuration',
    description: 'Creates connection settings without storing a password or other secret.',
    version: '1.0.0',
    outputType: 'object',
    configSchema: [{ key: 'port', label: 'Port', type: 'number', defaultValue: 5432, min: 1, max: 65535, step: 1 }],
    createDefault: (config: PluginConfig) => ({ host: '', port: config.port, database: '', username: '' }),
    validate: (_value: JsonValue, config: PluginConfig) => Number.isInteger(config.port) ? null : 'Port must be a whole number.',
  },
  {
    id: 'environment-variables',
    name: 'Environment Variables',
    description: 'Creates an empty variables object that can be populated with the existing editor.',
    version: '1.0.0',
    outputType: 'object',
    createDefault: () => ({ variables: {} }),
  },
  {
    id: 'custom-object-template',
    name: 'Custom Object Template',
    description: 'Demonstrates a trusted predefined template registered outside the field-creation UI.',
    version: '1.0.0',
    outputType: 'object',
    createDefault: () => ({ title: '', enabled: true, options: {} }),
  },
] satisfies JsonPlugin[]

builtInPlugins.forEach(registerPlugin)
