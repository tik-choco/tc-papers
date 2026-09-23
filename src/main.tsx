import { render } from 'preact'
import { App } from './app'
import './index.css'
import { startPapersBackupPublisher } from './lib/papersBackupPublisher'

render(<App />, document.getElementById('app')!)

// Mirror every review change into tc-storage's drive (encrypted, debounced).
startPapersBackupPublisher()
