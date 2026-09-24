import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Button, ErrorBox, Field } from '../components';
import type { Organization } from '../types';

function useActionToken() {
  const [token,setToken]=useState<string|null>(null);
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    const url=new URL(window.location.href);
    const value=new URLSearchParams(url.hash.replace(/^#/, '')).get('token')||url.searchParams.get('token');
    if(value){
      setToken(value);
      url.searchParams.delete('token');
      url.hash='';
      window.history.replaceState(window.history.state,'',`${url.pathname}${url.search}`);
    }
    setReady(true);
  },[]);
  return {token,ready};
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [registered, setRegistered] = useState(false);
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === 'register') {
        const result = await api<{verification_required?: boolean;verification_url?: string}>('/auth/register', {method:'POST', body:{email,password,name}});
        setRegistered(true);
        setVerificationUrl(result.verification_url || null);
      } else {
        await api('/auth/login', {method:'POST', body:{email,password}});
        await auth.refresh();
        navigate('/', {replace:true});
      }
    } catch (caught) { setError(caught); }
    finally { setBusy(false); }
  }

  return <div className="auth-page"><div className="auth-brand"><span className="logo-mark" aria-hidden="true">▣</span><span>Кей<br/>Календарь</span></div><main className="auth-card">
    {registered ? <><h1>Проверьте почту</h1><p>На указанный адрес отправлена ссылка для подтверждения. После подтверждения войдите в рабочее пространство.</p>{verificationUrl && <a className="button button-primary" href={verificationUrl}>Подтвердить локально</a>}<p><Link to="/login">Перейти ко входу</Link></p></> : <>
      <h1>{mode === 'register' ? 'Создать аккаунт' : 'Вход'}</h1>
      <p className="muted">{mode === 'register' ? 'После регистрации подтвердите адрес почты.' : 'Введите адрес почты и пароль.'}</p>
      {Boolean(error) && <ErrorBox error={error} />}
      {!error&&auth.error&&<div className="notice notice-warning" role="status">{auth.error}</div>}
      <form onSubmit={submit} className="stack-form">
        {mode === 'register' && <Field label="Имя"><input autoComplete="name" value={name} onChange={event=>setName(event.target.value)} required maxLength={120} /></Field>}
        <Field label="Почта"><input type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} required /></Field>
        <Field label="Пароль"><input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={event=>setPassword(event.target.value)} required minLength={mode === 'register' ? 12 : undefined} /></Field>
        <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Проверяем…' : mode === 'register' ? 'Зарегистрироваться' : 'Войти'}</Button>
      </form>
      <p className="auth-switch">{mode === 'register' ? <>Уже есть аккаунт? <Link to="/login">Войти</Link></> : <>Новый пользователь? <Link to="/register">Зарегистрироваться</Link></>}</p>
      {mode==='login'&&<p><Link to="/recovery">Забыли пароль?</Link></p>}
    </>}
  </main></div>;
}

export function VerifyEmailPage() {
  const [state, setState] = useState<'idle'|'busy'|'done'>('idle');
  const [error, setError] = useState<unknown>(null);
  const {token,ready}=useActionToken();
  async function verify() {
    if (!token) return;
    setState('busy'); setError(null);
    try { await api('/auth/verify-email', {method:'POST', body:{token}}); setState('done'); }
    catch (caught) { setError(caught); setState('idle'); }
  }
  return <div className="auth-page"><main className="auth-card"><h1>Подтверждение почты</h1>{Boolean(error) && <ErrorBox error={error}/>}{state === 'done' ? <p>Адрес подтверждён. <Link to="/login">Войти</Link></p> : !ready ? <p>Проверяем ссылку…</p> : token ? <Button variant="primary" disabled={state === 'busy'} onClick={verify}>{state === 'busy' ? 'Подтверждаем…' : 'Подтвердить адрес'}</Button> : <p>Ссылка неполная. Откройте ссылку из письма ещё раз.</p>}</main></div>;
}

export function OrganizationSetup() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [timezone, setTimezone] = useState('Europe/Moscow');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const org = await api<Organization>('/organizations', {method:'POST',body:{display_name:displayName,timezone,currency:'RUB'}});
      await auth.refresh(); navigate(`/o/${org.id}/SCR-CAL-01`, {replace:true});
    } catch (caught) { setError(caught); }
    finally { setBusy(false); }
  }
  return <div className="auth-page"><main className="auth-card"><h1>Рабочее пространство</h1><p>Организация хранит свои объекты и бронирования отдельно от других.</p>{Boolean(error) && <ErrorBox error={error}/>} {!error&&auth.error&&<ErrorBox error={auth.error}/>}
    <form onSubmit={submit} className="stack-form"><Field label="Название организации"><input value={displayName} onChange={event=>setDisplayName(event.target.value)} required minLength={2}/></Field><Field label="Часовой пояс" hint="Даты проживания считаются по часовому поясу объекта."><select value={timezone} onChange={event=>setTimezone(event.target.value)}><option value="Europe/Moscow">Москва</option><option value="Europe/Volgograd">Волгоград</option><option value="Europe/Kaliningrad">Калининград</option><option value="Asia/Yekaterinburg">Екатеринбург</option><option value="Asia/Novosibirsk">Новосибирск</option><option value="Asia/Vladivostok">Владивосток</option></select></Field><Button variant="primary" type="submit" disabled={busy}>{busy ? 'Создаём…' : 'Создать пространство'}</Button></form>
  </main></div>;
}

export function RecoveryPage({reset=false}:{reset?:boolean}) {
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<unknown>(null);
  const [done,setDone]=useState(false);
  const [recoveryUrl,setRecoveryUrl]=useState<string|null>(null);
  const {token,ready}=useActionToken();
  async function submit(event:FormEvent){
    event.preventDefault();setError(null);setBusy(true);
    try{
      if(reset){if(password!==confirmation)throw new Error('Пароли не совпадают');if(!token)throw new Error('Ссылка неполная');await api('/auth/reset-password',{method:'POST',body:{token,password}});}
      else{const result=await api<{recovery_url?:string}>('/auth/recovery',{method:'POST',body:{email}});setRecoveryUrl(result.recovery_url||null);}
      setDone(true);
    }catch(caught){setError(caught);}finally{setBusy(false);}
  }
  return <div className="auth-page"><div className="auth-brand"><span className="logo-mark" aria-hidden="true">▣</span><span>Кей<br/>Календарь</span></div><main className="auth-card"><h1>{reset?'Новый пароль':'Восстановление доступа'}</h1>
    {Boolean(error)&&<ErrorBox error={error}/>}
    {reset&&!ready?<p>Проверяем ссылку…</p>:reset&&!token?<p>Ссылка неполная. Откройте ссылку из письма ещё раз.</p>:done?<><p>{reset?'Пароль изменён. Войдите с новым паролем.':'Если адрес зарегистрирован, вы получите письмо со ссылкой.'}</p>{recoveryUrl&&<a className="button button-primary" href={recoveryUrl}>Открыть ссылку локально</a>}<p><Link to="/login">Вернуться ко входу</Link></p></>:<form className="stack-form" onSubmit={submit}>{reset?<><Field label="Новый пароль"><input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={event=>setPassword(event.target.value)}/></Field><Field label="Повторите пароль"><input type="password" autoComplete="new-password" minLength={12} required value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></Field></>:<Field label="Почта"><input type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)}/></Field>}<Button variant="primary" type="submit" disabled={busy}>{busy?'Проверяем…':reset?'Сохранить новый пароль':'Отправить ссылку'}</Button><Link to="/login">Вернуться ко входу</Link></form>}
  </main></div>;
}
