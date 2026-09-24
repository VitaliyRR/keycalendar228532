import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api } from './api';
import { stateLabels, statusClass } from './format';

export function Button({ children, variant = 'secondary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'quiet' }) {
  return <button {...props} className={`button button-${variant} ${className}`}>{children}</button>;
}
export function Badge({ children, state }: { children: ReactNode; state?: string }) { return <span className={`badge badge-${statusClass(state)}`}>{typeof children==='string'&&children===state?stateLabels[children]||children:children}</span>; }
export function Panel({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{title && <div className="panel-heading"><h2>{title}</h2>{actions}</div>}{children}</section>;
}
export function Field({ label, hint, error, children, className = '' }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className}`}><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}{Boolean(error) && <span className="field-error">{error}</span>}</label>;
}
export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const apiError = error instanceof ApiError ? error : null;
  const title = apiError?.status === 403 ? 'Нет доступа к этому действию' : apiError?.status === 412 ? 'Запись изменилась' : apiError?.status === 409 ? 'Данные конфликтуют' : apiError?.status === 401 ? 'Сессия завершилась' : apiError?.code === 'NETWORK_ERROR' ? 'Нет соединения' : 'Не удалось выполнить запрос';
  return <div className="notice notice-error" role="alert"><strong>{title}</strong><p>{apiError?.detail || apiError?.message || (error instanceof Error ? error.message : 'Попробуйте позже.')}</p>
    {apiError?.fieldErrors?.length ? <ul>{apiError.fieldErrors.map(item => <li key={`${item.path}-${item.code}`}>{item.message}</li>)}</ul> : null}
    {apiError?.conflicts?.length ? <p>Проверьте даты и объект, затем повторите расчёт.</p> : null}
    {apiError?.correlationId ? <small>Код обращения: {apiError.correlationId}</small> : null}
    {retry && <Button type="button" onClick={retry}>Обновить данные</Button>}
  </div>;
}
export function Empty({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return <div className="empty"><strong>{title}</strong>{detail && <p>{detail}</p>}{action}</div>;
}
export function Loading({ label = 'Загружаем данные…' }: { label?: string }) { return <div className="loading" role="status">{label}</div>; }
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="page-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>;
}
export function ConfirmDialog({ title, description, onCancel, onConfirm, busy, confirmLabel = 'Подтвердить', danger = false }: {title: string;description: ReactNode;onCancel: () => void;onConfirm: () => void;busy?: boolean;confirmLabel?: string;danger?: boolean}) {
  useEffect(() => { const fn = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); }; window.addEventListener('keydown', fn); return () => window.removeEventListener('keydown', fn); }, [onCancel]);
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}><section className="dialog" role="dialog" aria-modal="true" aria-label={title}><h2>{title}</h2><div>{description}</div><div className="dialog-actions"><Button onClick={onCancel} disabled={busy}>Вернуться</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>{busy ? 'Сохраняем…' : confirmLabel}</Button></div></section></div>;
}

export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!path) { setData(null); setLoading(false); setError(null); return; }
    const controller = new AbortController();
    setData(null);
    setLoading(true);
    setError(null);
    api<T>(path, {signal: controller.signal}).then(result => { if (!controller.signal.aborted) setData(result); }).catch(caught => {
      if (!controller.signal.aborted) setError(caught);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision]);
  return { data, loading, error, reload, setData };
}
