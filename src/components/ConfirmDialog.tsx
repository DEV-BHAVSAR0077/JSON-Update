import { useId } from 'react'
import { AlertTriangle, X } from 'lucide-react'

export interface ConfirmationRequest {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
}

interface ConfirmDialogProps extends Omit<ConfirmationRequest, 'onConfirm'> {
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({ title, message, confirmLabel, onCancel, onConfirm }: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()

  return (
    <div
      className="confirm-overlay"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}
      onKeyDown={(event) => { if (event.key === 'Escape') onCancel() }}
    >
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <button className="confirm-close" type="button" onClick={onCancel} aria-label="Close confirmation"><X size={17} aria-hidden="true" /></button>
        <div className="confirm-icon"><AlertTriangle size={21} aria-hidden="true" /></div>
        <div className="confirm-content">
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{message}</p>
        </div>
        <div className="confirm-actions">
          <button className="button button-secondary" type="button" onClick={onCancel} autoFocus>Cancel</button>
          <button className="button button-danger" type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  )
}
