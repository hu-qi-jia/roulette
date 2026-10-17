import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n'
import './styles.css'
import Overlay from './Overlay'
import Panel from './Panel'
import Shot from './Shot'

const params = new URLSearchParams(window.location.search)
const windowParam = params.get('window')
const route = windowParam === 'overlay' ? 'overlay' : windowParam === 'shot' ? 'shot' : 'panel'
document.body.dataset.route = route

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {route === 'overlay' ? <Overlay /> : route === 'shot' ? <Shot /> : <Panel />}
  </React.StrictMode>
)
