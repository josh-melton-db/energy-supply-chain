import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Navigation } from './components/layout/Navigation'
import { ScenarioProvider } from './lib/ScenarioContext'
import { AgentChatProvider } from './lib/AgentChatContext'
import AgentChat from './components/AgentChat'
import IncidentResponseView from './pages/IncidentResponseView'
import ConfigurationPage from './pages/ConfigurationPage'
import './app.css'

function App() {
  return (
    <ScenarioProvider>
      <AgentChatProvider>
        <Router>
          <div className="min-h-screen bg-background">
            <Navigation />
            <AgentChat />
            <Routes>
              <Route path="/" element={<IncidentResponseView />} />
              <Route path="/simulator" element={<ConfigurationPage />} />
            </Routes>
          </div>
        </Router>
      </AgentChatProvider>
    </ScenarioProvider>
  )
}

export default App
