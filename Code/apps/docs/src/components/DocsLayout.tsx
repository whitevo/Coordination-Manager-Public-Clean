import { useState, useCallback, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { AiSearchPanel } from './AiSearchPanel'

export function DocsLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [aiPanelOpen, setAiPanelOpen] = useState(false)

  const handleAiSearchClick = useCallback(() => {
    if (aiPanelOpen) {
      // Already open — pulse to indicate
      window.dispatchEvent(new CustomEvent('ai-search-focus'))
    } else {
      setAiPanelOpen(true)
    }
  }, [aiPanelOpen])

  const handleOpenAiSearch = useCallback(() => {
    setAiPanelOpen(true)
    window.dispatchEvent(new CustomEvent('ai-search-focus'))
  }, [])

  useEffect(() => {
    const openHandler = () => handleOpenAiSearch()
    window.addEventListener('docs-open-ai-search', openHandler)
    return () => window.removeEventListener('docs-open-ai-search', openHandler)
  }, [handleOpenAiSearch])

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar
        onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
        aiPanelOpen={aiPanelOpen}
        onAiSearchClick={handleAiSearchClick}
      />

      <div className="flex flex-1">
        {/* Sidebar — always visible on lg+, overlay on mobile */}
        <aside
          className={`
            fixed inset-y-0 left-0 z-40 w-72 pt-16 bg-surface-900 border-r border-surface-700
            transform transition-transform duration-200 ease-in-out
            lg:translate-x-0 lg:static lg:z-auto lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
        >
          <Sidebar
            onNavigate={() => setSidebarOpen(false)}
            onAiSearchClick={handleAiSearchClick}
            aiPanelOpen={aiPanelOpen}
          />
        </aside>

        {/* Overlay backdrop for mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main content */}
        <main className={`flex-1 min-w-0 transition-[margin] duration-300 ${aiPanelOpen ? 'lg:mr-96' : ''}`}>
          <div className="max-w-4xl mx-auto px-6 py-10">
            <Outlet />
          </div>
        </main>
      </div>

      {/* AI Search right panel */}
      <AiSearchPanel isOpen={aiPanelOpen} onClose={() => setAiPanelOpen(false)} />
    </div>
  )
}
