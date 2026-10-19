import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n'
import './styles/index.css'

const params = new URLSearchParams(window.location.search)
const windowParam = params.get('window')
const route =
  windowParam === 'overlay'
    ? 'overlay'
    : windowParam === 'shot'
      ? 'shot'
      : windowParam === 'drag'
        ? 'drag'
        : windowParam === 'bubble'
          ? 'bubble'
          : 'panel'
document.body.dataset.route = route

// Split by window so the overlay and shot windows do not parse the panel's
// conversation, history, settings, and knowledge-base UI at startup.
const loadRoute =
  route === 'overlay'
    ? import('./overlay/Overlay')
    : route === 'shot'
      ? import('./shot/Shot')
      : route === 'drag'
        ? import('./drag/Drag')
        : route === 'bubble'
          ? import('./bubble/Bubble')
          : import('./panel/Panel')

const root = ReactDOM.createRoot(document.getElementById('root')!)

void loadRoute
  .then((module) => {
    const Route = module.default
    root.render(
      <React.StrictMode>
        <Route />
      </React.StrictMode>
    )
  })
  .catch((error) => {
    console.error('[renderer] failed to load window UI', error)
  })
