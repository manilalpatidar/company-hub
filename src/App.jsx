import { useEffect, useState } from 'react'
import { supabase, configured } from './supabase'
import Login from './Login.jsx'
import Chat from './Chat.jsx'
import People from './People.jsx'

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [page, setPage] = useState('chat')

  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', session.user.id).single().then(({ data }) => setProfile(data))
  }, [session])

  if (!configured) return <p className="center">Missing Supabase settings. Copy .env.example to .env and fill it in.</p>
  if (session === undefined) return <p className="center">Loading…</p>
  if (!session) return <Login />
  if (!profile) return <p className="center">Loading…</p>
  if (!profile.active) return (
    <div className="center"><div>
      <p>Your account is deactivated. Contact your administrator.</p>
      <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div></div>
  )

  const isAdmin = profile.role === 'admin'
  return (
    <div className="app">
      <header>
        <b>Company Hub</b>
        <button className={page === 'chat' ? 'on' : ''} onClick={() => setPage('chat')}>Messages</button>
        {isAdmin && <button className={page === 'people' ? 'on' : ''} onClick={() => setPage('people')}>People</button>}
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <main>{page === 'people' && isAdmin ? <People me={profile} /> : <Chat me={profile} />}</main>
    </div>
  )
}
