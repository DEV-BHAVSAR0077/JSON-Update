import { describe, expect, it } from 'vitest'
import {
  createPluginValue,
  getDefaultPluginConfig,
  getRegisteredPlugin,
  getRegisteredPlugins,
  registerPlugin,
  type JsonPlugin,
} from '../src/lib/plugins'

describe('plugin registry', () => {
  it('registers the four trusted built-in plugins', () => {
    expect(getRegisteredPlugins().map((plugin) => plugin.id)).toEqual([
      'api-request',
      'database-config',
      'environment-variables',
      'custom-object-template',
    ])
  })

  it('generates valid defaults and applies configuration', () => {
    const api = getRegisteredPlugin('api-request')!
    const apiConfig = { ...getDefaultPluginConfig(api), method: 'POST' }
    expect(createPluginValue(api.id, apiConfig)).toEqual({ method: 'POST', url: '', headers: {}, body: null })

    const database = getRegisteredPlugin('database-config')!
    const databaseConfig = { ...getDefaultPluginConfig(database), port: 3306 }
    expect(createPluginValue(database.id, databaseConfig)).toEqual({ host: '', port: 3306, database: '', username: '' })
    expect(createPluginValue('environment-variables', {})).toEqual({ variables: {} })
    expect(createPluginValue('custom-object-template', {})).toEqual({ title: '', enabled: true, options: {} })
  })

  it('rejects missing plugins and invalid configuration', () => {
    expect(() => createPluginValue('missing', {})).toThrow(/not registered/i)
    expect(() => createPluginValue('database-config', { port: 0 })).toThrow(/at least 1/i)
    expect(() => createPluginValue('database-config', { port: 1.5 })).toThrow(/whole number/i)
    expect(() => createPluginValue('api-request', { method: 'TRACE' })).toThrow(/valid method/i)
  })

  it('contains factory failures and rejects non-JSON or mismatched output', () => {
    const cases: JsonPlugin[] = [
      {
        id: 'test-factory-error', name: 'Broken Factory', description: '', version: '1', outputType: 'object',
        createDefault: () => { throw new Error('template failed') },
      },
      {
        id: 'test-invalid-output', name: 'Invalid Output', description: '', version: '1', outputType: 'object',
        createDefault: () => ({ invalid: undefined }),
      },
      {
        id: 'test-wrong-output', name: 'Wrong Output', description: '', version: '1', outputType: 'array',
        createDefault: () => ({}),
      },
      {
        id: 'test-class-output', name: 'Class Output', description: '', version: '1', outputType: 'object',
        createDefault: () => new (class Template { value = 'hidden' })(),
      },
    ]
    cases.forEach(registerPlugin)

    expect(() => createPluginValue('test-factory-error', {})).toThrow(/template failed/i)
    expect(() => createPluginValue('test-invalid-output', {})).toThrow(/unsupported undefined/i)
    expect(() => createPluginValue('test-wrong-output', {})).toThrow(/must generate a JSON array/i)
    expect(() => createPluginValue('test-class-output', {})).toThrow(/plain JSON objects/i)
  })

  it('prevents duplicate registration', () => {
    expect(() => registerPlugin(getRegisteredPlugin('api-request')!)).toThrow(/already registered/i)
  })
})
