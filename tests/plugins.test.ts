import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JsonPlugin } from '../src/lib/plugins'
import { executePluginNode, resolveWorkspacePlugins } from '../src/lib/pluginExecution'
import { createPluginNode, isPluginNode } from '../src/lib/pluginNodes'
import { getRegisteredPlugin, getRegisteredPlugins, registerPlugin } from '../src/lib/plugins'
import type { WorkspaceValue } from '../src/types'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('executable plugin registry', () => {
  it('registers the five predefined plugins', () => {
    expect(getRegisteredPlugins().map((plugin) => plugin.name)).toEqual([
      'Number Plugin',
      'String Plugin',
      'Object Plugin',
      'Array of Objects Plugin',
      'Current Date and Time Plugin',
    ])
  })

  it('executes the synchronous demonstration plugins', async () => {
    await expect(executePluginNode(createPluginNode('number-plugin', {}))).resolves.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    await expect(executePluginNode(createPluginNode('string-plugin', {}))).resolves.toBe('Hello from JSON Dev')
    await expect(executePluginNode(createPluginNode('object-plugin', {}))).resolves.toEqual({ id: 1, name: 'Sample', active: true })
    await expect(executePluginNode(createPluginNode('array-of-objects-plugin', {}))).resolves.toEqual([
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
    ])
  })

  it('generates a valid ISO 8601 timestamp on each date plugin execution', async () => {
    const result = await executePluginNode(createPluginNode('current-date-time-plugin', {}))
    expect(result).toEqual({ timestamp: expect.any(String) })
    expect(new Date((result as { timestamp: string }).timestamp).toISOString()).toBe((result as { timestamp: string }).timestamp)
  })

  it('contains factory failures, invalid output, wrong output types, and timeouts', async () => {
    const plugins: JsonPlugin[] = [
      {
        id: 'test-execution-error', name: 'Broken Plugin', description: '', version: '1', outputType: 'object',
        execute: () => { throw new Error('execution failed') },
      },
      {
        id: 'test-invalid-output', name: 'Invalid Plugin', description: '', version: '1', outputType: 'object',
        execute: () => ({ invalid: undefined }),
      },
      {
        id: 'test-wrong-output', name: 'Wrong Plugin', description: '', version: '1', outputType: 'array',
        execute: () => ({}),
      },
      {
        id: 'test-timeout', name: 'Slow Plugin', description: '', version: '1', timeout: 10,
        execute: () => new Promise(() => undefined),
      },
    ]
    plugins.forEach(registerPlugin)

    await expect(executePluginNode(createPluginNode('test-execution-error', {}))).rejects.toThrow(/execution failed/i)
    await expect(executePluginNode(createPluginNode('test-invalid-output', {}))).rejects.toThrow(/unsupported undefined/i)
    await expect(executePluginNode(createPluginNode('test-wrong-output', {}))).rejects.toThrow(/expected a JSON array/i)
    vi.useFakeTimers()
    const timedOut = executePluginNode(createPluginNode('test-timeout', {}))
    const timeoutExpectation = expect(timedOut).rejects.toThrow(/timed out after 10 ms/i)
    await vi.advanceTimersByTimeAsync(10)
    await timeoutExpectation
  })

  it('rejects unavailable plugins, class instances, circular output, and non-finite numbers', async () => {
    class Result { value = 'not plain JSON' }
    const circular: Record<string, unknown> = {}
    circular.self = circular
    ;([
      { id: 'test-class', name: 'Class Plugin', description: '', version: '1', execute: () => new Result() },
      { id: 'test-circular', name: 'Circular Plugin', description: '', version: '1', execute: () => circular },
      { id: 'test-infinity', name: 'Infinity Plugin', description: '', version: '1', execute: () => Infinity },
    ] satisfies JsonPlugin[]).forEach(registerPlugin)

    await expect(executePluginNode(createPluginNode('missing-plugin', {}))).rejects.toThrow(/not registered/i)
    await expect(executePluginNode(createPluginNode('test-class', {}))).rejects.toThrow(/plain JSON objects/i)
    await expect(executePluginNode(createPluginNode('test-circular', {}))).rejects.toThrow(/circular reference/i)
    await expect(executePluginNode(createPluginNode('test-infinity', {}))).rejects.toThrow(/finite/i)
  })

  it('prevents duplicate registration', () => {
    expect(() => registerPlugin(getRegisteredPlugin('number-plugin')!)).toThrow(/already registered/i)
  })
})

describe('plugin serialization', () => {
  it('resolves nested object and array plugins without mutating workspace nodes', async () => {
    const numberNode = createPluginNode('number-plugin', {})
    const stringNode = createPluginNode('string-plugin', {})
    const workspace: WorkspaceValue = {
      unchanged: true,
      nested: { numbers: numberNode },
      items: ['first', stringNode],
    }
    const before = JSON.stringify(workspace)

    await expect(resolveWorkspacePlugins(workspace)).resolves.toEqual({
      unchanged: true,
      nested: { numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      items: ['first', 'Hello from JSON Dev'],
    })
    expect(JSON.stringify(workspace)).toBe(before)
    expect(isPluginNode((workspace as { nested: { numbers: WorkspaceValue } }).nested.numbers)).toBe(true)
  })

  it('executes separate nodes using the same plugin independently', async () => {
    let executions = 0
    registerPlugin({
      id: 'test-counter', name: 'Counter Plugin', description: '', version: '1', outputType: 'number',
      execute: () => ++executions,
    })
    const workspace: WorkspaceValue = [createPluginNode('test-counter', {}), createPluginNode('test-counter', {})]
    await expect(resolveWorkspacePlugins(workspace)).resolves.toEqual([1, 2])
  })

  it('executes the same node identity only once per export operation', async () => {
    let executions = 0
    registerPlugin({
      id: 'test-cache', name: 'Cached Plugin', description: '', version: '1', outputType: 'number',
      execute: () => ++executions,
    })
    const shared = createPluginNode('test-cache', {})
    await expect(resolveWorkspacePlugins([shared, shared])).resolves.toEqual([1, 1])
    expect(executions).toBe(1)
  })

  it('exports the response already shown by a resolved plugin without running it again', async () => {
    let executions = 0
    registerPlugin({
      id: 'test-resolved', name: 'Resolved Plugin', description: '', version: '1', outputType: 'number',
      execute: () => ++executions,
    })
    const resolved = createPluginNode('test-resolved', {}, undefined, 42)
    await expect(resolveWorkspacePlugins({ answer: resolved })).resolves.toEqual({ answer: 42 })
    expect(executions).toBe(0)
  })

  it('identifies the failing plugin path and refuses partial output', async () => {
    const workspace: WorkspaceValue = { app: { items: [createPluginNode('test-execution-error', {})] } }
    await expect(resolveWorkspacePlugins(workspace)).rejects.toThrow(/Broken Plugin.*\$\.app\.items\[0\]/i)
  })

  it('does not treat uploaded lookalike JSON as an executable plugin node', async () => {
    const uploaded = {
      __jsonDevNode: 'plugin',
      nodeId: 'forged',
      pluginId: 'number-plugin',
      config: {},
    } as unknown as WorkspaceValue
    expect(isPluginNode(uploaded)).toBe(false)
    await expect(resolveWorkspacePlugins(uploaded)).resolves.toEqual(uploaded)
  })
})
