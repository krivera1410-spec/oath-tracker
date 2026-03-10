'use client'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useUser, UserButton } from '@clerk/nextjs'
import { supabase } from '@/lib/supabase'
import type { OATHViolation, MotiveEvent } from '@/lib/supabase'
import { VEHICLE_TYPES, KNOWN_VEHICLES, NYC_LIMIT, calcRisk, RISK_META, VIOLATION_TYPES, STATUS_CFG } from '@/lib/config'
import { parseMotiveCSV } from '@/lib/parseMotiveCSV'

const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']

function blankV(): Partial<OATHViolation> {
  return { oath_ticket_number: '', date_issued: new Date().toISOString().slice(0, 10), violation_type: 'IDLING', vehicle: '', driver: '', location: '', borough: 'Manhattan', fine_amount: 350, status: 'OPEN', notes: '', telematics_pulled: false, motive_event_id: '' }
}

export default function Home() {
  const { user } = useUser()
  const [view, setView] = useState('dashboard')
  const [violations, setViolations] = useState<OATHViolation[]>([])
  const [motiveEvents, setMotiveEvents] = useState<MotiveEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [newV, setNewV] = useState<Partial<OATHViolation>>(blankV())
  const [selectedV, setSelectedV] = useState<OATHViolation | null>(null)
  const [selectedM, setSelectedM] = useState<MotiveEvent | null>(null)
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [filterVehicle, setFilterVehicle] = useState('ALL')
  const [filterRisk, setFilterRisk] = useState('ALL')
  const [fleetTab, setFleetTab] = useState('all')
  const [sortField, setSortField] = useState('idle_mins')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [importMsg, setImportMsg] = useState('')
  const csvRef = useRef<HTMLInputElement>(null)

  // ── Load data from Supabase ──
  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: vs }, { data: ms }] = await Promise.all([
        supabase.from('oath_violations').select('*').order('date_issued', { ascending: false }),
        supabase.from('motive_events').select('*').order('event_date', { ascending: false }),
      ])
      if (vs) setViolations(vs)
      if (ms) setMotiveEvents(ms)
      setLoading(false)
    }
    load()
  }, [])

  // ── CSV import ──
  const handleCSV = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const text = await file.text()
    const events = parseMotiveCSV(text)
    setSaving(true)
    const { data, error } = await supabase.from('motive_events').insert(events).select()
    if (!error && data) {
      setMotiveEvents(prev => [...data, ...prev])
      setImportMsg(`✓ Imported ${data.length} events from ${file.name}`)
      setTimeout(() => setImportMsg(''), 5000)
      setView('motive')
    }
    setSaving(false)
    e.target.value = ''
  }, [])

  // ── Add violation ──
  const addViolation = async () => {
    setSaving(true)
    const { data, error } = await supabase.from('oath_violations').insert([newV]).select()
    if (!error && data) {
      setViolations(prev => [...data, ...prev])
      setShowForm(false)
      setNewV(blankV())
    }
    setSaving(false)
  }

  // ── Update violation status ──
  const updateVStatus = async (id: number, status: string) => {
    await supabase.from('oath_violations').update({ status }).eq('id', id)
    setViolations(prev => prev.map(v => v.id === id ? { ...v, status: status as OATHViolation['status'] } : v))
    if (selectedV?.id === id) setSelectedV(s => s ? { ...s, status: status as OATHViolation['status'] } : s)
  }

  // ── Update motive event ──
  const updateMotive = async (id: number, patch: Partial<MotiveEvent>) => {
    await supabase.from('motive_events').update(patch).eq('id', id)
    setMotiveEvents(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
    if (selectedM?.id === id) setSelectedM(s => s ? { ...s, ...patch } : s)
  }

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortField(field); setSortDir('desc') }
  }

  // ── Derived stats ──
  const vehicles = useMemo(() => [...new Set(motiveEvents.map(e => e.vehicle))].sort(), [motiveEvents])

  const filteredMotive = useMemo(() => {
    let ev = [...motiveEvents]
    if (filterVehicle !== 'ALL') ev = ev.filter(e => e.vehicle === filterVehicle)
    if (filterRisk !== 'ALL') ev = ev.filter(e => e.risk_level === filterRisk)
    if (fleetTab === 'crane') ev = ev.filter(e => VEHICLE_TYPES[e.vehicle_type]?.exemptIdle)
    if (fleetTab === 'standard') ev = ev.filter(e => !VEHICLE_TYPES[e.vehicle_type]?.exemptIdle)
    return ev.sort((a, b) => {
      const av = sortField === 'idle_mins' ? a.idle_mins : sortField === 'event_date' ? a.event_date : a.vehicle
      const bv = sortField === 'idle_mins' ? b.idle_mins : sortField === 'event_date' ? b.event_date : b.vehicle
      return sortDir === 'desc' ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1)
    })
  }, [motiveEvents, filterVehicle, filterRisk, fleetTab, sortField, sortDir])

  const mStats = useMemo(() => {
    if (!motiveEvents.length) return null
    const craneEvents = motiveEvents.filter(e => VEHICLE_TYPES[e.vehicle_type]?.exemptIdle)
    const stdEvents = motiveEvents.filter(e => !VEHICLE_TYPES[e.vehicle_type]?.exemptIdle)
    const realViolations = stdEvents.filter(e => e.idle_mins > NYC_LIMIT)
    const needsConfirm = craneEvents.filter(e => e.boom_confirmed === 'unreviewed' && e.idle_mins > 10)
    const confirmedExempt = craneEvents.filter(e => e.boom_confirmed === 'confirmed')
    const byVehicle: Record<string, { mins: number; count: number; violations: number; type: string }> = {}
    motiveEvents.forEach(e => {
      if (!byVehicle[e.vehicle]) byVehicle[e.vehicle] = { mins: 0, count: 0, violations: 0, type: e.vehicle_type }
      byVehicle[e.vehicle].mins += e.idle_mins
      byVehicle[e.vehicle].count++
      if (!VEHICLE_TYPES[e.vehicle_type]?.exemptIdle && e.idle_mins > NYC_LIMIT) byVehicle[e.vehicle].violations++
    })
    return { total: motiveEvents.length, craneEvents, stdEvents, realViolations, needsConfirm, confirmedExempt, byVehicle, totalFuel: motiveEvents.reduce((s, e) => s + e.idle_fuel, 0) }
  }, [motiveEvents])

  const vStats = useMemo(() => ({
    total: violations.reduce((s, v) => s + v.fine_amount, 0),
    open: violations.filter(v => v.status === 'OPEN').reduce((s, v) => s + v.fine_amount, 0),
    dismissed: violations.filter(v => v.status === 'DISMISSED').length,
    exempt: violations.filter(v => v.status === 'EXEMPT').length,
    contested: violations.filter(v => v.status === 'CONTESTED').length,
  }), [violations])

  const craneReviewCount = mStats?.needsConfirm.length ?? 0

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#080808', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, color: '#333', letterSpacing: 3, textTransform: 'uppercase' }}>Loading…</div>
    </div>
  )

  return (
    <div style={{ fontFamily: "'DM Mono','Courier New',monospace", background: '#080808', minHeight: '100vh', color: '#e0e0e0' }}>

      {/* ── Header ── */}
      <div style={{ background: '#0a0a0a', borderBottom: '1px solid #151515', padding: '0 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 18, paddingBottom: 12 }}>
          <div>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20, fontWeight: 900, letterSpacing: 4, color: '#fff', textTransform: 'uppercase' }}>
              <span style={{ color: '#ef4444' }}>OATH</span> VIOLATION TRACKER
            </div>
            <div style={{ fontSize: 9, color: '#282828', letterSpacing: 2.5, marginTop: 3 }}>NYC FLEET COMPLIANCE · MOTIVE INTEGRATED · CRANE-AWARE</div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {importMsg && <span style={{ fontSize: 10, color: '#22c55e', letterSpacing: 1 }}>{importMsg}</span>}
            {saving && <span style={{ fontSize: 10, color: '#f97316', letterSpacing: 1 }}>Saving…</span>}
            <input ref={csvRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCSV} />
            <button className="btn btn-ghost" onClick={() => csvRef.current?.click()}>⬆ Import Motive CSV</button>
            <button className="btn btn-red" onClick={() => setShowForm(true)}>+ Log OATH Ticket</button>
            <UserButton appearance={{ elements: { avatarBox: { width: 32, height: 32 } } }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 0 }}>
          {[
            { key: 'dashboard', label: 'Dashboard' },
            { key: 'motive', label: `Motive Data${motiveEvents.length ? ` (${motiveEvents.length})` : ''}` },
            { key: 'crane', label: `Crane Review${craneReviewCount ? ` ⚑${craneReviewCount}` : ''}` },
            { key: 'violations', label: `OATH Tickets${violations.length ? ` (${violations.length})` : ''}` },
            { key: 'fleet', label: 'Fleet Config' },
            { key: 'reduce', label: 'Reduction Tips' },
          ].map(({ key, label }) => (
            <button key={key} className={`nav-btn ${view === key ? 'active' : ''}`} onClick={() => setView(key)}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '22px 28px', maxWidth: 1300, margin: '0 auto' }}>

        {/* ═══ DASHBOARD ═══ */}
        {view === 'dashboard' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 18 }}>
              {[
                { label: 'Total Idle Events', value: motiveEvents.length || '—', sub: mStats ? `${mStats.stdEvents.length} standard · ${mStats.craneEvents.length} crane` : 'Import CSV to begin', accent: '#ef4444' },
                { label: 'Real Violations (Non-Crane)', value: mStats?.realViolations.length ?? '—', sub: 'Standard trucks >3 min', accent: '#f97316' },
                { label: 'Crane Events to Review', value: craneReviewCount, sub: 'Confirm boom was active', accent: '#a78bfa' },
                { label: 'OATH Tickets Cleared', value: vStats.dismissed + vStats.exempt, sub: `$${((vStats.dismissed + vStats.exempt) * 350).toLocaleString()} saved`, accent: '#22c55e' },
              ].map(s => (
                <div key={s.label} className="card" style={{ padding: '16px 20px', borderTop: `2px solid ${s.accent}` }}>
                  <div style={{ fontSize: 9, color: '#2e2e2e', letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 10 }}>{s.label}</div>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 32, fontWeight: 900, color: s.accent, lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: '#2e2e2e', marginTop: 6 }}>{s.sub}</div>
                </div>
              ))}
            </div>

            {mStats && mStats.craneEvents.length > 0 && (
              <div className="crane-banner" style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 13, fontWeight: 800, color: '#a78bfa', letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 5 }}>
                      🏗️ B-11 &amp; B-12 — Boom/Crane Exemption Active
                    </div>
                    <div style={{ fontSize: 11, color: '#4a3a6a', lineHeight: 1.8 }}>
                      NYC §24-163(b) exempts engines required to power loading equipment. Long idle events on these trucks need job ticket confirmation for OATH defense.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
                    {[
                      { label: 'Crane events', value: mStats.craneEvents.length, color: '#a78bfa' },
                      { label: 'Need review', value: mStats.needsConfirm.length, color: mStats.needsConfirm.length > 0 ? '#f97316' : '#22c55e' },
                      { label: 'Confirmed', value: mStats.confirmedExempt.length, color: '#22c55e' },
                    ].map(s => (
                      <div key={s.label} style={{ textAlign: 'center' }}>
                        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 24, fontWeight: 900, color: s.color }}>{s.value}</div>
                        <div style={{ fontSize: 9, color: '#3a2a5a', letterSpacing: 1.5, textTransform: 'uppercase' }}>{s.label}</div>
                      </div>
                    ))}
                    <button className="btn btn-purple btn-sm" onClick={() => setView('crane')}>Review Now →</button>
                  </div>
                </div>
              </div>
            )}

            {mStats && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
                <div className="card" style={{ padding: 18 }}>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, fontWeight: 800, letterSpacing: 2.5, color: '#2e2e2e', textTransform: 'uppercase', marginBottom: 14 }}>Standard Truck Violations</div>
                  {Object.entries(mStats.byVehicle).filter(([, d]) => !VEHICLE_TYPES[d.type as keyof typeof VEHICLE_TYPES]?.exemptIdle).sort((a, b) => b[1].violations - a[1].violations).slice(0, 6).map(([veh, d]) => {
                    const max = Math.max(...Object.values(mStats.byVehicle).filter(x => !VEHICLE_TYPES[x.type as keyof typeof VEHICLE_TYPES]?.exemptIdle).map(x => x.violations), 1)
                    const vt = VEHICLE_TYPES[d.type as keyof typeof VEHICLE_TYPES]
                    return (
                      <div key={veh} style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15, fontWeight: 800, color: '#bbb' }}>{veh}</span>
                            <span style={{ fontSize: 9, color: vt?.color }}>{vt?.icon} {vt?.label}</span>
                          </div>
                          <span style={{ fontSize: 11, color: d.violations > 5 ? '#ef4444' : d.violations > 2 ? '#f97316' : '#555' }}>{d.violations} violations</span>
                        </div>
                        <div className="prog-bg"><div className="prog-fill" style={{ width: `${d.violations / max * 100}%`, background: d.violations > 5 ? '#ef4444' : d.violations > 2 ? '#f97316' : '#3b82f6' }} /></div>
                      </div>
                    )
                  })}
                </div>
                <div className="card" style={{ padding: 18 }}>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, fontWeight: 800, letterSpacing: 2.5, color: '#2e2e2e', textTransform: 'uppercase', marginBottom: 14 }}>Crane Trucks — Idle Summary</div>
                  {Object.entries(mStats.byVehicle).filter(([, d]) => VEHICLE_TYPES[d.type as keyof typeof VEHICLE_TYPES]?.exemptIdle).map(([veh, d]) => (
                    <div key={veh} style={{ padding: '10px 0', borderBottom: '1px solid #141414' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 800, color: '#a78bfa' }}>{veh}</span>
                          <span style={{ fontSize: 9, color: '#4a3a6a', marginLeft: 10 }}>🏗️ {d.count} events · {d.mins.toFixed(0)} min total</span>
                        </div>
                        <span className="badge" style={{ background: '#13102a', color: '#a78bfa', borderColor: '#2d1d5e' }}>EXEMPT TYPE</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!motiveEvents.length && (
              <div className="drop-zone" onClick={() => csvRef.current?.click()} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 800, color: '#333', letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 8 }}>Import Your Motive Idle Report</div>
                <div style={{ fontSize: 11, color: '#222', lineHeight: 2 }}>Motive Fleet Dashboard → Reports → Engine Idle → Export CSV</div>
              </div>
            )}

            {violations.length > 0 && (
              <div className="card" style={{ padding: 20 }}>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, fontWeight: 800, letterSpacing: 2.5, color: '#2e2e2e', textTransform: 'uppercase', marginBottom: 14 }}>OATH Ticket Status</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8 }}>
                  {Object.entries(STATUS_CFG).map(([key, cfg]) => {
                    const count = violations.filter(v => v.status === key).length
                    const cost = violations.filter(v => v.status === key).reduce((s, v) => s + v.fine_amount, 0)
                    return (
                      <div key={key} style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 2, padding: '12px 14px' }}>
                        <span className="badge" style={{ background: cfg.bg, color: cfg.text, borderColor: cfg.border, marginBottom: 8, display: 'block', width: 'fit-content' }}>{cfg.label}</span>
                        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20, fontWeight: 800, color: '#ccc' }}>{count}</div>
                        <div style={{ fontSize: 10, color: '#333' }}>${cost.toLocaleString()}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ MOTIVE DATA ═══ */}
        {view === 'motive' && (
          <div>
            {!motiveEvents.length ? (
              <div className="drop-zone" onClick={() => csvRef.current?.click()}>
                <div style={{ fontSize: 36, marginBottom: 14 }}>📡</div>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 800, color: '#333', letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 8 }}>No Motive Data Yet</div>
                <div style={{ fontSize: 11, color: '#222', lineHeight: 2.2 }}>Motive → Reports → Engine Idle → Export CSV → Click here</div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: '#0a0a0a', padding: 4, borderRadius: 3, width: 'fit-content' }}>
                  {[['all', 'All Events'], ['standard', 'Standard Trucks'], ['crane', 'Crane / Boom']].map(([k, l]) => (
                    <button key={k} className={`tab-btn ${fleetTab === k ? 'active' : ''}`} onClick={() => setFleetTab(k)}>{l}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select className="sel" value={filterVehicle} onChange={e => setFilterVehicle(e.target.value)}>
                    <option value="ALL">All Vehicles</option>
                    {vehicles.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <select className="sel" value={filterRisk} onChange={e => setFilterRisk(e.target.value)}>
                    <option value="ALL">All Risk</option>
                    <option value="CRITICAL">Critical (&gt;10 min)</option>
                    <option value="VIOLATION">Violation (3-10 min)</option>
                    <option value="WARNING">Warning (2-3 min)</option>
                    <option value="CONFIRM">Confirm Boom</option>
                  </select>
                  <button className="btn btn-ghost btn-sm" onClick={() => csvRef.current?.click()}>+ Import More</button>
                  <span style={{ fontSize: 10, color: '#222', marginLeft: 'auto' }}>{filteredMotive.length} events</span>
                </div>
                <div className="card" style={{ overflowX: 'auto' }}>
                  <table style={{ minWidth: 800 }}>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th><span className="sort-hd" onClick={() => toggleSort('event_date')}>Date {sortField === 'event_date' && (sortDir === 'asc' ? '▲' : '▼')}</span></th>
                        <th><span className="sort-hd" onClick={() => toggleSort('vehicle')}>Vehicle {sortField === 'vehicle' && (sortDir === 'asc' ? '▲' : '▼')}</span></th>
                        <th>Type</th>
                        <th>Location</th>
                        <th><span className="sort-hd" onClick={() => toggleSort('idle_mins')}>Idle {sortField === 'idle_mins' && (sortDir === 'asc' ? '▲' : '▼')}</span></th>
                        <th>Risk</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMotive.map(ev => {
                        const vt = VEHICLE_TYPES[ev.vehicle_type]
                        const rm = RISK_META[ev.risk_level]
                        const isCrane = vt?.exemptIdle
                        return (
                          <tr key={ev.id} className="row" onClick={() => setSelectedM(ev)}>
                            <td style={{ color: '#333', fontSize: 9 }}>{ev.motive_id}</td>
                            <td style={{ color: '#555', fontSize: 10 }}>{ev.start_time}</td>
                            <td><span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15, fontWeight: 800, color: isCrane ? '#a78bfa' : '#ccc' }}>{ev.vehicle}</span></td>
                            <td><span className="vtype-badge" style={{ color: vt?.color }}>{vt?.icon} {vt?.label}</span></td>
                            <td style={{ fontSize: 10, color: '#444', maxWidth: 160 }}>{ev.location}</td>
                            <td><span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 900, color: rm.color }}>{ev.idle_mins.toFixed(1)}<span style={{ fontSize: 9, color: '#333', marginLeft: 2 }}>min</span></span></td>
                            <td>
                              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: rm.color }}>{rm.label}</span>
                              {isCrane && ev.boom_confirmed === 'confirmed' && <div style={{ fontSize: 9, color: '#22c55e' }}>✓ Confirmed</div>}
                              {isCrane && ev.boom_confirmed === 'unreviewed' && ev.idle_mins > 10 && <div style={{ fontSize: 9, color: '#f97316' }} className="confirm-needed">⚑ Review</div>}
                            </td>
                            <td>
                              {isCrane && ev.boom_confirmed === 'unreviewed' && ev.idle_mins > NYC_LIMIT && (
                                <button className="btn btn-purple btn-xs" onClick={e => { e.stopPropagation(); setSelectedM(ev) }}>Review</button>
                              )}
                              {!isCrane && ev.idle_mins > NYC_LIMIT && (
                                <button className="btn btn-ghost btn-xs" onClick={e => {
                                  e.stopPropagation()
                                  setNewV(v => ({ ...v, vehicle: ev.vehicle, location: ev.location, date_issued: ev.event_date, notes: `Motive ${ev.motive_id} — ${ev.idle_mins.toFixed(1)} min @ ${ev.start_time}`, motive_event_id: ev.motive_id }))
                                  setShowForm(true)
                                }}>+ Ticket</button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══ CRANE REVIEW ═══ */}
        {view === 'crane' && (
          <div>
            <div className="crane-banner" style={{ marginBottom: 18 }}>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 13, fontWeight: 800, color: '#a78bfa', letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 6 }}>🏗️ NYC §24-163(b) — Crane / Boom Exemption Workflow</div>
              <div style={{ fontSize: 11, color: '#4a3a6a', lineHeight: 1.9 }}>
                For each extended idle on B-11 or B-12, confirm the boom was operating. Marking confirmed builds your OATH evidence file. Marking not booming flags it as a real violation.
              </div>
            </div>
            {motiveEvents.filter(e => VEHICLE_TYPES[e.vehicle_type]?.exemptIdle && e.idle_mins > NYC_LIMIT).length === 0 ? (
              <div className="card" style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#222', letterSpacing: 2, textTransform: 'uppercase' }}>No crane idle events to review</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {motiveEvents.filter(e => VEHICLE_TYPES[e.vehicle_type]?.exemptIdle && e.idle_mins > NYC_LIMIT).sort((a, b) => b.idle_mins - a.idle_mins).map(ev => (
                  <div key={ev.id} className="card" style={{ padding: 18, borderLeft: `3px solid ${ev.boom_confirmed === 'confirmed' ? '#22c55e' : ev.boom_confirmed === 'not_booming' ? '#ef4444' : '#a78bfa'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                          <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22, fontWeight: 900, color: '#a78bfa' }}>{ev.vehicle}</span>
                          <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 26, fontWeight: 900, color: ev.idle_mins > 30 ? '#ef4444' : '#ccc' }}>{ev.idle_mins.toFixed(1)} min</span>
                          {ev.boom_confirmed === 'unreviewed' && ev.idle_mins > 10 && <span style={{ fontSize: 9, color: '#f97316', letterSpacing: 2, textTransform: 'uppercase' }} className="confirm-needed">⚑ NEEDS REVIEW</span>}
                          {ev.boom_confirmed === 'confirmed' && <span style={{ fontSize: 9, color: '#22c55e', letterSpacing: 2, textTransform: 'uppercase' }}>✓ BOOM CONFIRMED</span>}
                          {ev.boom_confirmed === 'not_booming' && <span style={{ fontSize: 9, color: '#ef4444', letterSpacing: 2, textTransform: 'uppercase' }}>✗ NOT BOOMING</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12 }}>
                          {[['Start Time', ev.start_time], ['Location', ev.location || 'Unknown'], ['Fuel', `${ev.idle_fuel.toFixed(3)} gal`]].map(([k, v]) => (
                            <div key={k}>
                              <div style={{ fontSize: 9, color: '#2e2e2e', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 3 }}>{k}</div>
                              <div style={{ fontSize: 11, color: '#777' }}>{v}</div>
                            </div>
                          ))}
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: '#2e2e2e', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>Job Ticket / Receipt #</div>
                          <input className="inp" style={{ maxWidth: 320 }} placeholder="e.g. JT-2026-0312"
                            value={ev.job_ticket || ''}
                            onChange={e => updateMotive(ev.id!, { job_ticket: e.target.value })} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
                        <button className="btn btn-purple" style={{ fontSize: 11, padding: '8px 16px' }} onClick={() => updateMotive(ev.id!, { boom_confirmed: 'confirmed' })}>✓ Boom Was Operating</button>
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '8px 16px', borderColor: '#ef4444', color: '#ef4444' }} onClick={() => {
                          updateMotive(ev.id!, { boom_confirmed: 'not_booming' })
                          setNewV(v => ({ ...v, vehicle: ev.vehicle, location: ev.location, date_issued: ev.event_date, notes: `Crane NOT booming — Motive ${ev.motive_id} — ${ev.idle_mins.toFixed(1)} min @ ${ev.start_time}`, motive_event_id: ev.motive_id }))
                          setShowForm(true)
                        }}>✗ Not Booming → Log Ticket</button>
                        {ev.boom_confirmed !== 'unreviewed' && (
                          <button className="btn btn-ghost btn-xs" onClick={() => updateMotive(ev.id!, { boom_confirmed: 'unreviewed' })}>Reset</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ OATH TICKETS ═══ */}
        {view === 'violations' && (
          <div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
              <select className="sel" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="ALL">All Statuses</option>
                {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <span style={{ fontSize: 10, color: '#1e1e1e', marginLeft: 'auto' }}>
                {violations.filter(v => filterStatus === 'ALL' || v.status === filterStatus).length} tickets
              </span>
            </div>
            {violations.length === 0 ? (
              <div className="card" style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#222', letterSpacing: 2, textTransform: 'uppercase' }}>No tickets logged</div>
              </div>
            ) : (
              <div className="card" style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 780 }}>
                  <thead><tr>{['Ticket #', 'Date', 'Type', 'Driver', 'Vehicle', 'Location', 'Fine', 'Status'].map(h => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {violations.filter(v => filterStatus === 'ALL' || v.status === filterStatus).map(v => {
                      const type = VIOLATION_TYPES[v.violation_type]
                      const status = STATUS_CFG[v.status]
                      return (
                        <tr key={v.id} className="row" onClick={() => setSelectedV(v)}>
                          <td style={{ color: '#ef4444', fontSize: 10 }}>{v.oath_ticket_number || `#${v.id}`}</td>
                          <td style={{ color: '#444', fontSize: 10 }}>{v.date_issued}</td>
                          <td><span style={{ fontSize: 10, color: type.color }}>{type.label}</span></td>
                          <td style={{ color: '#666' }}>{v.driver || '—'}</td>
                          <td style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 14, fontWeight: 800, color: '#bbb' }}>{v.vehicle || '—'}</td>
                          <td style={{ fontSize: 10, color: '#444', maxWidth: 150 }}>{v.location || '—'}</td>
                          <td style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 800, color: '#e5e5e5' }}>${v.fine_amount}</td>
                          <td><span className="badge" style={{ background: status.bg, color: status.text, borderColor: status.border }}>{status.label}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ═══ FLEET CONFIG ═══ */}
        {view === 'fleet' && (
          <div>
            <div style={{ marginBottom: 14, fontSize: 11, color: '#333', lineHeight: 1.9 }}>
              Vehicle types pre-configured from your Motive data. B-11 and B-12 are flagged as crane-exempt. Edit <code style={{ color: '#a78bfa', background: '#111', padding: '1px 5px', borderRadius: 2 }}>src/lib/config.ts</code> to add new vehicles.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
              {Object.entries(KNOWN_VEHICLES).map(([veh, cfg]) => {
                const vt = VEHICLE_TYPES[cfg.type]
                const events = motiveEvents.filter(e => e.vehicle === veh)
                const violations3 = events.filter(e => !vt.exemptIdle && e.idle_mins > NYC_LIMIT).length
                return (
                  <div key={veh} className="card" style={{ padding: 18, borderLeft: `3px solid ${vt.color}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 22 }}>{vt.icon}</span>
                        <div>
                          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20, fontWeight: 900, color: '#ccc' }}>{veh}</div>
                          <div style={{ fontSize: 10, color: '#333' }}>{cfg.desc}</div>
                        </div>
                      </div>
                      <span className="vtype-badge" style={{ color: vt.color }}>{vt.label}</span>
                    </div>
                    {vt.exemptIdle && <div style={{ background: '#0c0a14', border: '1px solid #2d1d5e', borderRadius: 2, padding: '8px 10px', marginBottom: 10, fontSize: 10, color: '#4a3a6a', lineHeight: 1.7 }}>🛡️ {vt.note}</div>}
                    <div style={{ display: 'flex', gap: 16 }}>
                      {[
                        { label: 'Total events', value: events.length },
                        { label: vt.exemptIdle ? 'Crane reviews' : 'Violations', value: vt.exemptIdle ? events.filter(e => e.boom_confirmed === 'unreviewed' && e.idle_mins > NYC_LIMIT).length : violations3, color: violations3 > 3 ? '#ef4444' : violations3 > 0 ? '#f97316' : '#22c55e' },
                        { label: 'Idle hrs', value: `${(events.reduce((s, e) => s + e.idle_mins, 0) / 60).toFixed(1)}h` },
                      ].map(s => (
                        <div key={s.label}>
                          <div style={{ fontSize: 9, color: '#2a2a2a', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 3 }}>{s.label}</div>
                          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 800, color: s.color || '#666' }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ═══ REDUCTION TIPS ═══ */}
        {view === 'reduce' && (
          <div>
            <div style={{ background: '#0c0a14', border: '1px solid #2d1d5e', borderRadius: 3, padding: '14px 18px', marginBottom: 18 }}>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, fontWeight: 800, color: '#a78bfa', letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 6 }}>🏗️ Crane Exemption — Your Biggest Immediate Win</div>
              <div style={{ fontSize: 11, color: '#3a2a5a', lineHeight: 1.9 }}>B-11 and B-12 long idle events are likely already exempt under NYC §24-163(b). Go to Crane Review, confirm boom operations with job tickets, and use that documentation to dismiss any OATH tickets on those vehicles.</div>
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              {[
                { icon: '🏗️', title: 'Document Crane Operations', impact: 'HIGH', desc: 'Cross-reference every B-11/B-12 idle event against dispatch records and job tickets. Have drivers note "boom operation" in Motive HOS remarks. A signed delivery receipt corroborating crane use wins at OATH under §24-163(b).', savings: 'Eliminate crane tickets' },
                { icon: '📡', title: 'Use Motive as OATH Evidence', impact: 'HIGH', desc: 'Export Trip History + Engine Activity for any ticketed vehicle/date. Engine-off timestamps overlapping the cited window = dismissal. For crane trucks, stationary GPS at a jobsite further supports the exemption.', savings: '~40% dismissal rate' },
                { icon: '🔔', title: 'Set Motive Idle Alerts to 2 Min', impact: 'HIGH', desc: 'Motive → Safety → Alerts → Engine Idle → 2 minutes for all non-crane vehicles. In-cab notification fires before drivers cross the 3-min legal line. Zero cost, 5 minutes to set up.', savings: 'Costs nothing' },
                { icon: '⚖️', title: 'Contest Every Idling Ticket', impact: 'HIGH', desc: 'Never pay without contesting first. OATH dismissal rates with Motive evidence run 20-35%. At $350/ticket the math is obvious.', savings: '$70-120 per ticket' },
                { icon: '📋', title: 'Fix Driver Assignment in Motive', impact: 'MEDIUM', desc: "Your CSV shows all drivers as 'Unidentified.' Go to Motive → Drivers and assign names to vehicles. Without this you can't use HOS logs as OATH evidence.", savings: 'Enables full evidence' },
                { icon: '🔋', title: 'APUs for Standard Trucks', impact: 'MEDIUM', desc: 'Auxiliary Power Units eliminate comfort-idling for A/C and heat. At $3-6k/unit, ROI is under 6 months at your violation rate.', savings: 'ROI in 3-6 months' },
              ].map(tip => (
                <div key={tip.title} className={`tip-card ${tip.impact}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 20 }}>{tip.icon}</span>
                      <div>
                        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15, fontWeight: 800, color: '#e0e0e0', letterSpacing: 1 }}>{tip.title}</div>
                        <div style={{ fontSize: 9, color: tip.impact === 'HIGH' ? '#ef4444' : '#f97316', letterSpacing: 2, textTransform: 'uppercase', marginTop: 2 }}>{tip.impact} IMPACT</div>
                      </div>
                    </div>
                    <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 2, padding: '3px 10px', fontSize: 9, color: '#22c55e', letterSpacing: 1.5, textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0 }}>{tip.savings}</div>
                  </div>
                  <div style={{ fontSize: 11, color: '#444', lineHeight: 1.9, paddingLeft: 32 }}>{tip.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ═══ Motive Detail Modal ═══ */}
      {selectedM && (
        <div className="overlay" onClick={() => setSelectedM(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20, fontWeight: 900, color: VEHICLE_TYPES[selectedM.vehicle_type]?.exemptIdle ? '#a78bfa' : '#ef4444', letterSpacing: 2 }}>{selectedM.motive_id}</div>
                <div style={{ fontSize: 9, color: '#2a2a2a' }}>{VEHICLE_TYPES[selectedM.vehicle_type]?.icon} {VEHICLE_TYPES[selectedM.vehicle_type]?.label}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 36, fontWeight: 900, color: RISK_META[selectedM.risk_level].color }}>{selectedM.idle_mins.toFixed(1)}<span style={{ fontSize: 14, color: '#333' }}> min</span></div>
              </div>
            </div>
            {VEHICLE_TYPES[selectedM.vehicle_type]?.exemptIdle && (
              <div className="crane-banner" style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: '#4a3a6a', lineHeight: 1.8 }}>🏗️ <strong style={{ color: '#a78bfa' }}>Crane/Boom Vehicle</strong> — May be exempt under NYC §24-163(b). Confirm boom operation below.</div>
              </div>
            )}
            {[['Vehicle', selectedM.vehicle], ['Start Time', selectedM.start_time], ['Location', selectedM.location || 'Unknown'], ['Duration', `${selectedM.idle_mins.toFixed(2)} min`], ['Fuel', `${selectedM.idle_fuel.toFixed(3)} gal`]].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #111' }}>
                <span style={{ fontSize: 9, color: '#2e2e2e', letterSpacing: 1.5, textTransform: 'uppercase' }}>{k}</span>
                <span style={{ fontSize: 11, color: '#888' }}>{v}</span>
              </div>
            ))}
            {VEHICLE_TYPES[selectedM.vehicle_type]?.exemptIdle && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 9, color: '#2e2e2e', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>Boom Confirmation</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button className="btn btn-purple" style={{ fontSize: 11, padding: '8px 16px' }} onClick={() => updateMotive(selectedM.id!, { boom_confirmed: 'confirmed' })}>✓ Was Booming</button>
                  <button className="btn btn-ghost" style={{ fontSize: 11, borderColor: '#ef4444', color: '#ef4444' }} onClick={() => updateMotive(selectedM.id!, { boom_confirmed: 'not_booming' })}>✗ Not Booming</button>
                </div>
                <input className="inp" placeholder="Job Ticket / Receipt #…" value={selectedM.job_ticket || ''}
                  onChange={e => updateMotive(selectedM.id!, { job_ticket: e.target.value })} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setSelectedM(null)}>Close</button>
              {!VEHICLE_TYPES[selectedM.vehicle_type]?.exemptIdle && selectedM.idle_mins > NYC_LIMIT && (
                <button className="btn btn-red" onClick={() => {
                  setNewV(v => ({ ...v, vehicle: selectedM.vehicle, location: selectedM.location, date_issued: selectedM.event_date, notes: `Motive ${selectedM.motive_id} — ${selectedM.idle_mins.toFixed(1)} min @ ${selectedM.start_time}`, motive_event_id: selectedM.motive_id }))
                  setSelectedM(null); setShowForm(true)
                }}>+ Log OATH Ticket</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Log Violation Modal ═══ */}
      {showForm && (
        <div className="overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 900, letterSpacing: 2.5, color: '#fff', textTransform: 'uppercase', marginBottom: 20 }}>Log OATH Ticket</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { label: 'OATH Ticket #', key: 'oath_ticket_number', type: 'text', placeholder: 'ECB / OATH number' },
                { label: 'Date Issued', key: 'date_issued', type: 'date' },
                { label: 'Fine ($)', key: 'fine_amount', type: 'number' },
                { label: 'Driver', key: 'driver', type: 'text', placeholder: 'Driver name' },
                { label: 'Vehicle', key: 'vehicle', type: 'text', placeholder: 'e.g. B-11' },
              ].map(f => (
                <div key={f.key}>
                  <div style={{ fontSize: 9, color: '#2a2a2a', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 5 }}>{f.label}</div>
                  <input className="inp" type={f.type} value={(newV as Record<string, unknown>)[f.key] as string || ''} placeholder={f.placeholder}
                    onChange={e => setNewV(v => ({ ...v, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value }))} />
                </div>
              ))}
              <div style={{ gridColumn: '1/-1' }}>
                <div style={{ fontSize: 9, color: '#2a2a2a', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 5 }}>Location</div>
                <input className="inp" value={newV.location || ''} placeholder="Intersection or address"
                  onChange={e => setNewV(v => ({ ...v, location: e.target.value }))} />
              </div>
              {[
                { label: 'Type', key: 'violation_type', opts: Object.entries(VIOLATION_TYPES).map(([k, v]) => ({ value: k, label: v.label })) },
                { label: 'Status', key: 'status', opts: Object.entries(STATUS_CFG).map(([k, v]) => ({ value: k, label: v.label })) },
                { label: 'Borough', key: 'borough', opts: BOROUGHS.map(b => ({ value: b, label: b })) },
              ].map(f => (
                <div key={f.key}>
                  <div style={{ fontSize: 9, color: '#2a2a2a', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 5 }}>{f.label}</div>
                  <select className="sel" style={{ width: '100%' }} value={(newV as Record<string, unknown>)[f.key] as string || ''}
                    onChange={e => setNewV(v => ({ ...v, [f.key]: e.target.value }))}>
                    {f.opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              ))}
              <div style={{ gridColumn: '1/-1' }}>
                <div style={{ fontSize: 9, color: '#2a2a2a', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 5 }}>Notes / Evidence</div>
                <textarea className="inp" rows={3} style={{ resize: 'vertical' }} value={newV.notes || ''}
                  onChange={e => setNewV(v => ({ ...v, notes: e.target.value }))} placeholder="Motive event ID, job ticket, contest strategy…" />
              </div>
              {newV.motive_event_id && (
                <div style={{ gridColumn: '1/-1', background: '#0a110a', border: '1px solid #1a2e1a', borderRadius: 2, padding: '8px 12px', fontSize: 10, color: '#2a5a2a' }}>
                  ✓ Linked to Motive event: <strong style={{ color: '#22c55e' }}>{newV.motive_event_id}</strong>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-red" disabled={saving} onClick={addViolation}>{saving ? 'Saving…' : 'Save Ticket'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Ticket Detail Modal ═══ */}
      {selectedV && (
        <div className="overlay" onClick={() => setSelectedV(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20, fontWeight: 900, color: '#ef4444', letterSpacing: 2 }}>{selectedV.oath_ticket_number || `Ticket #${selectedV.id}`}</div>
                <div style={{ fontSize: 9, color: '#2a2a2a' }}>{selectedV.date_issued} · {selectedV.borough}</div>
              </div>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 32, fontWeight: 900, color: '#fff' }}>${selectedV.fine_amount}</div>
            </div>
            {[
              ['Type', VIOLATION_TYPES[selectedV.violation_type]?.label],
              ['Driver', selectedV.driver || '—'],
              ['Vehicle', selectedV.vehicle || '—'],
              ['Location', selectedV.location || '—'],
              ['Motive Event', selectedV.motive_event_id || 'Not linked'],
              ['Notes', selectedV.notes || '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #111', gap: 20 }}>
                <span style={{ fontSize: 9, color: '#2a2a2a', letterSpacing: 1.5, textTransform: 'uppercase', flexShrink: 0 }}>{k}</span>
                <span style={{ fontSize: 11, color: '#888', textAlign: 'right' }}>{v}</span>
              </div>
            ))}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 9, color: '#2a2a2a', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>Update Status</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Object.entries(STATUS_CFG).map(([key, cfg]) => (
                  <button key={key} onClick={() => updateVStatus(selectedV.id!, key)}
                    style={{ padding: '5px 12px', borderRadius: 2, border: `1px solid ${selectedV.status === key ? cfg.text : '#1a1a1a'}`, background: selectedV.status === key ? cfg.bg : 'transparent', color: selectedV.status === key ? cfg.text : '#333', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: 1, transition: 'all .15s' }}>
                    {cfg.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
