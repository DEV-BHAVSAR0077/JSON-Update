import { describe, expect, it } from 'vitest'
import { EMPTY_WORKSPACE, normalizeWorkspace } from '../src/lib/workspace'
import { createPluginNode, isPluginNode } from '../src/lib/pluginNodes'

const validDocument = {
  id: 'doc-1',
  filename: 'data.json',
  size: 20,
  original: { name: 'original' },
  working: { name: 'edited' },
  pluginNodeIds: [],
  savedJson: null,
  isDirty: true,
  searchQuery: 'name',
  updatedAt: 1,
}

describe('workspace recovery', () => {
  it('restores valid documents and the last active ID', () => {
    const result = normalizeWorkspace({ key: 'current', version: 1, documents: [validDocument], activeDocumentId: 'doc-1' })
    expect(result.workspace.documents).toEqual([validDocument])
    expect(result.workspace.activeDocumentId).toBe('doc-1')
    expect(result.warning).toBeNull()
  })

  it('recovers valid documents when another stored document is corrupt', () => {
    const result = normalizeWorkspace({
      version: 1,
      documents: [validDocument, { ...validDocument, id: 'bad', working: { value: Number.POSITIVE_INFINITY } }],
      activeDocumentId: 'bad',
    })
    expect(result.workspace.documents).toEqual([validDocument])
    expect(result.workspace.activeDocumentId).toBe('doc-1')
    expect(result.warning).toMatch(/damaged documents/i)
  })

  it('returns an empty workspace with an honest warning for invalid storage', () => {
    expect(normalizeWorkspace(undefined)).toEqual({ workspace: EMPTY_WORKSPACE, warning: null })
    expect(normalizeWorkspace({ version: 99, documents: [] }).workspace).toEqual(EMPTY_WORKSPACE)
    expect(normalizeWorkspace('broken').warning).toMatch(/unreadable/i)
  })

  it('rejects an invalid saved JSON snapshot without losing healthy documents', () => {
    const result = normalizeWorkspace({
      version: 1,
      documents: [validDocument, { ...validDocument, id: 'bad', savedJson: '{broken}' }],
      activeDocumentId: 'doc-1',
    })
    expect(result.workspace.documents).toHaveLength(1)
    expect(result.workspace.documents[0].id).toBe('doc-1')
  })

  it('restores authorized plugin nodes with their response but leaves unlisted lookalikes unchanged', () => {
    const plugin = createPluginNode('number-plugin', {}, undefined, [1, 2, 3])
    const storedPlugin = structuredClone(plugin)
    const result = normalizeWorkspace({
      version: 1,
      documents: [{ ...validDocument, working: { plugin: storedPlugin }, pluginNodeIds: [plugin.nodeId] }],
      activeDocumentId: 'doc-1',
    })
    const restored = (result.workspace.documents[0].working as { plugin: { resolvedValue?: unknown } }).plugin
    expect(isPluginNode(restored)).toBe(true)
    expect(restored.resolvedValue).toEqual([1, 2, 3])

    const untrusted = normalizeWorkspace({
      version: 1,
      documents: [{ ...validDocument, working: { plugin: storedPlugin }, pluginNodeIds: [] }],
      activeDocumentId: 'doc-1',
    })
    expect(isPluginNode((untrusted.workspace.documents[0].working as { plugin: unknown }).plugin)).toBe(false)
  })
})
