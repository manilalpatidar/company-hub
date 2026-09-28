import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const ROLES = ['admin', 'hr', 'accountant', 'employee']

export default function People({ me }) {
  const [rows, setRows] = useState([])
  const [err, setErr] = useState('')
  const load = () => supabase.from('profiles').select('*').order('full_name').then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [])
  async function update(id, patch) {
    setErr('')
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) setErr(error.message)
    load()
  }
  return (
    <>
      <h2>People</h2>
      <p className="note">To add an employee: Supabase dashboard, Authentication, Users, Add user. They appear here after that. Then set their role.</p>
      <div className="tw"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th></tr></thead>
        <tbody>{rows.map(p => (
          <tr key={p.id}>
            <td><input defaultValue={p.full_name} onBlur={e => e.target.value !== p.full_name && update(p.id, { full_name: e.target.value })} /></td>
            <td>{p.email}</td>
            <td><select value={p.role} disabled={p.id === me.id} onChange={e => update(p.id, { role: e.target.value })}>{ROLES.map(r => <option key={r}>{r}</option>)}</select></td>
            <td><input type="checkbox" checked={p.active} disabled={p.id === me.id} onChange={e => update(p.id, { active: e.target.checked })} /></td>
          </tr>))}
        </tbody>
      </table></div>
      {err && <div className="err" role="alert">{err}</div>}
    </>
  )
}
