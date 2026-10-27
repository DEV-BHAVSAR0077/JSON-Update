import { describe, expect, it } from 'vitest'
import {
  addArrayItem,
  addObjectField,
  downloadName,
  getAtPath,
  getJsonStats,
  moveArrayItem,
  parseJsonText,
  removeAtPath,
  typeOfJson,
  updateAtPath,
  validateJsonTree,
} from '../src/lib/json'
import type { JsonValue } from '../src/types'

describe('JSON parsing and types', () => {
  it('parses valid object, array, and primitive roots', () => {
    expect(parseJsonText('{"ok":true}')).toEqual({ ok: true })
    expect(parseJsonText('[1,"two"]')).toEqual([1, 'two'])
    expect(parseJsonText('null')).toBeNull()
  })

  it('rejects invalid and empty JSON with a useful message', () => {
    expect(() => parseJsonText('')).toThrow(/empty/i)
    expect(() => parseJsonText('{"broken":}')).toThrow(/invalid json/i)
  })

  it('recognizes every JSON value type', () => {
    expect([typeOfJson(''), typeOfJson(0), typeOfJson(false), typeOfJson(null), typeOfJson({}), typeOfJson([])])
      .toEqual(['string', 'number', 'boolean', 'null', 'object', 'array'])
  })
})

describe('immutable tree operations', () => {
  const source: JsonValue = {
    profile: { name: 'Dev', age: 22, active: false, empty: null },
    projects: [{ name: 'Editor', tags: ['React'] }],
    untouched: 'keep me',
  }

  it('edits strings, numbers, and booleans without changing siblings', () => {
    const named = updateAtPath(source, ['profile', 'name'], 'Avery')
    const aged = updateAtPath(named, ['profile', 'age'], -4)
    const active = updateAtPath(aged, ['profile', 'active'], true)
    expect(getAtPath(active, ['profile'])).toEqual({ name: 'Avery', age: -4, active: true, empty: null })
    expect(getAtPath(active, ['untouched'])).toBe('keep me')
    expect(source).not.toBe(active)
  })

  it('preserves null until explicitly replaced', () => {
    expect(getAtPath(source, ['profile', 'empty'])).toBeNull()
    expect(getAtPath(updateAtPath(source, ['profile', 'empty'], {}), ['profile', 'empty'])).toEqual({})
  })

  it('adds an object field and rejects a duplicate in the same object', () => {
    const updated = addObjectField(source, ['profile'], 'email', '')
    expect(getAtPath(updated, ['profile', 'email'])).toBe('')
    expect(() => addObjectField(updated, ['profile'], 'email', '')).toThrow(/already exists/i)
  })

  it('adds a nested object that can receive its own field', () => {
    const withAddress = addObjectField(source, ['profile'], 'address', {})
    const updated = addObjectField(withAddress, ['profile', 'address'], 'city', 'Ahmedabad')
    expect(getAtPath(updated, ['profile', 'address', 'city'])).toBe('Ahmedabad')
  })

  it('adds and removes array items', () => {
    const added = addArrayItem(source, ['projects', 0, 'tags'], 'TypeScript')
    expect(getAtPath(added, ['projects', 0, 'tags'])).toEqual(['React', 'TypeScript'])
    expect(getAtPath(removeAtPath(added, ['projects', 0, 'tags', 0]), ['projects', 0, 'tags'])).toEqual(['TypeScript'])
  })

  it('edits objects inside arrays', () => {
    const updated = updateAtPath(source, ['projects', 0, 'name'], 'JSON Studio')
    expect(getAtPath(updated, ['projects', 0, 'name'])).toBe('JSON Studio')
  })

  it('treats dots, brackets, spaces, and Unicode as literal property names', () => {
    const special: JsonValue = { 'a.b': { '[key] with space': 'नमस्ते' } }
    const updated = updateAtPath(special, ['a.b', '[key] with space'], '你好')
    expect(getAtPath(updated, ['a.b', '[key] with space'])).toBe('你好')
  })

  it('removes an object property rather than setting it to null', () => {
    const updated = removeAtPath(source, ['profile', 'empty'])
    expect(Object.hasOwn(getAtPath(updated, ['profile']) as object, 'empty')).toBe(false)
  })

  it('reorders an array without losing values', () => {
    const data: JsonValue = { items: ['a', 'b', 'c'] }
    expect(getAtPath(moveArrayItem(data, ['items'], 2, 0), ['items'])).toEqual(['c', 'a', 'b'])
  })

  it('handles empty objects and arrays', () => {
    const data: JsonValue = { object: {}, array: [] }
    expect(addObjectField(data, ['object'], 'ready', false)).toEqual({ object: { ready: false }, array: [] })
    expect(addArrayItem(data, ['array'], 0)).toEqual({ object: {}, array: [0] })
  })
})

describe('save helpers', () => {
  it('validates serializable JSON and rejects non-finite numbers', () => {
    expect(() => validateJsonTree({ value: 0, empty: '', off: false, none: null })).not.toThrow()
    expect(() => validateJsonTree({ value: Number.POSITIVE_INFINITY })).toThrow(/finite/i)
  })

  it('produces formatted JSON that keeps distinct falsy values', () => {
    const data: JsonValue = { empty: '', zero: 0, off: false, none: null }
    validateJsonTree(data)
    expect(JSON.parse(JSON.stringify(data, null, 2))).toEqual(data)
  })

  it('creates a recognizable updated filename', () => {
    expect(downloadName('profile.json')).toBe('profile_updated.json')
    expect(downloadName('DATA.JSON')).toBe('DATA_updated.json')
  })

  it('reports object, array, property, and depth statistics', () => {
    expect(getJsonStats({ a: { b: [1] } })).toEqual({ properties: 2, objects: 2, arrays: 1, depth: 4 })
  })
})
