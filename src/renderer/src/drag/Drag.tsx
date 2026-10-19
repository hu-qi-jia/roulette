import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** The preview that follows the cursor while an answer is dragged. The window
 *  is click-through and never focusable; only the text is rendered here. */
export default function Drag(): React.JSX.Element {
  const { t } = useTranslation()
  const [text, setText] = useState('')

  useEffect(() => {
    const off = window.roulette.onDragText(setText)
    // The first payload can arrive before this window's React tree mounts;
    // ask the host for the current text to cover that race.
    void window.roulette
      .getDragText()
      .then((current) => setText((previous) => previous || current))
      .catch(() => {})
    return off
  }, [])

  return (
    <div className="drag-ghost">
      <p className="drag-ghost-text">{text}</p>
      <span className="drag-ghost-hint">{t('dragReleaseToPaste')}</span>
    </div>
  )
}
