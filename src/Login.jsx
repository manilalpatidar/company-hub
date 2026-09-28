import { useState } from 'react'
import { supabase } from './supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault(); setBusy(true); setMsg('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setMsg('Sign-in failed. Check your email and password.')
    setBusy(false)
  }
  async function reset() {
    if (!email) { setMsg('Enter your email first.'); return }
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    setMsg(error ? error.message : 'Password reset email sent.')
  }
  return (
    <div className="center"><form className="card stack" style={{ width: 340, textAlign: 'left' }} onSubmit={submit}>
      <h2>Company Hub</h2>
      <input type="email" placeholder="Work email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" />
      <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
      <button className="btn a" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <button type="button" className="btn link" onClick={reset}>Forgot password?</button>
      {msg && <div className="err" role="alert">{msg}</div>}
    </form></div>
  )
}
