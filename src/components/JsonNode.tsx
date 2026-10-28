import { memo, startTransition, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Plug, Plus, Trash2 } from 'lucide-react'
import type { JsonPath, JsonType, JsonValue, PluginConfig, PluginNode, WorkspaceObject, WorkspaceValue } from '../types'
import { defaultForType, isNonEmptyContainer, matchesSearch, typeOfJson } from '../lib/json'
import { executePluginNode } from '../lib/pluginExecution'
import { createPluginNode, isPluginNode, resolvePluginNode, updatePluginNode } from '../lib/pluginNodes'
import { getDefaultPluginConfig, getRegisteredPlugin, getRegisteredPlugins, type JsonPlugin } from '../lib/plugins'
import type { ConfirmationRequest } from './ConfirmDialog'
import { DraftTextInput } from './DraftTextInput'

const types: JsonType[] = ['string', 'number', 'boolean', 'null', 'object', 'array']
type CreationType = JsonType | 'plugin'

interface JsonNodeProps {
  label: string
  value: WorkspaceValue
  path: JsonPath
  query: string
  root?: boolean
  onChange: (path: JsonPath, value: WorkspaceValue) => void
  onRemove: (path: JsonPath) => void
  onAddObject: (path: JsonPath, key: string, value: WorkspaceValue) => void
  onAddArray: (path: JsonPath, value: WorkspaceValue) => void
  onMove: (path: JsonPath, from: number, to: number) => void
  onPendingChange: (pending: boolean) => void
  onRequestConfirmation: (request: ConfirmationRequest) => void
}

interface AddValueProps {
  objectMode: boolean
  existingKeys?: string[]
  onAdd: (key: string, value: WorkspaceValue) => void
}

function PluginConfigFields({ plugin, config, disabled = false, onChange }: {
  plugin: JsonPlugin
  config: PluginConfig
  disabled?: boolean
  onChange: (config: PluginConfig) => void
}) {
  const ConfigComponent = plugin.ConfigComponent
  return (
    <div className="plugin-config">
      {plugin.configSchema?.map((field) => (
        <label key={field.key}>
          <span>{field.label}</span>
          {field.type === 'select' ? (
            <select disabled={disabled} value={String(config[field.key] ?? '')} onChange={(event) => onChange({ ...config, [field.key]: event.target.value })}>
              {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          ) : (
            <input
              disabled={disabled}
              type={field.type}
              min={field.min}
              max={field.max}
              step={field.step}
              placeholder={field.placeholder}
              value={String(config[field.key] ?? '')}
              onChange={(event) => {
                const value = field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value
                onChange({ ...config, [field.key]: value })
              }}
            />
          )}
        </label>
      ))}
      {ConfigComponent && <ConfigComponent config={config} disabled={disabled} onChange={onChange} />}
    </div>
  )
}

function AddValue({ objectMode, existingKeys = [], onAdd }: AddValueProps) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [type, setType] = useState<CreationType>('string')
  const [pluginId, setPluginId] = useState('')
  const [pluginConfig, setPluginConfig] = useState<PluginConfig>({})
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const plugins = getRegisteredPlugins()
  const selectedPlugin = getRegisteredPlugin(pluginId)

  const close = () => {
    setOpen(false)
    setKey('')
    setType('string')
    setPluginId('')
    setPluginConfig({})
    setError('')
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const property = key
    if (objectMode && !property.trim()) return setError('Enter a property name.')
    if (objectMode && existingKeys.includes(property)) return setError(`“${property}” already exists in this object.`)
    if (type === 'plugin' && !selectedPlugin) return setError('Select a plugin.')
    try {
      if (type !== 'plugin') {
        onAdd(property, defaultForType(type))
        close()
        return
      }
      setAdding(true)
      const node = createPluginNode(pluginId, pluginConfig)
      onAdd(property, resolvePluginNode(node, await executePluginNode(node)))
      close()
    } catch (insertionError) {
      setError(insertionError instanceof Error ? insertionError.message : 'Could not add this field.')
    } finally {
      setAdding(false)
    }
  }

  if (!open) {
    return <button className="add-button" type="button" onClick={() => setOpen(true)}><Plus size={15} aria-hidden="true" /> {objectMode ? 'Add field' : 'Add item'}</button>
  }

  return (
    <form className="add-form" onSubmit={submit}>
      {objectMode && (
        <label>
          <span>Property name</span>
          <input autoFocus value={key} onChange={(event) => { setKey(event.target.value); setError('') }} aria-invalid={Boolean(error)} />
        </label>
      )}
      <label>
        <span>Initial type</span>
        <select value={type} onChange={(event) => { setType(event.target.value as CreationType); setError('') }}>
          {[...types, 'plugin'].map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      <div className="add-form-actions">
        <button className="button button-primary button-small" type="submit" disabled={adding}>{adding ? 'Adding…' : 'Add'}</button>
        <button className="button button-ghost button-small" type="button" onClick={close} disabled={adding}>Cancel</button>
      </div>
      {type === 'plugin' && (
        <div className="plugin-fields">
          <label>
            <span>Select Plugin</span>
            <select value={pluginId} disabled={adding} onChange={(event) => {
              const nextPlugin = getRegisteredPlugin(event.target.value)
              setPluginId(event.target.value)
              setPluginConfig(nextPlugin ? getDefaultPluginConfig(nextPlugin) : {})
              setError('')
            }}>
              <option value="">Choose a plugin</option>
              {plugins.map((plugin) => <option key={plugin.id} value={plugin.id}>{plugin.name}</option>)}
            </select>
          </label>
          {selectedPlugin && (
            <>
              <p className="plugin-description">{selectedPlugin.description}</p>
              {(selectedPlugin.configSchema?.length || selectedPlugin.ConfigComponent)
                ? <PluginConfigFields plugin={selectedPlugin} config={pluginConfig} disabled={adding} onChange={(config) => { setPluginConfig(config); setError('') }} />
                : <p className="plugin-ready-note"><Plug size={14} aria-hidden="true" /> No configuration required. It will be added to the JSON immediately.</p>}
            </>
          )}
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  )
}

function PluginNodeEditor({ label, node, path, root, onChange, onRemove, onRequestConfirmation }: {
  label: string
  node: PluginNode
  path: JsonPath
  root: boolean
  onChange: JsonNodeProps['onChange']
  onRemove: JsonNodeProps['onRemove']
  onRequestConfirmation: JsonNodeProps['onRequestConfirmation']
}) {
  const plugin = getRegisteredPlugin(node.pluginId)
  const plugins = getRegisteredPlugins()
  const [expanded, setExpanded] = useState(true)
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState('')

  const changePlugin = async (nextPlugin: JsonPlugin) => {
    const nextNode = updatePluginNode(node, nextPlugin.id, getDefaultPluginConfig(nextPlugin))
    setSwitching(true)
    setSwitchError('')
    try {
      onChange(path, resolvePluginNode(nextNode, await executePluginNode(nextNode)))
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : 'Plugin execution failed.')
    } finally {
      setSwitching(false)
    }
  }

  const status = !plugin ? 'error' : switching ? 'running' : node.resolvedValue === undefined ? 'idle' : 'success'

  const remove = () => onRequestConfirmation({
    title: `Remove ${label}?`,
    message: `This will remove the configured ${plugin?.name ?? node.pluginId} node from the current document.`,
    confirmLabel: 'Remove',
    onConfirm: () => onRemove(path),
  })

  return (
    <section className={`plugin-node ${root ? 'json-root' : ''}`} aria-label={`${label} plugin`}>
      <header className="plugin-node-header">
        <button className="collapse-button" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}>
          <ChevronDown className={expanded ? '' : 'collapsed'} size={18} aria-hidden="true" />
        </button>
        <div className="node-heading">
          <strong title={label}>{label}</strong>
          <span className="type-pill type-plugin">plugin</span>
          <span className={`plugin-status status-${status}`} aria-live="polite">
            {!plugin ? 'Unavailable' : switching ? 'Updating' : node.resolvedValue === undefined ? 'Pending' : 'Included'}
          </span>
        </div>
        <select
          className="type-select"
          aria-label={`Change ${label} type`}
          value="plugin"
          onChange={(event) => {
            const next = event.target.value
            if (next !== 'plugin') onChange(path, defaultForType(next as JsonType))
          }}
        >
          <option value="plugin">plugin</option>
          {types.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        {!root && <button className="icon-button danger" type="button" onClick={remove} aria-label={`Remove ${label}`}><Trash2 size={16} aria-hidden="true" /></button>}
      </header>
      {expanded && (
        <div className="plugin-node-body">
          <div className="plugin-identity">
            <span className="plugin-icon"><Plug size={19} aria-hidden="true" /></span>
            <div>
              <strong>{plugin?.name ?? 'Unavailable plugin'}</strong>
              <p>{plugin?.description ?? `The registered plugin “${node.pluginId}” is unavailable. Select another plugin or remove this node.`}</p>
            </div>
          </div>
          <label className="plugin-selector">
            <span>Selected plugin</span>
            <select
              value={plugin ? node.pluginId : ''}
              disabled={switching}
              onChange={(event) => {
                const nextPlugin = getRegisteredPlugin(event.target.value)
                if (nextPlugin) void changePlugin(nextPlugin)
              }}
            >
              {!plugin && <option value="">Unavailable: {node.pluginId}</option>}
              {plugins.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          {plugin && (plugin.configSchema?.length || plugin.ConfigComponent) && (
            <PluginConfigFields
              plugin={plugin}
              config={node.config}
              disabled={switching}
              onChange={(config) => onChange(path, updatePluginNode(node, node.pluginId, config))}
            />
          )}
          {switchError && <p className="plugin-run-error" role="alert">{switchError}</p>}
          {node.resolvedValue !== undefined && (
            <div className="plugin-result">
              <strong>JSON value preview</strong>
              <pre aria-label={`${plugin?.name ?? node.pluginId} JSON preview`}><code>{JSON.stringify(node.resolvedValue, null, 2)}</code></pre>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function NumberInput({ label, value, onChange, onPendingChange }: { label: string; value: number; onChange: (value: number) => void; onPendingChange: (pending: boolean) => void }) {
  const [text, setText] = useState(String(value))
  const pending = useRef(false)
  const timeout = useRef<number | null>(null)
  useEffect(() => { if (!pending.current) setText(String(value)) }, [value])
  useEffect(() => () => {
    if (timeout.current !== null) window.clearTimeout(timeout.current)
  }, [])

  const clearPendingTimeout = () => {
    if (timeout.current === null) return
    window.clearTimeout(timeout.current)
    timeout.current = null
  }

  return (
    <input
      aria-label={`${label} value`}
      type="number"
      step="any"
      value={text}
      onChange={(event) => {
        setText(event.target.value)
        const next = Number(event.target.value)
        pending.current = true
        onPendingChange(true)
        clearPendingTimeout()
        if (event.target.value !== '' && Number.isFinite(next)) {
          timeout.current = window.setTimeout(() => {
            timeout.current = null
            pending.current = false
            startTransition(() => onChange(next))
            onPendingChange(false)
          }, 250)
        }
      }}
      onBlur={() => {
        const next = Number(text)
        clearPendingTimeout()
        pending.current = false
        if (text === '' || !Number.isFinite(next)) setText(String(value))
        else if (next !== value) onChange(next)
        onPendingChange(false)
      }}
    />
  )
}

function samePath(left: JsonPath, right: JsonPath): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index])
}

function sameProps(left: JsonNodeProps, right: JsonNodeProps): boolean {
  return left.label === right.label
    && left.value === right.value
    && left.query === right.query
    && left.root === right.root
    && samePath(left.path, right.path)
    && left.onChange === right.onChange
    && left.onRemove === right.onRemove
    && left.onAddObject === right.onAddObject
    && left.onAddArray === right.onAddArray
    && left.onMove === right.onMove
    && left.onPendingChange === right.onPendingChange
    && left.onRequestConfirmation === right.onRequestConfirmation
}

function JsonValueNode(props: JsonNodeProps) {
  const { label, value, path, query, root = false, onChange, onRemove, onAddObject, onAddArray, onMove, onPendingChange, onRequestConfirmation } = props
  const type = typeOfJson(value as JsonValue)
  const [expanded, setExpanded] = useState(true)
  const structured = type === 'object' || type === 'array'
  const entries: Array<readonly [string | number, WorkspaceValue]> = type === 'object'
    ? Object.entries(value as WorkspaceObject)
    : type === 'array'
      ? (value as WorkspaceValue[]).map((item, index) => [index, item] as const)
      : []
  const visibleEntries = entries.filter(([key, item]) => matchesSearch(String(key), item, query))

  useEffect(() => { if (query) setExpanded(true) }, [query])

  const remove = () => {
    if (isNonEmptyContainer(value)) {
      onRequestConfirmation({
        title: `Remove ${label}?`,
        message: `This will permanently remove ${label} and everything inside it from the current document.`,
        confirmLabel: 'Remove',
        onConfirm: () => onRemove(path),
      })
      return
    }
    onRemove(path)
  }

  if (structured) {
    return (
      <section className={`json-node json-${type} ${root ? 'json-root' : ''}`} aria-label={`${label} ${type}`}>
        <header className="node-header">
          <button className="collapse-button" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}>
            <ChevronDown className={expanded ? '' : 'collapsed'} size={18} aria-hidden="true" />
          </button>
          <div className="node-heading">
            <strong title={label}>{label}</strong>
            <span className={`type-pill type-${type}`}>{type}</span>
            <span className="item-count">{entries.length} {type === 'array' ? (entries.length === 1 ? 'item' : 'items') : (entries.length === 1 ? 'field' : 'fields')}</span>
          </div>
          <select className="type-select" aria-label={`Change ${label} type`} value={type} onChange={(event) => onChange(path, defaultForType(event.target.value as JsonType))}>
            {types.map((item) => <option key={item}>{item}</option>)}
          </select>
          {!root && <button className="icon-button danger" type="button" onClick={remove} aria-label={`Remove ${label}`}><Trash2 size={16} aria-hidden="true" /></button>}
        </header>
        {expanded && (
          <div className="node-body">
            {visibleEntries.length ? visibleEntries.map(([key, item], index) => (
              <div className="child-wrap" key={String(key)}>
                {type === 'array' && (
                  <div className="reorder-controls" aria-label={`Reorder item ${index + 1}`}>
                    <button type="button" disabled={Number(key) === 0} onClick={() => onMove(path, Number(key), Number(key) - 1)} aria-label={`Move item ${Number(key) + 1} up`}><ChevronUp size={14} /></button>
                    <button type="button" disabled={Number(key) === entries.length - 1} onClick={() => onMove(path, Number(key), Number(key) + 1)} aria-label={`Move item ${Number(key) + 1} down`}><ChevronDown size={14} /></button>
                  </div>
                )}
                <JsonNode {...props} root={false} label={type === 'array' ? `Item ${Number(key) + 1}` : String(key)} value={item} path={[...path, key]} />
              </div>
            )) : <div className="empty-state">{query ? 'No matching fields in this section.' : `This ${type} is empty.`}</div>}
            {!query && (type === 'object'
              ? <AddValue objectMode existingKeys={Object.keys(value as WorkspaceObject)} onAdd={(key, item) => onAddObject(path, key, item)} />
              : <AddValue objectMode={false} onAdd={(_key, item) => onAddArray(path, item)} />)}
          </div>
        )}
      </section>
    )
  }

  return (
    <div className={`primitive-row ${root ? 'json-root primitive-root' : ''}`}>
      <div className="primitive-label">
        <strong title={label}>{label}</strong>
        <span className={`type-pill type-${type}`}>{type}</span>
      </div>
      <div className="primitive-control">
        {type === 'string' && <DraftTextInput aria-label={`${label} value`} value={value as string} onValueChange={(next) => onChange(path, next)} onPendingChange={onPendingChange} />}
        {type === 'number' && <NumberInput label={label} value={value as number} onChange={(next) => onChange(path, next)} onPendingChange={onPendingChange} />}
        {type === 'boolean' && (
          <label className="switch">
            <input aria-label={`${label} value`} type="checkbox" checked={value as boolean} onChange={(event) => onChange(path, event.target.checked)} />
            <span className="switch-track"><span /></span><em>{value ? 'True' : 'False'}</em>
          </label>
        )}
        {type === 'null' && <span className="null-value">null</span>}
      </div>
      <select className="type-select" aria-label={`Change ${label} type`} value={type} onChange={(event) => onChange(path, defaultForType(event.target.value as JsonType))}>
        {types.map((item) => <option key={item}>{item}</option>)}
      </select>
      {!root && <button className="icon-button danger" type="button" onClick={remove} aria-label={`Remove ${label}`}><Trash2 size={16} aria-hidden="true" /></button>}
    </div>
  )
}

function JsonNodeComponent(props: JsonNodeProps) {
  if (isPluginNode(props.value)) {
    return (
      <PluginNodeEditor
        label={props.label}
        node={props.value}
        path={props.path}
        root={props.root ?? false}
        onChange={props.onChange}
        onRemove={props.onRemove}
        onRequestConfirmation={props.onRequestConfirmation}
      />
    )
  }
  return <JsonValueNode {...props} />
}

export const JsonNode = memo(JsonNodeComponent, sameProps)
