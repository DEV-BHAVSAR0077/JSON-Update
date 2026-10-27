import type { JsonValue, WorkspaceDocument, WorkspaceState } from '../types'

const DATABASE_NAME = 'json-studio'
const STORE_NAME = 'workspace'
const WORKSPACE_KEY = 'current'

export const EMPTY_WORKSPACE: WorkspaceState = { version: 1, documents: [], activeDocumentId: null }

interface StoredWorkspace extends WorkspaceState {
  key: typeof WORKSPACE_KEY
}

export interface WorkspaceLoadResult {
  workspace: WorkspaceState
  warning: string | null
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  return Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.values(value).every((item) => isJsonValue(item, seen))
}

function isWorkspaceDocument(value: unknown): value is WorkspaceDocument {
  if (value === null || typeof value !== 'object') return false
  const document = value as Partial<WorkspaceDocument>
  if (
    typeof document.id !== 'string' || !document.id ||
    typeof document.filename !== 'string' ||
    typeof document.size !== 'number' || !Number.isFinite(document.size) || document.size < 0 ||
    typeof document.isDirty !== 'boolean' ||
    typeof document.searchQuery !== 'string' ||
    typeof document.updatedAt !== 'number' || !Number.isFinite(document.updatedAt) ||
    !isJsonValue(document.original) || !isJsonValue(document.working)
  ) return false
  if (document.savedJson !== null && typeof document.savedJson !== 'string') return false
  if (typeof document.savedJson === 'string') {
    try {
      if (!isJsonValue(JSON.parse(document.savedJson))) return false
    } catch {
      return false
    }
  }
  return true
}

export function normalizeWorkspace(value: unknown): WorkspaceLoadResult {
  if (value === undefined) return { workspace: EMPTY_WORKSPACE, warning: null }
  if (value === null || typeof value !== 'object') {
    return { workspace: EMPTY_WORKSPACE, warning: 'The saved workspace was unreadable and could not be restored.' }
  }
  const stored = value as Partial<StoredWorkspace>
  if (stored.version !== 1 || !Array.isArray(stored.documents)) {
    return { workspace: EMPTY_WORKSPACE, warning: 'The saved workspace format is unsupported or corrupted.' }
  }

  const documents = stored.documents.filter(isWorkspaceDocument)
  const activeDocumentId = typeof stored.activeDocumentId === 'string' && documents.some((document) => document.id === stored.activeDocumentId)
    ? stored.activeDocumentId
    : documents[0]?.id ?? null
  const recovered = documents.length !== stored.documents.length
  return {
    workspace: { version: 1, documents, activeDocumentId },
    warning: recovered ? 'Some damaged documents could not be restored. The remaining workspace is still available.' : null,
  }
}

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('IndexedDB is unavailable in this browser.'))
  databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open browser storage.'))
    request.onblocked = () => reject(new Error('Browser storage is blocked by another open tab.'))
  }).catch((error) => {
    databasePromise = null
    throw error
  })
  return databasePromise!
}

export async function loadWorkspace(): Promise<WorkspaceLoadResult> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(WORKSPACE_KEY)
    request.onsuccess = () => resolve(normalizeWorkspace(request.result))
    request.onerror = () => reject(request.error ?? new Error('Could not restore the saved workspace.'))
  })
}

export async function saveWorkspace(workspace: WorkspaceState): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put({ ...workspace, key: WORKSPACE_KEY } satisfies StoredWorkspace)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not persist the workspace.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Workspace persistence was interrupted.'))
  })
}
