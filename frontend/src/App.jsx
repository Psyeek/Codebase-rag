import React, { useState, useRef, useEffect } from 'react'
import {
  Send,
  Terminal,
  ExternalLink,
  GitBranch,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  FileCode,
  Shield,
  Activity,
  Layers,
  Crosshair,
  Compass,
  Cpu,
  Palette,
  Sun
} from 'lucide-react'

const SAMPLE_REPOS = [
  { name: "pallets/flask", url: "https://github.com/pallets/flask", desc: "Python WSGI microframework" },
  { name: "tiangolo/fastapi", url: "https://github.com/tiangolo/fastapi", desc: "High-perf async Python API" },
  { name: "expressjs/express", url: "https://github.com/expressjs/express", desc: "Minimalist Node.js web framework" },
  { name: "github/copilot-sdk", url: "https://github.com/github/copilot-sdk", desc: "GitHub Copilot Extensions SDK" }
]

const THEMES = [
  {
    id: 'lattice',
    label: 'LATTICE',
    icon: Crosshair,
    desc: 'Defense Stark Black',
    hero: '/anduril_hero.jpg',
    tag: 'SYS // LATTICE DEFENSE'
  },
  {
    id: 'github',
    label: 'GITHUB',
    icon: GitBranch,
    desc: 'Universe Obsidian',
    hero: '/hero_banner.jpg',
    tag: 'GITHUB // CODE GRAPH'
  },
  {
    id: 'amber',
    label: 'AMBER',
    icon: Terminal,
    desc: 'Tactical CRT Amber',
    hero: '/anduril_hero.jpg',
    tag: 'TACTICAL // CRT RADAR'
  },
  {
    id: 'light',
    label: 'PAPER',
    icon: Sun,
    desc: 'High-Contrast Light',
    hero: '/anduril_hero.jpg',
    tag: 'TECHNICAL // SPEC SHEET'
  }
]

const TACTICAL_PROMPTS = [
  {
    index: "01",
    tag: "SYSTEM ARCHITECTURE",
    queries: [
      "How is this application structured and what are the core entry points?",
      "Trace the request lifecycle and how data flows through the system."
    ]
  },
  {
    index: "02",
    tag: "ENVIRONMENT & SETUP",
    queries: [
      "What are the essential dependencies and configuration parameters?",
      "Provide a minimal working implementation example from this codebase."
    ]
  },
  {
    index: "03",
    tag: "INTERNALS & FAULT TOLERANCE",
    queries: [
      "How are errors, exceptions, and recovery mechanisms handled?",
      "Where is runtime execution context, session, or state managed?"
    ]
  }
]

// Dynamic API Base URL: configured via VITE_API_BASE_URL (for Vercel/Render/Fly.io)
// Falls back to http://localhost:5000 in dev, or relative path in production Docker Compose
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:5000' : '')).replace(/\/$/, '')

export default function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [expandedSnippets, setExpandedSnippets] = useState({})
  const [copiedId, setCopiedId] = useState(null)

  // Theme Management
  const [currentTheme, setCurrentTheme] = useState(() => {
    return localStorage.getItem('codebase_rag_theme') || 'lattice'
  })
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false)
  const themeDropdownRef = useRef(null)

  // Active repository state
  const [repoInfo, setRepoInfo] = useState({
    repo_name: 'pallets/flask',
    repo_url: 'https://github.com/pallets/flask',
    total_chunks: 650,
    total_files: 98
  })
  const [repoUrlInput, setRepoUrlInput] = useState('')
  const [isIngesting, setIsIngesting] = useState(false)
  const [ingestStatus, setIngestStatus] = useState('')
  const [ingestProgressPct, setIngestProgressPct] = useState(0)
  const [ingestError, setIngestError] = useState(null)
  const [ingestSuccess, setIngestSuccess] = useState(null)

  const chatEndRef = useRef(null)
  const textareaRef = useRef(null)

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Update theme on document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme)
    localStorage.setItem('codebase_rag_theme', currentTheme)
  }, [currentTheme])

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (themeDropdownRef.current && !themeDropdownRef.current.contains(event.target)) {
        setThemeDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // Update document title
  useEffect(() => {
    if (repoInfo?.repo_name) {
      document.title = `${repoInfo.repo_name.toUpperCase()} // CODEBASE RAG`
    }
  }, [repoInfo])

  // Fetch initial repo info
  useEffect(() => {
    fetch(`${API_BASE_URL}/repo-info`)
      .then(res => res.json())
      .then(data => {
        if (data && data.repo_name) {
          setRepoInfo(data)
        }
      })
      .catch(err => console.log('Could not fetch repo info:', err))
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, loading])

  const toggleSnippetExpansion = (messageId) => {
    setExpandedSnippets(prev => ({
      ...prev,
      [messageId]: !prev[messageId]
    }))
  }

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Polling helper for background ingestion
  const pollIngestProgress = (targetUrl) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/ingest/progress`)
        const data = await res.json()

        if (data.is_ingesting) {
          setIngestStatus(data.message || 'INGESTING REPOSITORY...')
          setIngestProgressPct(data.percent || 15)
        } else if (data.stage === 'completed' && data.stats) {
          clearInterval(interval)
          setIsIngesting(false)
          setIngestProgressPct(100)
          setIngestStatus('')
          setRepoInfo({
            repo_name: data.stats.repo_name,
            repo_url: data.stats.repo_url,
            total_chunks: data.stats.total_chunks,
            total_files: data.stats.total_files
          })
          setIngestSuccess(`INDEX INITIALIZED: ${data.stats.repo_name.toUpperCase()} (${data.stats.total_chunks} CHUNKS / ${data.stats.total_files} FILES)`)
          setMessages([
            {
              id: Date.now(),
              role: 'assistant',
              content: `### REPOSITORY INDEXATION COMPLETE\n\n**Target**: \`${data.stats.repo_name}\`\n**Indexed Vectors**: \`${data.stats.total_chunks}\` chunks\n**Source Files**: \`${data.stats.total_files}\` files\n\npgvector space synchronized. Ready for autonomous semantic inspection.`,
              sources: [],
              chunks: []
            }
          ])
          setTimeout(() => {
            setIngestSuccess(null)
            setIngestProgressPct(0)
          }, 8000)
        } else if (data.stage === 'error') {
          clearInterval(interval)
          setIsIngesting(false)
          setIngestProgressPct(0)
          setIngestStatus('')
          setIngestError(data.error || 'INGESTION SEQUENCE FAILED.')
        }
      } catch (err) {
        console.error('Polling error:', err)
      }
    }, 1000)
  }

  const handleIngest = async (overrideUrl) => {
    const targetUrl = (overrideUrl || repoUrlInput).trim()
    if (!targetUrl || isIngesting) return

    setIsIngesting(true)
    setIngestError(null)
    setIngestSuccess(null)
    setIngestProgressPct(5)
    setIngestStatus('INITIALIZING REPOSITORY CLONE & AST SCAN...')

    try {
      const response = await fetch(`${API_BASE_URL}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_url: targetUrl })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || `Failed to initiate ingestion: HTTP ${response.status}`)
      }

      setRepoUrlInput('')
      pollIngestProgress(targetUrl)
    } catch (err) {
      setIsIngesting(false)
      setIngestProgressPct(0)
      setIngestStatus('')
      setIngestError(err.message)
    }
  }

  const handleSend = async (queryText) => {
    const textToSend = queryText || input
    if (!textToSend.trim() || loading || isIngesting) return

    const userMessageId = Date.now()
    const botMessageId = userMessageId + 1

    const userMsg = {
      id: userMessageId,
      role: 'user',
      content: textToSend.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const response = await fetch(`${API_BASE_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: textToSend.trim() })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      const data = await response.json()
      const botMsg = {
        id: botMessageId,
        role: 'assistant',
        content: data.answer || "No response generated.",
        sources: data.sources || [],
        chunks: data.chunks || [],
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      }

      setMessages(prev => [...prev, botMsg])
    } catch (err) {
      const errorMsg = {
        id: botMessageId,
        role: 'assistant',
        content: `### SUBSYSTEM ERROR // QUERY FAILURE\n\n\`\`\`\n${err.message}\n\`\`\`\n\nVerify backend service and database connectivity.`,
        sources: [],
        chunks: []
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const renderFormattedContent = (content, msgId) => {
    const parts = content.split(/(```[\s\S]*?```)/g)
    return parts.map((part, index) => {
      if (part.startsWith('```')) {
        const firstLineBreak = part.indexOf('\n')
        const language = part.slice(3, firstLineBreak).trim() || 'CODE'
        const code = part.slice(firstLineBreak + 1, -3)
        const codeBlockId = `${msgId}-code-${index}`
        const isCopied = copiedId === codeBlockId

        return (
          <div
            key={index}
            className="my-4 font-mono"
            style={{ border: '1px solid var(--border-subtle)', backgroundColor: 'var(--code-bg)' }}
          >
            <div
              className="flex items-center justify-between px-3 py-1.5 text-[11px]"
              style={{ backgroundColor: 'var(--code-header)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
            >
              <span className="tracking-widest uppercase font-semibold" style={{ color: 'var(--text-heading)' }}>
                {language}
              </span>
              <button
                onClick={() => copyToClipboard(code, codeBlockId)}
                className="flex items-center gap-1.5 px-2 py-0.5 transition-colors uppercase text-[10px] tracking-wider"
                style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
              >
                {isCopied ? (
                  <>
                    <Check size={11} className="text-emerald-400" />
                    <span className="text-emerald-400">COPIED</span>
                  </>
                ) : (
                  <>
                    <Copy size={11} />
                    <span>COPY</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-3.5 overflow-x-auto text-[13px] leading-relaxed font-mono" style={{ color: 'var(--text-main)' }}>
              <code>{code}</code>
            </pre>
          </div>
        )
      }

      const lines = part.split('\n').filter(line => line.trim().length > 0)
      return lines.map((line, lIdx) => {
        if (line.startsWith('### ')) {
          return (
            <h4
              key={`${index}-${lIdx}`}
              className="text-xs font-mono font-bold uppercase tracking-widest mt-3 mb-1"
              style={{ color: 'var(--text-heading)' }}
            >
              [ {line.replace('### ', '')} ]
            </h4>
          )
        }
        if (line.startsWith('## ')) {
          return (
            <h3
              key={`${index}-${lIdx}`}
              className="text-sm font-mono font-bold uppercase tracking-wider mt-4 mb-2 pb-1"
              style={{ color: 'var(--text-heading)', borderBottom: '1px solid var(--border-subtle)' }}
            >
              // {line.replace('## ', '')}
            </h3>
          )
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <li key={`${index}-${lIdx}`} className="ml-4 mb-1 list-square leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {renderInlineStyles(line.slice(2))}
            </li>
          )
        }
        return (
          <p key={`${index}-${lIdx}`} className="mb-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {renderInlineStyles(line)}
          </p>
        )
      })
    })
  }

  const renderInlineStyles = (text) => {
    const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    return tokens.map((token, i) => {
      if (token.startsWith('`') && token.endsWith('`')) {
        return (
          <code
            key={i}
            className="px-1.5 py-0.5 mx-0.5 text-xs font-mono"
            style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)' }}
          >
            {token.slice(1, -1)}
          </code>
        )
      }
      if (token.startsWith('**') && token.endsWith('**')) {
        return <strong key={i} className="font-semibold" style={{ color: 'var(--text-heading)' }}>{token.slice(2, -2)}</strong>
      }
      return token
    })
  }

  const activeThemeConfig = THEMES.find(t => t.id === currentTheme) || THEMES[0]

  return (
    <div
      className="min-h-screen relative flex flex-col tactical-grid selection:bg-neutral-800 selection:text-white"
      style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
    >
      {/* Precision corner crosshairs */}
      <div className="fixed top-2 left-2 pointer-events-none text-xs font-mono select-none" style={{ color: 'var(--text-muted)' }}>+</div>
      <div className="fixed top-2 right-2 pointer-events-none text-xs font-mono select-none" style={{ color: 'var(--text-muted)' }}>+</div>
      <div className="fixed bottom-2 left-2 pointer-events-none text-xs font-mono select-none" style={{ color: 'var(--text-muted)' }}>+</div>
      <div className="fixed bottom-2 right-2 pointer-events-none text-xs font-mono select-none" style={{ color: 'var(--text-muted)' }}>+</div>

      <div className="relative z-10 flex flex-col h-screen max-w-7xl w-full mx-auto px-4 md:px-8">
        
        {/* Top Telemetry Header */}
        <header
          className="flex items-center justify-between py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-4">
            <div
              className="w-8 h-8 flex items-center justify-center font-mono font-extrabold text-sm tracking-tighter"
              style={{ backgroundColor: 'var(--accent-btn-bg)', color: 'var(--accent-btn-text)' }}
            >
              AN
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-mono font-bold tracking-[0.2em] uppercase" style={{ color: 'var(--text-heading)' }}>
                  LATTICE // CODEBASE INTELLIGENCE
                </span>
                <span
                  className="text-[10px] font-mono px-1.5 py-0.2 uppercase"
                  style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
                >
                  V2.4
                </span>
              </div>
              <div
                className="flex items-center gap-3 text-[10px] font-mono tracking-wider uppercase mt-0.5"
                style={{ color: 'var(--text-muted)' }}
              >
                <span>SYS.ONLINE</span>
                <span>•</span>
                <span>PGVECTOR: 5433</span>
                <span>•</span>
                <span>GROQ LPU ACCELERATED</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Theme Selector Dropdown */}
            <div className="relative" ref={themeDropdownRef}>
              <button
                type="button"
                onClick={() => setThemeDropdownOpen(!themeDropdownOpen)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono transition-colors uppercase tracking-wider"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)'
                }}
                title="Switch UI Theme"
              >
                <Palette size={12} style={{ color: 'var(--text-heading)' }} />
                <span>THEME: {activeThemeConfig.label}</span>
                <ChevronDown size={11} className={`transition-transform duration-200 ${themeDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {themeDropdownOpen && (
                <div
                  className="absolute right-0 mt-1 w-52 z-50 font-mono shadow-2xl py-1"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    border: '1px solid var(--border-strong)'
                  }}
                >
                  <div
                    className="px-3 py-1.5 text-[9px] uppercase tracking-widest border-b"
                    style={{ color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}
                  >
                    SELECT INTERFACE THEME
                  </div>
                  {THEMES.map((t) => {
                    const Icon = t.icon
                    const isSelected = currentTheme === t.id
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setCurrentTheme(t.id)
                          setThemeDropdownOpen(false)
                        }}
                        className="w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors"
                        style={{
                          backgroundColor: isSelected ? 'var(--bg-card)' : 'transparent',
                          color: isSelected ? 'var(--text-heading)' : 'var(--text-secondary)',
                          borderLeft: isSelected ? '2px solid var(--accent-badge)' : '2px solid transparent'
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <Icon size={12} />
                          <span className="font-semibold">{t.label}</span>
                        </div>
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          {t.desc}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Active Repository Target Indicator */}
            <a
              href={repoInfo.repo_url}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-xs font-mono transition-colors group"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-main)'
              }}
              title="Open repository source"
            >
              <span className="uppercase text-[10px]" style={{ color: 'var(--text-muted)' }}>TARGET:</span>
              <span className="font-semibold group-hover:underline" style={{ color: 'var(--text-heading)' }}>
                {repoInfo.repo_name}
              </span>
              <span
                className="px-1.5 py-0.2 text-[10px]"
                style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
              >
                {repoInfo.total_chunks} CHKS
              </span>
              <ExternalLink size={11} style={{ color: 'var(--text-muted)' }} />
            </a>

            {/* Clear Conversation */}
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono transition-colors uppercase tracking-wider"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-muted)'
                }}
              >
                <RefreshCw size={11} />
                <span>RESET</span>
              </button>
            )}
          </div>
        </header>

        {/* Repository Ingestion Console Bar */}
        <section
          className="py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleIngest()
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <div
              className="relative flex-1 flex items-center transition-colors"
              style={{
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)'
              }}
            >
              <span
                className="pl-3.5 pr-2 font-mono text-xs tracking-wider select-none"
                style={{ color: 'var(--text-muted)' }}
              >
                INPUT // REPO_LOCATOR &gt;
              </span>
              <input
                type="text"
                className="w-full py-2.5 pr-4 bg-transparent text-xs font-mono focus:outline-none"
                style={{ color: 'var(--text-main)' }}
                placeholder="https://github.com/organization/repository"
                value={repoUrlInput}
                onChange={(e) => setRepoUrlInput(e.target.value)}
                disabled={isIngesting}
              />
            </div>

            <button
              type="submit"
              disabled={!repoUrlInput.trim() || isIngesting}
              className="flex items-center justify-center gap-2 px-6 py-2.5 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-[11px] font-bold tracking-widest uppercase transition-all shrink-0"
              style={{
                backgroundColor: 'var(--accent-btn-bg)',
                color: 'var(--accent-btn-text)'
              }}
            >
              {isIngesting ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>INITIALIZING...</span>
                </>
              ) : (
                <>
                  <GitBranch size={13} />
                  <span>INDEX REPOSITORY</span>
                </>
              )}
            </button>
          </form>

          {/* Quick Target Selectors */}
          <div className="flex items-center gap-2 mt-2.5 flex-wrap font-mono">
            <span className="text-[10px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>PRESETS:</span>
            {SAMPLE_REPOS.map((sample) => (
              <button
                key={sample.name}
                type="button"
                onClick={() => handleIngest(sample.url)}
                disabled={isIngesting}
                className="text-[11px] px-2.5 py-1 transition-all"
                style={{
                  border: repoInfo.repo_name === sample.name ? '1px solid var(--accent-badge)' : '1px solid var(--border-subtle)',
                  backgroundColor: repoInfo.repo_name === sample.name ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                  color: repoInfo.repo_name === sample.name ? 'var(--text-heading)' : 'var(--text-muted)'
                }}
              >
                [ {sample.name} ]
              </button>
            ))}
          </div>

          {/* Precision Ingestion Telemetry Bar */}
          {isIngesting && (
            <div
              className="mt-3 p-3 font-mono"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-strong)'
              }}
            >
              <div className="flex items-center justify-between text-[11px] mb-2">
                <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                  <Activity size={13} className="animate-pulse" style={{ color: 'var(--text-heading)' }} />
                  <span className="tracking-wider uppercase">{ingestStatus || 'PROCESSING VECTORS...'}</span>
                </div>
                <span className="font-bold tracking-widest" style={{ color: 'var(--text-heading)' }}>
                  [ {ingestProgressPct}% ]
                </span>
              </div>
              <div className="w-full h-1" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    backgroundColor: 'var(--accent-badge)',
                    width: `${Math.max(4, ingestProgressPct)}%`
                  }}
                />
              </div>
            </div>
          )}

          {ingestSuccess && (
            <div
              className="mt-2.5 p-2.5 text-xs font-mono flex items-center gap-2"
              style={{
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.4)',
                color: '#22c55e'
              }}
            >
              <CheckCircle2 size={14} className="shrink-0" />
              <span className="tracking-wider">{ingestSuccess}</span>
            </div>
          )}

          {ingestError && (
            <div
              className="mt-2.5 p-2.5 text-xs font-mono flex items-center gap-2"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                color: '#ef4444'
              }}
            >
              <AlertCircle size={14} className="shrink-0" />
              <span className="tracking-wider">{ingestError}</span>
            </div>
          )}
        </section>

        {/* Scrollable Conversation Viewport */}
        <main className="flex-1 overflow-y-auto py-6 space-y-6 pr-1">
          {messages.length === 0 ? (
            <div className="space-y-8 py-2">

              {/* Tactical Hero Canvas */}
              <div
                className="relative overflow-hidden"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                {/* Visual Imagery Viewport */}
                <div
                  className="relative h-64 sm:h-80 w-full overflow-hidden"
                  style={{
                    backgroundColor: 'var(--bg-app)',
                    borderBottom: '1px solid var(--border-subtle)'
                  }}
                >
                  <img
                    src={activeThemeConfig.hero}
                    alt="Autonomous Lattice Mesh Telemetry"
                    className="w-full h-full object-cover object-center opacity-85 transition-all duration-500"
                    style={{ filter: 'var(--hero-filter)' }}
                  />
                  <div
                    className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none"
                  />
                  
                  {/* Tactical Telemetry Overlays */}
                  <div
                    className="absolute top-3 left-3 flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase px-2 py-1"
                    style={{
                      backgroundColor: 'rgba(0,0,0,0.8)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-main)'
                    }}
                  >
                    <Crosshair size={11} />
                    <span>{activeThemeConfig.tag}</span>
                  </div>

                  <div
                    className="absolute top-3 right-3 text-[10px] font-mono tracking-widest uppercase px-2 py-1"
                    style={{
                      backgroundColor: 'rgba(0,0,0,0.8)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-muted)'
                    }}
                  >
                    STATUS: ACTIVE_SURVEILLANCE
                  </div>

                  <div
                    className="absolute bottom-3 right-3 text-[10px] font-mono tracking-widest uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    SYS_COORDINATE: 34.0522°N // 118.2437°W
                  </div>
                </div>

                {/* Hero Editorial & Typography */}
                <div className="p-6 sm:p-8 space-y-6">
                  <div className="space-y-2">
                    <div
                      className="text-[11px] font-mono tracking-[0.25em] uppercase"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      DEFENSE-GRADE SOFTWARE RECONNAISSANCE
                    </div>
                    <h2
                      className="text-2xl sm:text-4xl font-extrabold tracking-tight uppercase font-sans"
                      style={{ color: 'var(--text-heading)' }}
                    >
                      REBOOTING CODEBASE UNDERSTANDING.
                    </h2>
                    <p
                      className="text-sm max-w-3xl leading-relaxed"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Autonomous semantic retrieval across public software repositories. Slices AST structures into localized vector coordinates, resolving complex architecture and dependencies with mathematical provenance.
                    </p>
                  </div>

                  {/* 3 Precision Directives */}
                  <div
                    className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-6"
                    style={{ borderTop: '1px solid var(--border-subtle)' }}
                  >
                    <div
                      className="p-3.5 space-y-1.5"
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        border: '1px solid var(--border-subtle)'
                      }}
                    >
                      <div
                        className="text-[10px] font-mono font-bold tracking-widest uppercase"
                        style={{ color: 'var(--text-heading)' }}
                      >
                        01 // VECTOR RESOLUTION
                      </div>
                      <p className="text-xs leading-normal" style={{ color: 'var(--text-secondary)' }}>
                        AST parsing & chunking embedded into 384-dimensional cosine space stored in PostgreSQL pgvector.
                      </p>
                    </div>

                    <div
                      className="p-3.5 space-y-1.5"
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        border: '1px solid var(--border-subtle)'
                      }}
                    >
                      <div
                        className="text-[10px] font-mono font-bold tracking-widest uppercase"
                        style={{ color: 'var(--text-heading)' }}
                      >
                        02 // TOPOLOGICAL SEARCH
                      </div>
                      <p className="text-xs leading-normal" style={{ color: 'var(--text-secondary)' }}>
                        Exact nearest-neighbor cosine distance search isolating high-signal implementation blocks.
                      </p>
                    </div>

                    <div
                      className="p-3.5 space-y-1.5"
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        border: '1px solid var(--border-subtle)'
                      }}
                    >
                      <div
                        className="text-[10px] font-mono font-bold tracking-widest uppercase"
                        style={{ color: 'var(--text-heading)' }}
                      >
                        03 // GROUNDED REASONING
                      </div>
                      <p className="text-xs leading-normal" style={{ color: 'var(--text-secondary)' }}>
                        Ultra-low latency Groq LPU synthesis anchored strictly to verified source files without hallucination.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Categorized Mission Prompts */}
              <div className="space-y-3">
                <div
                  className="flex items-center justify-between pb-2"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                >
                  <span
                    className="text-[11px] font-mono tracking-widest uppercase font-semibold"
                    style={{ color: 'var(--text-heading)' }}
                  >
                    INSPECTION DIRECTIVES // {repoInfo.repo_name.toUpperCase()}
                  </span>
                  <span className="text-[10px] font-mono uppercase" style={{ color: 'var(--text-muted)' }}>
                    SELECT DIRECTIVE TO EXECUTE
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {TACTICAL_PROMPTS.map((prompt) => (
                    <div
                      key={prompt.index}
                      className="p-4 flex flex-col justify-between space-y-3"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)'
                      }}
                    >
                      <div
                        className="pb-2 flex items-center justify-between"
                        style={{ borderBottom: '1px solid var(--border-subtle)' }}
                      >
                        <span className="text-[10px] font-mono tracking-widest" style={{ color: 'var(--text-muted)' }}>
                          SEC // {prompt.index}
                        </span>
                        <span
                          className="text-xs font-mono font-bold tracking-wider uppercase"
                          style={{ color: 'var(--text-heading)' }}
                        >
                          {prompt.tag}
                        </span>
                      </div>

                      <div className="space-y-2">
                        {prompt.queries.map((q, qIdx) => (
                          <button
                            key={qIdx}
                            onClick={() => handleSend(q)}
                            disabled={isIngesting}
                            className="w-full text-left p-2.5 transition-all group flex items-start justify-between gap-2 font-mono text-xs"
                            style={{
                              backgroundColor: 'var(--bg-elevated)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-secondary)'
                            }}
                          >
                            <span className="leading-snug group-hover:text-white transition-colors">{q}</span>
                            <ArrowRight size={12} className="shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className="space-y-1 animate-fadeIn"
              >
                {/* Header Tag */}
                <div
                  className="flex items-center justify-between text-[10px] font-mono tracking-widest uppercase px-1"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <span>
                    {msg.role === 'user' ? 'OPERATOR // COMMAND' : 'LATTICE CORE // SYNTHESIS'}
                  </span>
                  <span>{msg.timestamp || '00:00:00'}</span>
                </div>

                {/* Message Body Container */}
                <div
                  className="p-5 font-mono text-sm"
                  style={{
                    backgroundColor: msg.role === 'user' ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                    border: msg.role === 'user' ? '1px solid var(--border-strong)' : '1px solid var(--border-subtle)',
                    color: 'var(--text-main)'
                  }}
                >
                  {msg.role === 'user' ? (
                    <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  ) : (
                    <div>
                      {/* Formatted Markdown */}
                      <div className="answer-prose">
                        {renderFormattedContent(msg.content, msg.id)}
                      </div>

                      {/* Grounded Citations Drawer */}
                      {msg.sources && msg.sources.length > 0 && (
                        <div
                          className="mt-5 pt-4 font-mono"
                          style={{ borderTop: '1px solid var(--border-subtle)' }}
                        >
                          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                            <div
                              className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest"
                              style={{ color: 'var(--text-heading)' }}
                            >
                              <Shield size={13} style={{ color: 'var(--accent-badge)' }} />
                              <span>VERIFIED SOURCE PROVENANCE:</span>
                            </div>

                            {msg.chunks && msg.chunks.length > 0 && (
                              <button
                                onClick={() => toggleSnippetExpansion(msg.id)}
                                className="flex items-center gap-1 text-[11px] uppercase tracking-wider transition-colors"
                                style={{ color: 'var(--text-secondary)' }}
                              >
                                {expandedSnippets[msg.id] ? (
                                  <>
                                    <span>[ COLLAPSE RAW CHUNKS ]</span>
                                    <ChevronUp size={12} />
                                  </>
                                ) : (
                                  <>
                                    <span>[ INSPECT {msg.chunks.length} RETRIEVED CHUNKS ]</span>
                                    <ChevronDown size={12} />
                                  </>
                                )}
                              </button>
                            )}
                          </div>

                          {/* Source File Pills */}
                          <div className="flex flex-wrap gap-1.5">
                            {msg.sources.map((src, sIdx) => (
                              <span
                                key={sIdx}
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px]"
                                style={{
                                  backgroundColor: 'var(--bg-elevated)',
                                  border: '1px solid var(--border-subtle)',
                                  color: 'var(--text-main)'
                                }}
                              >
                                <FileCode size={11} style={{ color: 'var(--text-muted)' }} />
                                <span>{src}</span>
                              </span>
                            ))}
                          </div>

                          {/* Collapsible Debugger Chunks */}
                          {expandedSnippets[msg.id] && msg.chunks && (
                            <div className="mt-3 space-y-2">
                              {msg.chunks.map((chunk, cIdx) => (
                                <div
                                  key={cIdx}
                                  style={{
                                    backgroundColor: 'var(--code-bg)',
                                    border: '1px solid var(--border-subtle)'
                                  }}
                                >
                                  <div
                                    className="flex items-center justify-between px-3 py-1.5 text-[10px]"
                                    style={{
                                      backgroundColor: 'var(--code-header)',
                                      borderBottom: '1px solid var(--border-subtle)',
                                      color: 'var(--text-muted)'
                                    }}
                                  >
                                    <span>
                                      {chunk.file_path} [ CHUNK #{chunk.chunk_index} ]
                                    </span>
                                    <span className="font-bold" style={{ color: 'var(--text-heading)' }}>
                                      COSINE SIMILARITY: {chunk.similarity}
                                    </span>
                                  </div>
                                  <pre
                                    className="p-3 text-[11px] overflow-x-auto max-h-48 leading-relaxed whitespace-pre-wrap font-mono"
                                    style={{ color: 'var(--text-secondary)' }}
                                  >
                                    {chunk.content}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Loading Indicator */}
          {loading && (
            <div
              className="p-4 font-mono text-xs flex items-center gap-3"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)'
              }}
            >
              <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-heading)' }} />
              <span className="tracking-wider uppercase">
                RESOLVING TOPOLOGICAL VECTORS & SYNTHESIZING RESPONSE...
              </span>
            </div>
          )}

          <div ref={chatEndRef} />
        </main>

        {/* Tactical Command Input Dock */}
        <footer
          className="py-4 shrink-0"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <div
            className="p-2 transition-colors"
            style={{
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <div className="flex items-end gap-2">
              <span
                className="pl-2 pb-1.5 font-mono text-xs select-none"
                style={{ color: 'var(--text-muted)' }}
              >
                EXECUTE // &gt;
              </span>
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading || isIngesting}
                placeholder={
                  isIngesting
                    ? `INGESTION ACTIVE ON ${repoUrlInput || 'TARGET'}...`
                    : `Query ${repoInfo.repo_name} (e.g. How are incoming requests routed?)...`
                }
                className="flex-1 max-h-36 min-h-[26px] resize-none bg-transparent text-xs font-mono focus:outline-none leading-relaxed py-1"
                style={{ color: 'var(--text-main)' }}
              />

              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!input.trim() || loading || isIngesting}
                className="px-4 py-2 disabled:opacity-20 disabled:cursor-not-allowed font-mono text-[11px] font-bold uppercase tracking-wider transition-all shrink-0"
                style={{
                  backgroundColor: 'var(--accent-btn-bg)',
                  color: 'var(--accent-btn-text)'
                }}
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : 'TRANSMIT'}
              </button>
            </div>
          </div>

          <div
            className="flex items-center justify-between px-1 pt-2 text-[10px] font-mono tracking-wider uppercase"
            style={{ color: 'var(--text-muted)' }}
          >
            <span>
              [ENTER] TRANSMIT QUERY &bull; [SHIFT+ENTER] NEWLINE
            </span>
            <span>
              ACTIVE_CONTEXT: {repoInfo.repo_name} ({repoInfo.total_chunks} CHUNKS) &bull; THEME: {activeThemeConfig.label}
            </span>
          </div>
        </footer>

      </div>
    </div>
  )
}
