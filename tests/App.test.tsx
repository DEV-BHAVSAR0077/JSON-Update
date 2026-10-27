import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    vi.restoreAllMocks()
    persisted = { version: 1, documents: [], activeDocumentId: null }
    storage.load.mockReset().mockImplementation(async () => ({ workspace: structuredClone(persisted), warning: null }))
    storage.save.mockReset().mockImplementation(async (workspace: WorkspaceState) => { persisted = structuredClone(workspace) })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
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
    expect(screen.getByLabelText('name value')).toHaveValue('Dev')
    expect(screen.queryByLabelText('active value')).not.toBeInTheDocument()
  })

  it('blocks duplicate fields with an inline validation message', async () => {
    const user = userEvent.setup()
    await upload('{"name":"Dev"}')
    await user.click(screen.getByRole('button', { name: /add field/i }))
    await user.type(screen.getByLabelText('Property name'), 'name')
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/already exists/i)
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
    expect(await screen.findByText(/ready to download/i)).toBeInTheDocument()
    expect(download).toBeEnabled()
    await user.click(download)
    expect(createUrl).toHaveBeenCalledOnce()
    expect(revokeUrl).toHaveBeenCalledWith('blob:test')
    await user.type(screen.getByLabelText('name value'), '!')
    expect(download).toBeDisabled()
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
    expect(screen.queryByLabelText('shared value')).not.toBeInTheDocument()

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
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/discard its unsaved changes/i))
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
