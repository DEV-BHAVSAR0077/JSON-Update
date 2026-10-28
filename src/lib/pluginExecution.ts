import type { JsonPath, JsonValue, PluginConfig, PluginNode, WorkspaceValue } from '../types'
import { isPluginNode } from './pluginNodes'
import { assertJsonValue, getRegisteredPlugin, validatePluginConfig } from './plugins'
import { typeOfJson } from './json'

function timeoutFor(pluginId: string, config: PluginConfig): number {
  const plugin = getRegisteredPlugin(pluginId)
  if (!plugin?.timeout) return 10_000
  return typeof plugin.timeout === 'function' ? plugin.timeout(config) : plugin.timeout
}

export async function executePlugin(pluginId: string, config: PluginConfig): Promise<JsonValue> {
  const plugin = getRegisteredPlugin(pluginId)
  if (!plugin) throw new Error(`Plugin “${pluginId}” is not registered.`)
  validatePluginConfig(plugin, config)

  const controller = new AbortController()
  const timeout = timeoutFor(pluginId, config)
  let timeoutId: number | undefined
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = window.setTimeout(() => {
        controller.abort()
        reject(new Error(`Execution timed out after ${timeout} ms.`))
      }, timeout)
    })
    const value = await Promise.race([
      Promise.resolve().then(() => plugin.execute(config, { signal: controller.signal })),
      timeoutPromise,
    ])
    assertJsonValue(value)
    if (plugin.outputType && typeOfJson(value) !== plugin.outputType) {
      throw new Error(`Expected a JSON ${plugin.outputType}, but received ${typeOfJson(value)}.`)
    }
    const validationError = plugin.validate?.(value, config)
    if (validationError) throw new Error(validationError)
    return value
  } catch (error) {
    throw new Error(`${plugin.name}: ${error instanceof Error ? error.message : 'Execution failed.'}`)
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
  }
}

export function executePluginNode(node: PluginNode): Promise<JsonValue> {
  return executePlugin(node.pluginId, node.config)
}

function formatPath(path: JsonPath): string {
  if (!path.length) return '$'
  return path.reduce<string>((result, segment) => (
    typeof segment === 'number'
      ? `${result}[${segment}]`
      : /^[A-Za-z_$][\w$]*$/.test(segment)
        ? `${result}.${segment}`
        : `${result}[${JSON.stringify(segment)}]`
  ), '$')
}

export async function resolveWorkspacePlugins(value: WorkspaceValue): Promise<JsonValue> {
  const cache = new Map<string, Promise<JsonValue>>()

  const resolve = async (node: WorkspaceValue, path: JsonPath): Promise<JsonValue> => {
    if (isPluginNode(node)) {
      const execution = cache.get(node.nodeId) ?? Promise.resolve(node.resolvedValue === undefined ? executePluginNode(node) : node.resolvedValue)
      cache.set(node.nodeId, execution)
      try {
        return await execution
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : 'Plugin execution failed.'} Path: ${formatPath(path)}.`)
      }
    }
    if (Array.isArray(node)) return Promise.all(node.map((item, index) => resolve(item, [...path, index])))
    if (node !== null && typeof node === 'object') {
      const entries = await Promise.all(Object.entries(node).map(async ([key, item]) => [key, await resolve(item, [...path, key])] as const))
      return Object.fromEntries(entries)
    }
    return node
  }

  return resolve(value, [])
}
