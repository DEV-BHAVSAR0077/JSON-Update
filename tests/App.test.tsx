import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'

function jsonFile(content: string, name = 'profile.json') {
  const file = new File([content], name, { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(content) })
  return file
}

async function upload(content: string, name?: string) {
  const { container } = render(<App />)
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [jsonFile(content, name)] } })
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Edit JSON' })).toBeInTheDocument())
  return container
}

describe('application workflow', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
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
    const { container } = render(<App />)
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [jsonFile('{broken}')] } })
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid json/i)
    expect(screen.getByRole('button', { name: /browse files/i })).toBeEnabled()
  })

  it('edits values, adds a field, and resets unsaved changes', async () => {
    const user = userEvent.setup()
    await upload('{"name":"Dev"}')
    await user.clear(screen.getByLabelText('name value'))
    await user.type(screen.getByLabelText('name value'), 'Avery')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
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

  it('enables download only for the latest successfully saved version', async () => {
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
})
