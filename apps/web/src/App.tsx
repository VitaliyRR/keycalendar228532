import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { orgPath } from './api';
import { Button, Empty, Loading, useResource } from './components';
import { groupScreens, primaryScreens, screenMap, screenPath } from './screens';
import { MigrationPage, OrganizationPage, StaffPage, SubscriptionPage } from './pages/AdminPage';
import { ImportPreviewPage } from './pages/ImportPreviewPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { AuthPage, OrganizationSetup, RecoveryPage, VerifyEmailPage } from './pages/AuthPage';
import { CalendarPage } from './pages/CalendarPage';
import { BlockPage } from './pages/BlockPage';
import { ReservationCreate, ReservationDetail, ReservationList } from './pages/ReservationPage';
import { GenericResourcePage, GuestPage, PropertyPage, TaskPage } from './pages/ResourcePage';
import { FinancePage, RatePage, ReportPage } from './pages/WorkflowPage';

function Home() {
  const auth=useAuth();
  if(auth.loading)return <div className="page-centered"><Loading label="Проверяем сессию…"/></div>;
  if(!auth.session)return <Navigate to="/login" replace/>;
  if(!auth.organizations.length)return <Navigate to="/setup" replace/>;
  const first=auth.organizations[0];
  const membership=auth.session.memberships?.find(item=>item.organization_id===first.id);
  const start=membership?.role==='housekeeper'?'SCR-OPS-02':membership?.role==='accountant'?'SCR-FIN-01':'SCR-CAL-01';
  return <Navigate to={screenPath(first.id,start)} replace/>;
}

function ProtectedSetup() { const auth=useAuth();if(auth.loading)return <Loading/>;if(!auth.session)return <Navigate to="/login" replace/>;return <OrganizationSetup/>; }

function ImportPreviewRedirect() {
  const auth=useAuth();
  if(auth.loading)return <Loading/>;
  if(!auth.session)return <Navigate to="/login" replace/>;
  const organization=auth.organizations.find(item=>{
    const role=auth.session?.memberships?.find(member=>member.organization_id===item.id)?.role||item.role;
    return role==='owner'||role==='admin';
  });
  return <Navigate to={organization?screenPath(organization.id,'SCR-MIG-02'):'/'} replace/>;
}

function SourcePreviewRibbon({orgId}:{orgId:string}) {
  const preview=useResource<{coverage:{propertyCount:number;reservationCount:number}}>(orgPath(orgId,'import-preview'));
  if(!preview.data)return null;
  return <div className="notice notice-warning" role="status">
    <strong>Данные RealtyCalendar:</strong> {preview.data.coverage.propertyCount} объектов, {preview.data.coverage.reservationCount} броней.{' '}
    <Link to="/import-preview">Смотреть данные</Link>. Только чтение.
  </div>;
}

function WorkspaceRoute() {
  const auth=useAuth();const navigate=useNavigate();const {orgId='',screenId='SCR-CAL-01',entityId}=useParams();
  const [menuOpen,setMenuOpen]=useState(false);const [search,setSearch]=useState('');const searchRef=useRef<HTMLInputElement>(null);
  const [shellError,setShellError]=useState('');
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();searchRef.current?.focus();}if(event.key==='Escape')setMenuOpen(false);};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);
  useEffect(()=>{setMenuOpen(false);setSearch('');},[orgId,screenId]);
  if(auth.loading)return <div className="page-centered"><Loading/></div>;
  if(!auth.session)return <Navigate to="/login" replace/>;
  const organization=auth.organizations.find(item=>item.id===orgId);
  if(!organization)return <div className="page-centered"><Empty title="Организация недоступна" detail="Проверьте доступ или выберите другую организацию." action={<Link className="button button-primary" to="/">К моим организациям</Link>}/></div>;
  const screen=screenMap.get(screenId);
  if(!screen)return <div className="page-centered"><Empty title="Раздел не найден" action={<Link className="button button-primary" to={screenPath(orgId,'SCR-CAL-01')}>Открыть календарь</Link>}/></div>;
  const membership=auth.session.memberships?.find(item=>item.organization_id===orgId);
  const role=membership?.role||organization.role||'viewer';
  const permissions=membership?.permissions||[];
  const readOnly=organization.lifecycle==='read_only'||organization.subscription_state==='read_only';
  const canBook=!readOnly&&(role==='owner'||role==='admin'||role==='manager'||permissions.includes('booking.write'));
  const canFinance=!readOnly&&(role==='owner'||role==='admin'||role==='accountant'||permissions.includes('finance.write'));
  const canManage=!readOnly&&(role==='owner'||role==='admin'||permissions.includes('inventory.write'));
  const canTasks=!readOnly&&(role==='owner'||role==='admin'||role==='manager'||role==='housekeeper'||permissions.includes('operations.manage'));
  const canPreview=role==='owner'||role==='admin';
  const detailScreens=new Set(['SCR-RES-03','SCR-RES-04','SCR-RES-05','SCR-OBJ-02','SCR-GST-02','SCR-OPS-03']);
  const localScreens=groupScreens(screen.group).filter(item=>(Boolean(entityId)||!detailScreens.has(item.id))&&(item.id!=='SCR-MIG-02'||canPreview));
  function changeOrganization(nextId:string){if(nextId!==orgId){navigate(screenPath(nextId,'SCR-CAL-01'));}}
  function submitSearch(event:React.FormEvent){event.preventDefault();navigate(`${screenPath(orgId,'SCR-RES-01')}?q=${encodeURIComponent(search)}`);}

  return <div className="app-shell" key={orgId}>
    <a className="skip-link" href="#main-content">К содержимому</a>
    <aside className={`sidebar ${menuOpen?'open':''}`} aria-label="Главное меню">
      <Link className="brand" to={screenPath(orgId,'SCR-CAL-01')}><span className="logo-mark" aria-hidden="true">▣</span><span>Кей<br/>Календарь</span></Link>
      <nav>{canPreview&&<Link className={`nav-item ${screen.id==='SCR-MIG-02'?'active':''}`} to="/import-preview">Данные RealtyCalendar</Link>}{primaryScreens.map(({group,id})=><Link key={group} className={`nav-item ${screen.group===group&&screen.id!=='SCR-MIG-02'?'active':''}`} to={screenPath(orgId,id)}>{group}</Link>)}</nav>
      <div className="sidebar-footer"><span>{auth.session.user?.display_name||auth.session.user?.name||auth.session.user?.email||auth.session.email||'Пользователь'}</span><small>{role}</small><Button variant="quiet" onClick={()=>void auth.logout().then(()=>navigate('/login')).catch(error=>setShellError(error instanceof Error?error.message:'Не удалось выйти'))}>Выйти</Button></div>
    </aside>
    {menuOpen&&<button className="mobile-scrim" aria-label="Закрыть меню" onClick={()=>setMenuOpen(false)}/>}
    <div className="main-column"><header className="topbar"><button className="menu-toggle" onClick={()=>setMenuOpen(value=>!value)} aria-label={menuOpen?'Закрыть меню':'Открыть меню'} aria-expanded={menuOpen}>☰</button><label className="org-select"><span className="sr-only">Организация</span><select value={orgId} onChange={event=>changeOrganization(event.target.value)}>{auth.organizations.map(item=><option key={item.id} value={item.id}>{item.display_name||item.name||'Организация'}</option>)}</select></label><form className="global-search" onSubmit={submitSearch}><input ref={searchRef} type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Поиск Ctrl K" aria-label="Поиск бронирования"/></form><span className="topbar-user" aria-label={`Роль: ${role}`}>{role.slice(0,2).toUpperCase()}</span></header>
      <main id="main-content" className="content"><div className="section-tabs" aria-label="Разделы: экраны">{localScreens.map(item=><Link key={item.id} className={item.id===screen.id?'current':''} to={screenPath(orgId,item.id,entityId&&detailScreens.has(item.id)?entityId:undefined)}>{item.title}</Link>)}</div>{canPreview&&screen.id!=='SCR-MIG-02'&&<SourcePreviewRibbon orgId={orgId}/>}{shellError&&<div className="notice notice-error" role="alert">{shellError}</div>}{readOnly&&<div className="notice notice-warning">Подписка ограничивает изменения. Доступны разрешённые данные и экспорт.</div>}
        {screen.id==='SCR-CAL-01'||screen.id==='SCR-CAL-02'?<CalendarPage orgId={orgId} filtersOnly={screen.id==='SCR-CAL-02'} canPreview={canPreview}/>:
         screen.id==='SCR-CAL-03'?<BlockPage orgId={orgId} canWrite={canBook}/>:
         screen.id==='SCR-RES-01'||screen.id==='SCR-RES-06'?<ReservationList orgId={orgId} mode={screen.id==='SCR-RES-06'?'arrivals':'all'} canWrite={canBook}/>:
         screen.id==='SCR-RES-02'?<ReservationCreate orgId={orgId} canWrite={canBook}/>:
         ['SCR-RES-03','SCR-RES-04'].includes(screen.id)&&entityId?<ReservationDetail orgId={orgId} reservationId={entityId} canWrite={canBook}/>:
         screen.id==='SCR-OBJ-01'||screen.id==='SCR-OBJ-02'?<PropertyPage orgId={orgId} detailId={entityId} canWrite={canManage}/>:
         screen.id==='SCR-GST-01'||screen.id==='SCR-GST-02'?<GuestPage orgId={orgId} detailId={entityId} canWrite={canBook}/>:
         screen.id==='SCR-OPS-02'||screen.id==='SCR-OPS-03'?<TaskPage orgId={orgId} detailId={entityId} canWrite={canTasks} canCreate={canTasks&&role!=='housekeeper'} role={role}/>:
         screen.id==='SCR-RTE-01'||screen.id==='SCR-RTE-04'?<RatePage orgId={orgId} canWrite={canManage}/>:
         screen.id==='SCR-FIN-01'||screen.id==='SCR-FIN-02'?<FinancePage orgId={orgId} manual={screen.id==='SCR-FIN-02'} canWrite={canFinance}/>:
         screen.id.startsWith('SCR-REP-')?<ReportPage orgId={orgId} reportType={screen.id==='SCR-REP-02'?'sources':screen.id==='SCR-REP-03'?'module':'finance'}/>:
         screen.id==='SCR-INT-01'||screen.id==='SCR-INT-02'?<ConnectionsPage orgId={orgId} mapping={screen.id==='SCR-INT-02'} canManage={!readOnly&&(role==='owner'||role==='admin'||permissions.includes('integration.manage'))}/>:
         screen.id==='SCR-MIG-02'?(canPreview?<ImportPreviewPage orgId={orgId}/>:<Empty title="Нет доступа к данным RealtyCalendar" detail="Данные переноса доступны владельцу и администратору организации."/>):
         screen.id.startsWith('SCR-MIG-')?<MigrationPage orgId={orgId} canPreview={canPreview}/>:
         screen.id.startsWith('SCR-BILL-')?<SubscriptionPage orgId={orgId}/>:
         screen.id==='SCR-ORG-01'||screen.id==='SCR-ORG-02'?<OrganizationPage orgId={orgId}/>:
         screen.id==='SCR-IAM-03'?<StaffPage orgId={orgId}/>:
         <GenericResourcePage orgId={orgId} screen={screen} entityId={entityId}/>}
      </main></div>
  </div>;
}

function RoutesWithAuth() {
  const auth=useAuth();
  return <Routes><Route path="/" element={<Home/>}/><Route path="/import-preview" element={<ImportPreviewRedirect/>}/><Route path="/login" element={auth.session?<Navigate to="/" replace/>:<AuthPage mode="login"/>}/><Route path="/register" element={<AuthPage mode="register"/>}/><Route path="/verify-email" element={<VerifyEmailPage/>}/><Route path="/recovery" element={<RecoveryPage/>}/><Route path="/reset-password" element={<RecoveryPage reset/>}/><Route path="/setup" element={<ProtectedSetup/>}/><Route path="/o/:orgId/:screenId" element={<WorkspaceRoute/>}/><Route path="/o/:orgId/:screenId/:entityId" element={<WorkspaceRoute/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes>;
}
export default function App(){return <BrowserRouter><AuthProvider><RoutesWithAuth/></AuthProvider></BrowserRouter>;}
