const pressed = new WeakSet<EventTarget>()

/**
 * Backdrop handlers that close a modal only when the whole click (press and release) lands on the backdrop.
 * A plain `onClick` target check misfires when a drag starts inside the dialog (e.g. selecting text in an input)
 * and ends outside it: the browser then dispatches `click` on the common ancestor, i.e. the backdrop.
 * The press is tracked per element so it survives re-renders between mousedown and click.
 */
export function backdropClose(onClose: () => void) {
  return {
    onMouseDown: (e: MouseEvent) => {
      if (e.target === e.currentTarget) pressed.add(e.currentTarget!)
      else pressed.delete(e.currentTarget!)
    },
    onClick: (e: MouseEvent) => {
      const ok = e.target === e.currentTarget && pressed.has(e.currentTarget!)
      pressed.delete(e.currentTarget!)
      if (ok) onClose()
    },
  }
}
