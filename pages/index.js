import { useEffect, useRef, useState, useCallback } from 'react'
import Head from 'next/head'
import styles from '../styles/Home.module.css'

const BULL = '#1baf7a'
const BEAR = '#e34948'
const CPR_COLOR = '#f59e0b'
const SR_COLOR = '#6366f1'
const PAD = { t: 20, r: 16, b: 30, l: 65 }

const LINE_COLORS = {
  resistance: '#a78bfa',
  support: '#60a5fa',
  entry: '#e2e8f0',
  sl: '#e34948',
  target: '#1baf7a',
  trendline_high: '#f97316',
  trendline_low: '#f97316',
}

function resolutionLabel(r) {
  const map = {
    '1': '1 min', '3': '3 min', '5': '5 min', '10': '10 min',
    '15': '15 min', '30': '30 min', '45': '45 min',
    '60': '1 hr', '120': '2 hr', '240': '4 hr',
    'D': 'Daily', '1W': 'Weekly', '1M': 'Monthly'
  }
  return map[r] || r
}

export default function Home() {
  const mainRef = useRef(null)
  const volRef = useRef(null)
  const [token, setToken] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [symbol, setSymbol] = useState('NSE:NIFTY50-INDEX')
  const [resolution, setResolution] = useState('D')
  const [status, setStatus] = useState('')
  const [showCPR, setShowCPR] = useState(false)
  const [showSR, setShowSR] = useState(false)
  const [candles, setCandles] = useState([])
  const [stats, setStats] = useState(null)
  const [patterns, setPatterns] = useState([])
  const [detecting, setDetecting] = useState(false)
  const [activePattern, setActivePattern] = useState(null) // index of pattern to show

  async function getAuthURL() {
    const res = await fetch('/api/auth')
    const { authURL } = await res.json()
    window.open(authURL, '_blank')
    setStatus('Login in the opened tab, copy the auth_code from redirect URL')
  }

  async function exchangeToken() {
    if (!authCode) return setStatus('Paste auth_code first')
    setStatus('Exchanging token...')
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_code: authCode.trim() })
    })
    const data = await res.json()
    if (data.access_token) {
      setToken(data.access_token)
      localStorage.setItem('fyers_token', data.access_token)
      setStatus('Token saved!')
    } else {
      setStatus('Error: ' + (data.error || 'Auth failed'))
    }
  }

  async function fetchAndLoad() {
    if (!token) return setStatus('Get token first')
    setStatus('Fetching from Fyers...')
    const res = await fetch('/api/fetch-ohlcv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, resolution, access_token: token })
    })
    const data = await res.json()
    if (data.error) return setStatus('Error: ' + data.error)
    setStatus(`Saved ${data.count} candles. Loading chart...`)
    await loadCandles()
  }

  async function loadCandles() {
    const res = await fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&limit=500`)
    const data = await res.json()
    if (data.candles && data.candles.length) {
      setCandles(data.candles)
      computeStats(data.candles)
      setPatterns([])
      setActivePattern(null)
      setStatus(`Loaded ${data.candles.length} candles`)
    } else {
      setStatus('No data. Fetch first.')
    }
  }

  function computeStats(c) {
    if (!c.length) return
    const highs = c.map(d => d.high), lows = c.map(d => d.low), closes = c.map(d => d.close)
    const chg = ((closes[closes.length - 1] - c[0].open) / c[0].open * 100).toFixed(2)
    setStats({ high: Math.max(...highs).toFixed(2), low: Math.min(...lows).toFixed(2), last: closes[closes.length - 1].toFixed(2), chg, bull: parseFloat(chg) >= 0 })
  }

  function calcCPR(prev) {
    if (!prev) return null
    const P = (prev.high + prev.low + prev.close) / 3
    const TC = (prev.high + prev.low) / 2
    const BC = 2 * P - TC
    return { P, TC: Math.max(TC, BC), BC: Math.min(TC, BC) }
  }

  function calcSR(data) {
    const bSize = (Math.max(...data.map(d => d.high)) - Math.min(...data.map(d => d.low))) / 20
    const clusters = {}
    data.forEach(d => {
      [d.high, d.low, d.close].forEach(p => {
        const bucket = Math.round(p / bSize) * bSize
        clusters[bucket] = (clusters[bucket] || 0) + 1
      })
    })
    return Object.entries(clusters).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p]) => parseFloat(p))
  }

  async function detectPatterns() {
    if (!mainRef.current) return
    setDetecting(true)
    setPatterns([])
    setActivePattern(null)
    try {
      const mainCanvas = mainRef.current
      const volCanvas = volRef.current
      const W = mainCanvas.width / devicePixelRatio
      const MH = mainCanvas.height / devicePixelRatio
      const VH = volCanvas.height / devicePixelRatio
      const combined = document.createElement('canvas')
      combined.width = W * devicePixelRatio
      combined.height = (MH + VH) * devicePixelRatio
      const ctx = combined.getContext('2d')
      ctx.fillStyle = '#1a1a1a'
      ctx.fillRect(0, 0, combined.width, combined.height)
      ctx.drawImage(mainCanvas, 0, 0)
      ctx.drawImage(volCanvas, 0, mainCanvas.height)
      const base64 = combined.toDataURL('image/png').split(',')[1]
      const res = await fetch('/api/detect-patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, symbol, resolution })
      })
      const data = await res.json()
      if (data.error) { setStatus('Error: ' + data.error) }
      else { setPatterns(data.patterns || []); setStatus(`Found ${data.patterns?.length || 0} pattern(s)`) }
    } catch (e) { setStatus('Error: ' + e.message) }
    setDetecting(false)
  }

  function togglePattern(idx) {
    setActivePattern(prev => prev === idx ? null : idx)
  }

  const renderChart = useCallback(() => {
    const data = candles
    if (!data.length || !mainRef.current) return

    const mainCanvas = mainRef.current
    const volCanvas = volRef.current
    const W = mainCanvas.parentElement.offsetWidth || 680
    const MH = 340, VH = 80

    mainCanvas.width = W * devicePixelRatio
    mainCanvas.height = MH * devicePixelRatio
    mainCanvas.style.width = W + 'px'
    mainCanvas.style.height = MH + 'px'
    const ctx = mainCanvas.getContext('2d')
    ctx.scale(devicePixelRatio, devicePixelRatio)

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    ctx.fillStyle = isDark ? '#1a1a1a' : '#ffffff'
    ctx.fillRect(0, 0, W, MH)

    const gridC = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
    const textC = '#898781'
    const axisC = isDark ? '#383835' : '#c3c2b7'

    const n = data.length
    const maxH = Math.max(...data.map(d => d.high))
    const minL = Math.min(...data.map(d => d.low))
    const pad = (maxH - minL) * 0.08
    const priceMax = maxH + pad, priceMin = minL - pad
    const priceRange = priceMax - priceMin

    const cw = W - PAD.l - PAD.r
    const ch = MH - PAD.t - PAD.b
    const slotW = cw / n
    const bodyW = Math.max(2, slotW * 0.55)

    const py = p => PAD.t + ch * (1 - (p - priceMin) / priceRange)
    const cx = i => PAD.l + slotW * i + slotW / 2

    // Grid
    for (let i = 0; i <= 5; i++) {
      const p = priceMin + priceRange * i / 5
      const y = py(p)
      ctx.strokeStyle = gridC; ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke()
      ctx.fillStyle = textC; ctx.font = '10px sans-serif'; ctx.textAlign = 'right'
      ctx.fillText(p.toFixed(1), PAD.l - 4, y + 3)
    }
    ctx.strokeStyle = axisC; ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(PAD.l, PAD.t); ctx.lineTo(PAD.l, MH - PAD.b); ctx.lineTo(W - PAD.r, MH - PAD.b); ctx.stroke()
    ctx.fillStyle = textC; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'
    const step = Math.ceil(n / 10)
    data.forEach((d, i) => {
      if (i % step !== 0) return
      ctx.fillText(d.timestamp.split('T')[0].slice(5), cx(i), MH - PAD.b + 14)
    })

    // S/R
    if (showSR) {
      calcSR(data).forEach(level => {
        const y = py(level)
        if (y < PAD.t || y > MH - PAD.b) return
        ctx.strokeStyle = SR_COLOR; ctx.setLineDash([4, 4]); ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = SR_COLOR; ctx.font = '9px sans-serif'; ctx.textAlign = 'left'
        ctx.fillText('S/R ' + level.toFixed(1), W - PAD.r + 2, y + 3)
      })
    }

    // CPR
    if (showCPR && data.length > 1) {
      const cpr = calcCPR(data[data.length - 2])
      if (cpr) {
        [{ label: 'P', value: cpr.P }, { label: 'TC', value: cpr.TC }, { label: 'BC', value: cpr.BC }].forEach(({ label, value }) => {
          const y = py(value)
          if (y < PAD.t || y > MH - PAD.b) return
          ctx.strokeStyle = CPR_COLOR; ctx.setLineDash([6, 3]); ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke()
          ctx.setLineDash([])
          ctx.fillStyle = CPR_COLOR; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'right'
          ctx.fillText(`${label} ${value.toFixed(1)}`, PAD.l - 4, y + 3)
        })
      }
    }

    // Candles
    data.forEach((d, i) => {
      const x = cx(i)
      const bull = d.close >= d.open
      const color = bull ? BULL : BEAR
      const top = py(Math.max(d.open, d.close))
      const bot = py(Math.min(d.open, d.close))
      const bodyH = Math.max(1, bot - top)
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, slotW * 0.08)
      ctx.beginPath(); ctx.moveTo(x, py(d.high)); ctx.lineTo(x, py(d.low)); ctx.stroke()
      ctx.fillStyle = color
      ctx.fillRect(x - bodyW / 2, top, bodyW, bodyH)
    })

    // Draw active pattern overlay only
    if (activePattern !== null && patterns[activePattern]?.drawLines) {
      const labelYUsed = []
      patterns[activePattern].drawLines.forEach(line => {
        const price = parseFloat(line.price)
        if (!price || isNaN(price) || price < priceMin || price > priceMax) return
        const y = py(price)
        if (y < PAD.t || y > MH - PAD.b) return

        const color = LINE_COLORS[line.type] || '#888'
        const isDashed = line.type === 'resistance' || line.type === 'support'

        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.globalAlpha = 0.9
        ctx.setLineDash(isDashed ? [6, 4] : [])
        ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1

        // Label with background
        let labelY = y - 4
        while (labelYUsed.some(ly => Math.abs(ly - labelY) < 14)) labelY -= 14
        labelYUsed.push(labelY)

        const label = `${line.label}  ${price.toFixed(0)}`
        ctx.font = 'bold 9px sans-serif'
        ctx.textAlign = 'right'
        const tw = ctx.measureText(label).width
        ctx.fillStyle = isDark ? 'rgba(20,20,20,0.9)' : 'rgba(255,255,255,0.9)'
        ctx.fillRect(W - PAD.r - tw - 10, labelY - 10, tw + 10, 14)
        ctx.fillStyle = color
        ctx.fillText(label, W - PAD.r - 2, labelY)
      })
    }

    // Volume
    volCanvas.width = W * devicePixelRatio
    volCanvas.height = VH * devicePixelRatio
    volCanvas.style.width = W + 'px'
    volCanvas.style.height = VH + 'px'
    const vctx = volCanvas.getContext('2d')
    vctx.scale(devicePixelRatio, devicePixelRatio)
    vctx.fillStyle = isDark ? '#1a1a1a' : '#ffffff'
    vctx.fillRect(0, 0, W, VH)

    const vols = data.map(d => d.volume)
    const maxV = Math.max(...vols) || 1
    const vch = VH - 24
    const fmtV = v => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v

    vctx.strokeStyle = axisC; vctx.lineWidth = 0.5
    vctx.beginPath(); vctx.moveTo(PAD.l, VH - 20); vctx.lineTo(W - PAD.r, VH - 20); vctx.stroke()
    vctx.fillStyle = textC; vctx.font = '9px sans-serif'; vctx.textAlign = 'right'
    vctx.fillText(fmtV(maxV), PAD.l - 4, 12)

    data.forEach((d, i) => {
      const bull = d.close >= d.open
      const bh = vch * (d.volume / maxV)
      const x = cx(i)
      vctx.fillStyle = bull ? 'rgba(27,175,122,0.35)' : 'rgba(227,73,72,0.35)'
      vctx.fillRect(x - bodyW / 2, VH - 20 - bh, bodyW, bh)
      vctx.strokeStyle = bull ? BULL : BEAR; vctx.lineWidth = 0.5
      vctx.strokeRect(x - bodyW / 2, VH - 20 - bh, bodyW, bh)
    })
  }, [candles, showCPR, showSR, activePattern, patterns])

  useEffect(() => { if (candles.length) renderChart() }, [renderChart])
  useEffect(() => {
    const saved = localStorage.getItem('fyers_token')
    if (saved) { setToken(saved); setStatus('Token loaded from storage') }
  }, [])
  useEffect(() => {
    window.addEventListener('resize', renderChart)
    return () => window.removeEventListener('resize', renderChart)
  }, [renderChart])

  return (
    <>
      <Head><title>Trading Chart</title></Head>
      <div className={styles.app}>
        <h1 className={styles.title}>Trading Chart</h1>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Fyers Auth</div>
          <div className={styles.row}>
            <button className={styles.btn} onClick={getAuthURL}>1. Open Login</button>
            <input className={styles.input} placeholder="Paste auth_code from redirect URL"
              value={authCode} onChange={e => setAuthCode(e.target.value)} />
            <button className={styles.btn} onClick={exchangeToken}>2. Get Token</button>
          </div>
          {token && <div className={styles.tokenBadge}>Token active</div>}
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Fetch Data</div>
          <div className={styles.row}>
            <input className={styles.input} value={symbol}
              onChange={e => setSymbol(e.target.value)} placeholder="NSE:NIFTY50-INDEX" />
            <select className={styles.select} value={resolution} onChange={e => setResolution(e.target.value)}>
              <option value="1">1 min</option>
              <option value="3">3 min</option>
              <option value="5">5 min</option>
              <option value="10">10 min</option>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60">1 hr</option>
              <option value="120">2 hr</option>
              <option value="240">4 hr</option>
              <option value="D">Daily</option>
              <option value="1W">Weekly</option>
              <option value="1M">Monthly</option>
            </select>
            <button className={styles.btnPrimary} onClick={fetchAndLoad}>Fetch + Chart</button>
            <button className={styles.btn} onClick={loadCandles}>Load from DB</button>
          </div>
          {status && <div className={styles.status}>{status}</div>}
        </div>

        {stats && (
          <div className={styles.stats}>
            <div className={styles.stat}><div className={styles.statL}>High</div><div className={styles.statV}>{stats.high}</div></div>
            <div className={styles.stat}><div className={styles.statL}>Low</div><div className={styles.statV}>{stats.low}</div></div>
            <div className={styles.stat}><div className={styles.statL}>Last</div><div className={styles.statV}>{stats.last}</div></div>
            <div className={styles.stat}><div className={styles.statL}>Change</div><div className={styles.statV} style={{ color: stats.bull ? BULL : BEAR }}>{stats.chg}%</div></div>
          </div>
        )}

        {candles.length > 0 && (
          <div className={styles.toggleRow}>
            <label className={styles.toggle}>
              <input type="checkbox" checked={showCPR} onChange={e => setShowCPR(e.target.checked)} />
              <span>CPR</span>
            </label>
            <label className={styles.toggle}>
              <input type="checkbox" checked={showSR} onChange={e => setShowSR(e.target.checked)} />
              <span>S/R Zones</span>
            </label>
            <span className={styles.candleCount}>{candles.length} candles</span>
          </div>
        )}

        <div className={styles.chartWrap}>
          <canvas ref={mainRef} style={{ display: 'block', width: '100%' }} />
          <canvas ref={volRef} style={{ display: 'block', width: '100%', marginTop: 4 }} />
        </div>

        {/* Active pattern legend */}
        {activePattern !== null && patterns[activePattern] && (
          <div className={styles.legend} style={{ marginTop: 8, flexWrap: 'wrap', gap: 10 }}>
            <span style={{ fontSize: 12, color: '#888', marginRight: 4 }}>Showing:</span>
            {Object.entries(LINE_COLORS).map(([type, color]) => (
              <span key={type}><span className={styles.dot} style={{ background: color }} /> {type.replace('_', ' ')}</span>
            ))}
          </div>
        )}

        {candles.length > 0 && (
          <button className={styles.btnPrimary} onClick={detectPatterns} disabled={detecting}
            style={{ marginTop: 12, width: '100%', padding: '10px', fontSize: 14 }}>
            {detecting ? 'Analysing chart with AI...' : 'Detect Patterns with AI'}
          </button>
        )}

        {patterns.length > 0 && (
          <div className={styles.card} style={{ marginTop: 12 }}>
            <div className={styles.cardTitle}>
              AI Pattern Analysis -- {symbol} {resolutionLabel(resolution)}
              <span style={{ fontSize: 11, color: '#888', marginLeft: 8, fontWeight: 400 }}>
                Toggle preview on chart
              </span>
            </div>

            {patterns.map((p, i) => {
              const isActive = activePattern === i
              const signalColor = p.signal === 'Bullish' ? BULL : p.signal === 'Bearish' ? BEAR : '#6366f1'
              const confColor = p.confidence === 'High' ? BULL : p.confidence === 'Low' ? BEAR : '#f59e0b'

              return (
                <div key={i} style={{
                  padding: '12px 0',
                  borderBottom: i < patterns.length - 1 ? '0.5px solid var(--border,#333)' : 'none',
                  opacity: activePattern !== null && !isActive ? 0.4 : 1,
                  transition: 'opacity 0.2s'
                }}>
                  {/* Header row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <span style={{
                      background: p.signal === 'Bullish' ? 'rgba(27,175,122,0.15)' : p.signal === 'Bearish' ? 'rgba(227,73,72,0.15)' : 'rgba(99,102,241,0.15)',
                      color: signalColor,
                      padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600
                    }}>{p.pattern}</span>
                    <span style={{ fontSize: 12, color: signalColor }}>
                      {p.signal === 'Bullish' ? '↑' : p.signal === 'Bearish' ? '↓' : '↕'} {p.signal}
                    </span>
                    <span style={{ fontSize: 11, color: confColor, marginLeft: 4 }}>
                      {p.confidence} confidence
                    </span>

                    {/* Preview toggle button */}
                    <button
                      onClick={() => togglePattern(i)}
                      style={{
                        marginLeft: 'auto',
                        padding: '4px 12px',
                        borderRadius: 6,
                        border: `1px solid ${isActive ? signalColor : '#444'}`,
                        background: isActive ? signalColor + '22' : 'transparent',
                        color: isActive ? signalColor : '#888',
                        fontSize: 12,
                        cursor: 'pointer',
                        fontWeight: isActive ? 600 : 400,
                        transition: 'all 0.15s'
                      }}
                    >
                      {isActive ? '✓ Previewing' : 'Preview on chart'}
                    </button>
                  </div>

                  {/* Notes */}
                  {p.notes && (
                    <div style={{ fontSize: 12, color: '#999', marginBottom: 8, lineHeight: 1.5 }}>{p.notes}</div>
                  )}

                  {/* Trade levels */}
                  {(p.entry || p.stopLoss || p.target1) && (
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      {p.entry && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entry</span>
                          <span style={{ fontSize: 14, color: LINE_COLORS.entry, fontWeight: 600 }}>{p.entry}</span>
                        </div>
                      )}
                      {p.stopLoss && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Stop Loss</span>
                          <span style={{ fontSize: 14, color: BEAR, fontWeight: 600 }}>{p.stopLoss}</span>
                        </div>
                      )}
                      {p.target1 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Target 1</span>
                          <span style={{ fontSize: 14, color: BULL, fontWeight: 600 }}>{p.target1}</span>
                        </div>
                      )}
                      {p.target2 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Target 2</span>
                          <span style={{ fontSize: 14, color: BULL, fontWeight: 600 }}>{p.target2}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
