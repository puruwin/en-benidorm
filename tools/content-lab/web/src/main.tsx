import React from 'react'
import {createRoot} from 'react-dom/client'
import {App} from './App'
import {SessionBoundary} from './SessionBoundary'
import './styles.css'

createRoot(document.getElementById('root')!).render(<React.StrictMode><SessionBoundary><App /></SessionBoundary></React.StrictMode>)

