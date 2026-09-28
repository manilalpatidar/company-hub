import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

export default function Chat({ me }) {
  const [convos, setConvos] = useState([])
  const [people, setPeople] = useState([])
  const [cur, setCur] = useState(null)
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [panel, setPanel] = useState(null)
  const [gName, setGName] = useState('')
  const [gSel, setGSel] = useState([])
  const end = useRef(null)
  const names = Object.fromEntries(people.map(p => [p.id, p.full_name || p.email]))
  const manager = ['admin', 'hr'].includes(me.role)

  const loadConvos = useCallback(async () => {
    const { data, error } = await supabase.from('conversations')
      .select('id,type,name,created_at,conversation_members(user_id)').order('created_at')
    if (error) { setErr(error.message); return }
    setConvos(data || [])
  }, [])
  useEffect(() => {
    loadConvos()
    supabase.from('profiles').select('id,full_name,email').eq('active', true).then(({ data }) => setPeople(data || []))
  }, [loadConvos])

  const label = c => c.type === 'dm'
    ? names[(c.conversation_members.find(m => m.user_id !== me.id) || {}).user_id] || 'Direct message'
    : c.name
  const sorted = [...convos].sort((a, b) => (a.type === 'announcement' ? -1 : b.type === 'announcement' ? 1 : 0))
  const canPost = cur && (cur.type !== 'announcement' || manager)

  useEffect(() => {
    if (!cur) return
    setMsgs([])
    supabase.from('messages').select('*').eq('conversation_id', cur.id).order('created_at').limit(200)
      .then(({ data }) => setMsgs(data || []))
    const ch = supabase.channel('m-' + cur.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${cur.id}` },
        p => setMsgs(m => (m.some(x => x.id === p.new.id) ? m : [...m, p.new])))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [cur])
  useEffect(() => { end.current?.scrollIntoView() }, [msgs])

  const add = m => setMsgs(list => (list.some(x => x.id === m.id) ? list : [...list, m]))
  async function send(e) {
    e.preventDefault()
    const body = text.trim(); if (!body) return
    setText(''); setErr('')
    const { data, error } = await supabase.from('messages').insert({ conversation_id: cur.id, body }).select().single()
    if (error) setErr(error.message); else add(data)
  }
  async function attach(e) {
    const f = e.target.files[0]; if (!f) return
    setErr('')
    const path = `${cur.id}/${Date.now()}_${f.name.replace(/[^\w.-]/g, '_')}`
    const up = await supabase.storage.from('chat').upload(path, f)
    if (up.error) { setErr(up.error.message); return }
    const { data, error } = await supabase.from('messages').insert({ conversation_id: cur.id, file_path: path, file_name: f.name }).select().single()
    if (error) setErr(error.message); else add(data)
    e.target.value = ''
  }
  async function openFile(m) {
    const { data, error } = await supabase.storage.from('chat').createSignedUrl(m.file_path, 60)
    if (error) setErr(error.message); else window.open(data.signedUrl, '_blank')
  }
  async function startDm(id) {
    const { data, error } = await supabase.rpc('start_dm', { other: id })
    if (error) { setErr(error.message); return }
    await loadConvos(); setPanel(null)
    setCur({ id: data, type: 'dm', conversation_members: [{ user_id: me.id }, { user_id: id }] })
  }
  async function makeGroup() {
    if (!gName.trim() || !gSel.length) { setErr('Enter a group name and pick at least one member.'); return }
    const { data, error } = await supabase.rpc('create_group', { group_name: gName.trim(), member_ids: gSel })
    if (error) { setErr(error.message); return }
    await loadConvos(); setPanel(null); setGName(''); setGSel([])
    setCur({ id: data, type: 'group', name: gName.trim(), conversation_members: [] })
  }
  const others = people.filter(p => p.id !== me.id)

  return (
    <div className={'chat' + (cur || panel ? ' open' : '')}>
      <div className="list">
        {sorted.map(c => (
          <button key={c.id} className={'item' + (cur?.id === c.id ? ' on' : '')} onClick={() => { setPanel(null); setCur(c); setErr('') }}>
            {c.type === 'group' ? '# ' : ''}{label(c)}
          </button>))}
        <button className="item" style={{ color: 'var(--accent)' }} onClick={() => { setPanel('dm'); setCur(null) }}>+ New message</button>
        {manager && <button className="item" style={{ color: 'var(--accent)' }} onClick={() => { setPanel('group'); setCur(null) }}>+ New group</button>}
      </div>
      <div className="thread">
        {panel === 'dm' && <div className="msgs">
          <button className="btn link back" onClick={() => setPanel(null)}>Back</button>
          <h2>New message</h2>
          {others.map(p => <button key={p.id} className="item" onClick={() => startDm(p.id)}>{p.full_name || p.email}</button>)}
        </div>}
        {panel === 'group' && <div className="msgs">
          <button className="btn link back" onClick={() => setPanel(null)}>Back</button>
          <h2>New group</h2>
          <input placeholder="Group name" value={gName} onChange={e => setGName(e.target.value)} />
          {others.map(p => <label key={p.id}><input type="checkbox" style={{ width: 'auto' }} checked={gSel.includes(p.id)}
            onChange={e => setGSel(s => e.target.checked ? [...s, p.id] : s.filter(x => x !== p.id))} /> {p.full_name || p.email}</label>)}
          <button className="btn a" onClick={makeGroup}>Create group</button>
        </div>}
        {!panel && !cur && <p className="center">Select a conversation.</p>}
        {!panel && cur && <>
          <div className="row" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
            <button className="btn link back" onClick={() => setCur(null)}>Back</button><b>{label(cur)}</b>
          </div>
          <div className="msgs">
            {msgs.map(m => (
              <div className="m" key={m.id}>
                <b>{names[m.sender_id] || 'Someone'}</b>
                <span>{new Date(m.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                {m.body && <p>{m.body}</p>}
                {m.file_path && <p><button className="btn link" onClick={() => openFile(m)}>📎 {m.file_name}</button></p>}
              </div>))}
            <div ref={end} />
          </div>
          {canPost
            ? <form className="send" onSubmit={send}>
                <label className="attach">📎<input type="file" hidden onChange={attach} /></label>
                <input placeholder="Write a message" value={text} onChange={e => setText(e.target.value)} />
                <button className="btn a">Send</button>
              </form>
            : <p className="note" style={{ padding: 12 }}>Only admins and HR can post announcements.</p>}
        </>}
        {err && <div className="err" role="alert" style={{ padding: '0 12px 12px' }}>{err}</div>}
      </div>
    </div>
  )
}
