import { Link, useLocation } from 'react-router-dom'
import { Home, SlidersHorizontal, RotateCcw, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'
import { countSessionOverrides, clearAllOverrides } from '@/lib/sessionState'
import { useAgentChat } from '@/lib/AgentChatContext'

function DatabricksLogo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 712.8 113" className={className} xmlns="http://www.w3.org/2000/svg">
      <path fill="#F2F2F2" d="M202.2,96.2V6.4h-13.8V40c0,0.5-0.3,0.9-0.8,1.1c-0.5,0.2-1,0-1.3-0.3c-4.7-5.5-12-8.6-20-8.6c-17.1,0-30.5,14.4-30.5,32.8c0,9,3.1,17.3,8.8,23.4c5.7,6.1,13.4,9.4,21.7,9.4c7.9,0,15.2-3.3,20-9c0.3-0.4,0.9-0.5,1.3-0.4c0.5,0.2,0.8,0.6,0.8,1.1v6.7H202.2z M169.3,85.3c-11,0-19.6-8.9-19.6-20.3s8.6-20.3,19.6-20.3c11,0,19.6,8.9,19.6,20.3S180.3,85.3,169.3,85.3z"/>
      <path fill="#F2F2F2" d="M276,96.2V33.7h-13.7V40c0,0.5-0.3,0.9-0.8,1.1c-0.5,0.2-1,0-1.3-0.4c-4.6-5.5-11.8-8.6-20-8.6c-17.1,0-30.5,14.4-30.5,32.8s13.4,32.8,30.5,32.8c7.9,0,15.2-3.3,20-9.1c0.3-0.4,0.9-0.5,1.3-0.4c0.5,0.2,0.8,0.6,0.8,1.1v6.8H276z M243.3,85.3c-11,0-19.6-8.9-19.6-20.3s8.6-20.3,19.6-20.3c11,0,19.6,8.9,19.6,20.3S254.3,85.3,243.3,85.3z"/>
      <path fill="#F2F2F2" d="M393.3,96.2V33.7h-13.7V40c0,0.5-0.3,0.9-0.8,1.1c-0.5,0.2-1,0-1.3-0.4c-4.6-5.5-11.8-8.6-20-8.6C340.3,32.1,327,46.5,327,65s13.4,32.8,30.5,32.8c7.9,0,15.2-3.3,20-9.1c0.3-0.4,0.9-0.5,1.3-0.4c0.5,0.2,0.8,0.6,0.8,1.1v6.8H393.3z M360.6,85.3c-11,0-19.6-8.9-19.6-20.3s8.6-20.3,19.6-20.3s19.6,8.9,19.6,20.3S371.6,85.3,360.6,85.3z"/>
      <path fill="#F2F2F2" d="M418.4,88.8c0.1,0,0.3-0.1,0.4-0.1c0.3,0,0.7,0.2,0.9,0.4c4.7,5.5,12,8.6,20,8.6c17.1,0,30.5-14.4,30.5-32.8c0-9-3.1-17.3-8.8-23.4c-5.7-6.1-13.4-9.4-21.7-9.4c-7.9,0-15.2,3.3-20,9c-0.3,0.4-0.8,0.5-1.3,0.4c-0.5-0.2-0.8-0.6-0.8-1.1l0-34h-13.8l0,89.8h13.8v-6.3C417.6,89.4,417.9,89,418.4,88.8z M417,65c0-11.4,8.6-20.3,19.6-20.3s19.6,8.9,19.6,20.3s-8.6,20.3-19.6,20.3S417,76.3,417,65z"/>
      <path fill="#F2F2F2" d="M510.1,46.5c1.3,0,2.5,0.1,3.3,0.3V32.6c-0.5-0.1-1.4-0.2-2.3-0.2c-7.2,0-13.8,3.7-17.3,9.6c-0.3,0.5-0.8,0.7-1.3,0.5c-0.5-0.1-0.9-0.6-0.9-1.1v-7.7h-13.7v62.6h13.8V68.7C491.7,55,498.7,46.5,510.1,46.5z"/>
      <rect x="522.1" y="33.7" fill="#F2F2F2" width="14" height="62.6"/>
      <path fill="#F2F2F2" d="M528.9,6.5c-4.7,0-8.5,3.8-8.5,8.5c0,4.7,3.8,8.5,8.5,8.5s8.5-3.8,8.5-8.5C537.4,10.3,533.6,6.5,528.9,6.5z"/>
      <path fill="#F2F2F2" d="M577.1,32.1C557.9,32.1,544,45.9,544,65c0,9.3,3.3,17.6,9.2,23.6c6,6,14.4,9.3,23.8,9.3c7.8,0,13.8-1.5,25.2-9.9l-7.9-8.3c-5.6,3.7-10.8,5.5-15.9,5.5c-11.6,0-20.3-8.7-20.3-20.2s8.7-20.2,20.3-20.2c5.5,0,10.6,1.8,15.7,5.5l8.8-8.3C592.6,33.2,583.3,32.1,577.1,32.1z"/>
      <path fill="#F2F2F2" d="M626.5,68.7c0.2-0.2,0.5-0.3,0.8-0.3l0.1,0c0.3,0,0.6,0.2,0.9,0.4l22.1,27.4l17,0l-28.6-34.6c-0.4-0.5-0.4-1.2,0.1-1.6l26.3-26.3h-16.9l-22.7,22.8c-0.3,0.3-0.8,0.4-1.3,0.3c-0.4-0.2-0.7-0.6-0.7-1.1l0-49.2h-13.9l0,89.8h13.8V71.9c0-0.3,0.1-0.7,0.4-0.9L626.5,68.7z"/>
      <path fill="#F2F2F2" d="M689.9,97.8c11.3,0,22.8-6.9,22.8-20c0-8.6-5.4-14.5-16.4-18.1l-7.5-2.5c-5.1-1.7-7.5-4.1-7.5-7.4c0-3.8,3.4-6.4,8.2-6.4c4.6,0,8.7,3,11.3,8.2l11.1-6c-4.1-8.4-12.6-13.6-22.4-13.6c-12.4,0-21.4,8-21.4,18.9c0,8.7,5.2,14.5,15.9,17.9l7.7,2.5c5.4,1.7,7.7,3.9,7.7,7.4c0,5.3-4.9,7.2-9.1,7.2c-5.6,0-10.6-3.6-13-9.5L666,82.4C669.7,91.9,678.8,97.8,689.9,97.8z"/>
      <path fill="#F2F2F2" d="M314.4,97.2c4.4,0,8.3-0.4,10.5-0.7l0-12c-1.8,0.2-5,0.4-6.9,0.4c-5.6,0-9.9-1-9.9-13.1V46.1c0-0.7,0.5-1.2,1.2-1.2h13.5l0-11.3l-13.5,0c-0.7,0-1.2-0.5-1.2-1.2V14.4l-13.8,0l0,18.1c0,0.7-0.5,1.2-1.2,1.2h-9.6l0,11.3l9.6,0c0.7,0,1.2,0.5,1.2,1.2v29.1C294.3,97.2,308.9,97.2,314.4,97.2z"/>
      <polygon fill="#EE3D2C" points="98.9,46.6 52.3,72.9 2.4,44.8 0,46.1 0,66.5 52.3,95.9 98.9,69.7 98.9,80.5 52.3,106.8 2.4,78.7 0,80 0,83.5 52.3,112.9 104.5,83.5 104.5,63.1 102.1,61.8 52.3,89.8 5.6,63.6 5.6,52.8 52.3,79 104.5,49.6 104.5,29.5 101.9,28 52.3,55.9 8,31.1 52.3,6.2 88.7,26.7 91.9,24.9 91.9,22.4 52.3,0.1 0,29.5 0,32.7 52.3,62.1 98.9,35.8"/>
    </svg>
  )
}

const navItems = [
  { path: '/', label: 'Home', icon: Home },
  { path: '/simulator', label: 'Simulator', icon: SlidersHorizontal },
]

export function Navigation() {
  const location = useLocation()
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [overrideCount, setOverrideCount] = useState(0)
  const { clearChat } = useAgentChat()

  useEffect(() => {
    setOverrideCount(countSessionOverrides())
    const interval = setInterval(() => setOverrideCount(countSessionOverrides()), 2000);
    return () => clearInterval(interval);
  }, [])

  const handleSessionReset = () => {
    clearAllOverrides()
    clearChat()
    setOverrideCount(0)
    setShowResetConfirm(true)
    setTimeout(() => {
      setShowResetConfirm(false)
      window.location.reload()
    }, 1000)
  }

  return (
    <>
      {showResetConfirm && (
        <div className="fixed top-4 right-4 z-[100] bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-fade-in">
          <CheckCircle className="w-5 h-5" />
          <span className="font-medium">Session state reset</span>
        </div>
      )}

      <nav className="sticky top-0 z-50 border-b" style={{ backgroundColor: '#1B3139' }}>
        <div className="relative flex items-center h-14 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex-shrink-0">
            <DatabricksLogo className="h-7 w-auto" />
          </Link>

          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="hidden md:flex items-center space-x-1 pointer-events-auto">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = location.pathname === item.path

                return (
                  <Link key={item.path} to={item.path} className="relative">
                    <div
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-white/10 text-white'
                          : 'text-white/70 hover:text-white hover:bg-white/5'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </div>
                    {isActive && (
                      <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-white rounded-full" />
                    )}
                  </Link>
                )
              })}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div id="nav-slot" className="flex items-center gap-3" />

            <button
              onClick={handleSessionReset}
              className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer group"
              title={overrideCount > 0 ? `${overrideCount} cached update${overrideCount === 1 ? '' : 's'} — click to reset` : "Click to reset session state"}
            >
              <div className={cn("w-2 h-2 rounded-full animate-pulse", overrideCount > 0 ? "bg-amber-400 group-hover:bg-amber-300" : "bg-green-400 group-hover:bg-green-300")} />
              <span className="text-white/80 group-hover:text-white">Live</span>
              {overrideCount > 0 && (
                <span className="text-[10px] text-white/40 font-medium tabular-nums">{overrideCount}</span>
              )}
              <RotateCcw className="h-3 w-3 text-white/50 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>

            <div className="md:hidden">
              <button className="p-2 rounded-md text-white/70 hover:text-white hover:bg-white/10">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </nav>
    </>
  )
}
