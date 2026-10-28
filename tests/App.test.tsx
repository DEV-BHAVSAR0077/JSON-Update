import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceState } from '../src/types'

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }))

vi.mock('../src/lib/workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/workspace')>()
  return { ...actual, loadWorkspace: storage.load, saveWorkspace: storage.save }
})

import App from '../src/App'

let persisted: WorkspaceState

function jsonFile(content: string, name = 'profile.json') {
  const file = new File([content], name, { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(content) })
  return file
}

async function upload(content: string, name?: string) {
  const view = render(<App />)
  await screen.findByRole('button', { name: /browse files/i })
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [jsonFile(content, name)] } })
  await screen.findByRole('heading', { name: 'Edit JSON' })
  return view
}

async function addFile(container: HTMLElement, content: string, name: string) {
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [jsonFile(content, name)] } })
  await screen.findByRole('button', { name: new RegExp(`Open ${name.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}`) })
}

describe('application workflow', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    persisted = { version: 1, documents: [], activeDocumentId: null }
    storage.load.mockReset().mockImplementation(async () => ({ workspace: structuredClone(persisted), warning: null }))
    storage.save.mockReset().mockImplementation(async (workspace: WorkspaceState) => { persisted = structuredClone(workspace) })
  })

  it('shows JSON Studio branding before and after opening a file', async () => {
    const view = render(<App />)
    await screen.findByRole('button', { name: /browse files/i })
    expect(screen.getByText('JSON Studio')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'JSON Studio logo' })).toHaveAttribute('src', '/json-dev-logo.png')
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [jsonFile('{"name":"Dev"}')] } })
    await screen.findByRole('heading', { name: 'Edit JSON' })
    expect(screen.getByText('JSON Studio')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'JSON Studio logo' })).toHaveAttribute('src', '/json-dev-logo.png')
  })

  it('uploads valid JSON and generates controls recursively for every type', async () => {
    await upload('{"name":"Dev","age":22,"active":false,"empty":null,"nested":{"tags":["React"]}}')
    expect(screen.getByLabelText('name value')).toHaveValue('Dev')
    expect(screen.getByLabelText('age value')).toHaveValue(22)
    expect(screen.getByLabelText('active value')).not.toBeChecked()
    expect(screen.getByLabelText('nested object')).toBeInTheDocument()
    expect(screen.getByLabelText('tags array')).toBeInTheDocument()
    expect(screen.getByLabelText('Change empty type')).toHaveValue('null')
  })

  it('keeps search and document overview above the file list', async () => {
    await upload('{"name":"Dev"}')
    const files = screen.getByRole('heading', { name: 'Files' })
    expect(screen.getByLabelText('Search active JSON').compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Document overview' }).compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('rejects invalid JSON while keeping the upload screen usable', async () => {
    const view = render(<App />)
    await screen.findByRole('button', { name: /browse files/i })
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [jsonFile('{broken}')] } })
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid json/i)
    expect(screen.getByRole('button', { name: /browse files/i })).toBeEnabled()
  })

  it('edits values, adds a field, and resets unsaved changes', async () => {
    const user = userEvent.setup()
    await upload('{"name":"Dev"}')
    await user.clear(screen.getByLabelText('name value'))
    await user.type(screen.getByLabelText('name value'), 'Avery')
    expect(screen.getByText(/unsaved changes in/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add field/i }))
    await user.type(screen.getByLabelText('Property name'), 'active')
    await user.selectOptions(screen.getByLabelText('Initial type'), 'boolean')
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    expect(screen.getByLabelText('active value')).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: /reset/i }))
    const resetDialog = screen.getByRole('alertdialog', { name: 'Reset changes?' })
    expect(resetDialog).toHaveTextContent(/restore the uploaded version/i)
    await user.click(within(resetDialog).getByRole('button', { name: 'Reset' }))
    expect(screen.getByLabelText('name value')).toHaveValue('Dev')
    expect(screen.queryByLabelText('active value')).not.toBeInTheDocument()
  })

  it('uses the themed confirmation dialog for non-empty object removal', async () => {
    const user = userEvent.setup()
    await upload('{"database":{"host":""},"keep":true}')
    await user.click(screen.getByRole('button', { name: 'Remove database' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Remove database?' })
    expect(dialog).toHaveTextContent(/everything inside it/i)
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('database object')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove database' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    expect(screen.queryByLabelText('database object')).not.toBeInTheDocument()
    expect(screen.getByLabelText('keep value')).toBeChecked()
  })

  it('blocks duplicate fields with an inline validation message', async () => {
    const user = userEvent.setup()
    await upload('{"name":"Dev"}')
    await user.click(screen.getByRole('button', { name: /add field/i }))
    await user.type(screen.getByLabelText('Property name'), 'name')
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/already exists/i)
  })

  it('executes a plugin while adding it and includes its value in JSON immediately', async () => {
    const user = userEvent.setup()
    await upload('{}')
    await user.click(screen.getByRole('button', { name: /add field/i }))
    await user.type(screen.getByLabelText('Property name'), 'numbers')

    const initialType = screen.getByLabelText('Initial type')
    expect(within(initialType).getByRole('option', { name: 'plugin' })).toBeInTheDocument()
    await user.selectOptions(initialType, 'plugin')
    const pluginSelect = screen.getByLabelText('Select Plugin')
    expect(within(pluginSelect).getByRole('option', { name: 'Number Plugin' })).toBeInTheDocument()
    expect(within(pluginSelect).queryByRole('option', { name: 'REST API Plugin' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/select a plugin/i)

    await user.selectOptions(pluginSelect, 'number-plugin')
    expect(screen.getByText(/numbers 1 through 10/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    const node = await screen.findByLabelText('numbers plugin')
    expect(within(node).getByText('Number Plugin', { selector: 'strong' })).toBeInTheDocument()
    expect(within(node).getByText('Included')).toBeInTheDocument()
    expect(within(node).getByLabelText('Number Plugin JSON preview')).toHaveTextContent('10')
    expect(screen.queryByText('__jsonDevNode')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /show json preview/i }))
    expect(document.querySelector('.preview-panel pre')).toHaveTextContent('"numbers": [')
    expect(document.querySelector('.preview-panel pre')).not.toHaveTextContent('__jsonDevNode')
    expect(document.querySelector('.preview-panel pre')).not.toHaveTextContent('number-plugin')

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    expect(await screen.findByText('Saved !', { selector: '.inline-message' })).toBeInTheDocument()
    expect(screen.getByLabelText('numbers plugin')).toBeInTheDocument()
    await waitFor(() => expect(JSON.parse(persisted.documents[0].savedJson!)).toEqual({ numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }))
    expect(persisted.documents[0].working).toMatchObject({ numbers: { pluginId: 'number-plugin', resolvedValue: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } })

    const createUrl = vi.fn().mockReturnValue('blob:plugin')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    await user.click(screen.getByRole('button', { name: /download json/i }))
    const downloaded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(createUrl.mock.calls[0][0] as Blob)
    })
    expect(downloaded).toBe(JSON.stringify({ numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, null, 2))
  })

  it('cancels plugin creation without changing the document', async () => {
    const user = userEvent.setup()
    await upload('{}')
    await user.click(screen.getByRole('button', { name: /add field/i }))
    await user.type(screen.getByLabelText('Property name'), 'discarded')
    await user.selectOptions(screen.getByLabelText('Initial type'), 'plugin')
    await user.selectOptions(screen.getByLabelText('Select Plugin'), 'object-plugin')
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByLabelText('discarded plugin')).not.toBeInTheDocument()
    expect(screen.getByText('This object is empty.')).toBeInTheDocument()
  })

  it('keeps plugin cards isolated by active file and restores their responses', async () => {
    const user = userEvent.setup()
    const view = await upload('{"items":[]}', 'first.json')
    await addFile(view.container, '{"items":[]}', 'second.json')
    const items = screen.getByLabelText('items array')
    await user.click(within(items).getByRole('button', { name: /add item/i }))
    await user.selectOptions(within(items).getByLabelText('Initial type'), 'plugin')
    await user.selectOptions(within(items).getByLabelText('Select Plugin'), 'string-plugin')
    await user.click(within(items).getByRole('button', { name: /^add$/i }))
    const pluginNode = await screen.findByLabelText('Item 1 plugin')
    expect(within(pluginNode).getByLabelText('String Plugin JSON preview')).toHaveTextContent('Hello from JSON Dev')

    await user.type(screen.getByLabelText('Search active JSON'), 'string')
    expect(screen.getByLabelText('Item 1 plugin')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /open first.json/i }))
    expect(screen.queryByLabelText('Item 1 plugin')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /open second.json/i }))
    expect(screen.getByLabelText('Search active JSON')).toHaveValue('string')
    expect(screen.getByLabelText('Item 1 plugin')).toBeInTheDocument()

    await waitFor(() => expect(persisted.documents.find((document) => document.filename === 'second.json')?.working).toMatchObject({
      items: [{ pluginId: 'string-plugin', resolvedValue: 'Hello from JSON Dev' }],
    }))
    view.unmount()
    render(<App />)
    const restored = await screen.findByLabelText('Item 1 plugin')
    expect(within(restored).getByLabelText('String Plugin JSON preview')).toHaveTextContent('Hello from JSON Dev')
  })

  it('restores an unavailable plugin node and blocks serialization', async () => {
    persisted = {
      version: 1,
      activeDocumentId: 'missing-plugin-document',
      documents: [{
        id: 'missing-plugin-document',
        filename: 'plugins.json',
        size: 1,
        original: {},
        working: {
          missing: { __jsonDevNode: 'plugin', nodeId: 'missing-node', pluginId: 'removed-plugin', config: {} },
        },
        pluginNodeIds: ['missing-node'],
        savedJson: null,
        isDirty: true,
        searchQuery: '',
        updatedAt: 1,
      }],
    }
    render(<App />)
    const node = await screen.findByLabelText('missing plugin')
    expect(within(node).getByText('Unavailable')).toBeInTheDocument()
    expect(within(node).queryByRole('button', { name: /run plugin/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/not registered.*\$\.missing/i)
    expect(screen.getByLabelText('missing plugin')).toBeInTheDocument()
  })

  it('enables download only for the active file latest saved version', async () => {
    const user = userEvent.setup()
    const createUrl = vi.fn().mockReturnValue('blob:test')
    const revokeUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    await upload('{"name":"Dev"}')
    const download = screen.getByRole('button', { name: /download json/i })
    expect(download).toBeDisabled()
    await user.clear(screen.getByLabelText('name value'))
    await user.type(screen.getByLabelText('name value'), 'Avery')
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved !')
    expect(download).toBeEnabled()
    await user.click(download)
    expect(createUrl).toHaveBeenCalledOnce()
    expect(revokeUrl).toHaveBeenCalledWith('blob:test')
    await user.type(screen.getByLabelText('name value'), '!')
    expect(download).toBeDisabled()
  })

  it('shows the save notification above preview for ten seconds', async () => {
    await upload('{"name":"Dev"}')
    fireEvent.change(screen.getByLabelText('name value'), { target: { value: 'Avery' } })
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    const notification = screen.getByRole('status')
    const preview = screen.getByRole('button', { name: /show json preview/i })
    expect(notification).toHaveTextContent('Saved !')
    expect(notification.parentElement).toHaveClass('workspace-actions')
    expect(notification.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    act(() => vi.advanceTimersByTime(9_999))
    expect(notification).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('adjusts the live preview code font size', async () => {
    const user = userEvent.setup()
    const view = await upload('{"name":"Dev"}')
    await user.click(screen.getByRole('button', { name: /show json preview/i }))
    const preview = view.container.querySelector('.preview-panel pre')!
    const decrease = screen.getByRole('button', { name: /decrease preview font size/i })
    const increase = screen.getByRole('button', { name: /increase preview font size/i })
    expect(preview).toHaveStyle({ fontSize: '11px' })
    expect(screen.getByText('11')).toBeInTheDocument()
    expect(screen.queryByText('11px')).not.toBeInTheDocument()

    await user.click(increase)
    expect(preview).toHaveStyle({ fontSize: '12px' })
    await user.click(decrease)
    await user.click(decrease)
    await user.click(decrease)
    expect(preview).toHaveStyle({ fontSize: '9px' })
    expect(decrease).toBeDisabled()
  })

  it('shows a red Failed notification with a trailing cross when save fails', async () => {
    persisted = {
      version: 1,
      activeDocumentId: 'invalid',
      documents: [{ id: 'invalid', filename: 'invalid.json', size: 1, original: 1, working: Infinity, pluginNodeIds: [], savedJson: null, isDirty: true, searchQuery: '', updatedAt: 1 }],
    }
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /save changes/i }))

    const notification = screen.getByRole('alert')
    expect(notification).toHaveClass('error')
    expect(notification).toHaveTextContent(/^Failed$/)
    expect(notification.lastElementChild?.tagName).toBe('svg')
  })

  it('restores uploaded files, the active file, and unsaved edits after remount', async () => {
    const user = userEvent.setup()
    const view = await upload('{"name":"Dev"}')
    await user.clear(screen.getByLabelText('name value'))
    await user.type(screen.getByLabelText('name value'), 'Restored')
    await waitFor(() => expect(persisted.documents[0]?.working).toEqual({ name: 'Restored' }))
    view.unmount()

    render(<App />)
    expect(await screen.findByLabelText('name value')).toHaveValue('Restored')
    expect(screen.getByText(/unsaved changes in profile.json/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open profile.json, document 1/i })).toHaveAttribute('aria-current', 'page')
  })

  it('coalesces rapid edits into one workspace persistence write', async () => {
    await upload('{"name":"Dev"}')
    await waitFor(() => expect(storage.save).toHaveBeenCalled())
    storage.save.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /show json preview/i }))
    const preview = document.querySelector('.preview-panel pre')!
    vi.useFakeTimers()

    const input = screen.getByLabelText('name value')
    fireEvent.change(input, { target: { value: 'D' } })
    fireEvent.change(input, { target: { value: 'De' } })
    fireEvent.change(input, { target: { value: 'Developer' } })
    expect(input).toHaveValue('Developer')
    expect(preview).toHaveTextContent('"name": "Dev"')
    expect(screen.getByText(/unsaved changes in/i)).toBeInTheDocument()
    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)
    act(() => vi.advanceTimersByTime(249))
    expect(storage.save).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(preview).toHaveTextContent('"name": "Developer"')
    act(() => vi.advanceTimersByTime(299))
    expect(storage.save).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(storage.save).toHaveBeenCalledOnce()
  })

  it('keeps duplicate filenames and document edits isolated while switching', async () => {
    const user = userEvent.setup()
    const view = await upload('{"name":"First"}')
    await addFile(view.container, '{"name":"Second"}', 'profile.json')
    expect(screen.getByLabelText('name value')).toHaveValue('Second')
    await user.clear(screen.getByLabelText('name value'))
    await user.type(screen.getByLabelText('name value'), 'Changed second')

    const first = screen.getByRole('button', { name: /open profile.json, document 1/i })
    const second = screen.getByRole('button', { name: /open profile.json, document 2/i })
    expect(second.closest('.file-card')).toHaveClass('active')
    expect(second).toHaveAttribute('aria-current', 'page')
    await user.click(first)
    expect(screen.getByLabelText('name value')).toHaveValue('First')
    expect(first.closest('.file-card')).toHaveClass('active')
    expect(second.closest('.file-card')).not.toHaveClass('active')
    await user.click(second)
    expect(screen.getByLabelText('name value')).toHaveValue('Changed second')
  })

  it('keeps search queries scoped to and restored for each active document', async () => {
    const user = userEvent.setup()
    const view = await upload('{"alpha":"one","shared":"first"}', 'first.json')
    const search = screen.getByLabelText('Search active JSON')
    await user.type(search, 'alpha')
    expect(screen.getByLabelText('alpha value')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByLabelText('shared value')).not.toBeInTheDocument())

    await addFile(view.container, '{"beta":"two","shared":"second"}', 'second.json')
    expect(screen.getByLabelText('Search active JSON')).toHaveValue('')
    expect(screen.getByLabelText('beta value')).toBeInTheDocument()
    expect(screen.queryByLabelText('alpha value')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /open first.json/i }))
    expect(screen.getByLabelText('Search active JSON')).toHaveValue('alpha')
    expect(screen.getByLabelText('alpha value')).toBeInTheDocument()
  })

  it('removes only the selected document and activates a remaining neighbor', async () => {
    const user = userEvent.setup()
    const view = await upload('{"name":"First"}', 'first.json')
    await addFile(view.container, '{"name":"Second"}', 'second.json')
    await user.clear(screen.getByLabelText('name value'))
    await user.type(screen.getByLabelText('name value'), 'Dirty')
    await user.click(screen.getByRole('button', { name: /close second.json/i }))
    const dialog = screen.getByRole('alertdialog', { name: 'Remove second.json?' })
    expect(dialog).toHaveTextContent(/permanently discard those changes/i)
    await user.click(within(dialog).getByRole('button', { name: 'Remove file' }))
    expect(screen.queryByRole('button', { name: /open second.json/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('name value')).toHaveValue('First')
    expect(screen.getByRole('button', { name: /open first.json/i })).toHaveAttribute('aria-current', 'page')
  })

  it('reports storage recovery warnings without crashing an empty workspace', async () => {
    storage.load.mockResolvedValueOnce({
      workspace: { version: 1, documents: [], activeDocumentId: null },
      warning: 'The saved workspace was unreadable and could not be restored.',
    })
    render(<App />)
    expect(await screen.findByRole('button', { name: /browse files/i })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be restored/i)
  })
})
