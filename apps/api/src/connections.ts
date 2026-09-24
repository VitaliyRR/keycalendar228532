import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { CONNECTOR_REGISTRY, ConnectorError, getConnector, validateFeedUrl } from '@keycalendar/connectors';
import type { Config } from './config.js';
import { one } from './db.js';
import { problem } from './problem.js';
import { assertProperty, audit, idempotent, inOrganization, type TenantContext } from './tenant.js';

const id = z.uuid();
const orgParams = z.object({ orgId: id });
const connectionParams = orgParams.extend({ connectionId: id });
const icalBody = z.object({
  service_code: z.enum(['INT-ICAL', 'INT-KVARTIRKA-ICAL']).default('INT-ICAL'),
  display_name: z.string().trim().min(1).max(120), unit_id: id,
  feed_url: z.string().min(1).max(4096),
  poll_interval_seconds: z.number().int().min(300).max(86_400).default(900),
}).strict();
const partnerBody = z.object({ service_code: z.string().min(1).max(80), display_name: z.string().trim().min(1).max(120), unit_id: id.optional() }).strict();

function encryptionKey(config: Pick<Config, 'CONNECTION_SECRET_KEY'>): Buffer {
  if (!config.CONNECTION_SECRET_KEY || !/^[a-fA-F0-9]{64}$/.test(config.CONNECTION_SECRET_KEY)) throw new ConnectorError('CONNECTION_SECRET_CONFIGURATION');
  return Buffer.from(config.CONNECTION_SECRET_KEY, 'hex');
}
function aad(organizationId: string, connectionId: string): Buffer { return Buffer.from(JSON.stringify(['keycalendar-feed-v1', organizationId, connectionId])); }
/** Ciphertext may be persisted; neither this envelope nor plaintext belongs in response DTOs/audit/logs. */
export function encryptConnectionFeed(feedUrl: string, config: Pick<Config, 'CONNECTION_SECRET_KEY'>, organizationId: string, connectionId: string): string {
  const canonical = validateFeedUrl(feedUrl).href;
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(config), nonce);
  cipher.setAAD(aad(organizationId, connectionId));
  const encrypted = Buffer.concat([cipher.update(canonical, 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
export function decryptConnectionFeed(envelope: string, config: Pick<Config, 'CONNECTION_SECRET_KEY'>, organizationId: string, connectionId: string): string {
  const key = encryptionKey(config);
  try {
    const parts = envelope.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1' || !parts.slice(1).every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const nonce = Buffer.from(parts[1]!, 'base64url'), tag = Buffer.from(parts[2]!, 'base64url');
    if (nonce.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad(organizationId, connectionId)); decipher.setAuthTag(tag);
    return validateFeedUrl(Buffer.concat([decipher.update(Buffer.from(parts[3]!, 'base64url')), decipher.final()]).toString('utf8')).href;
  } catch { throw new ConnectorError('CONNECTION_SECRET_UNREADABLE'); }
}

const safeSelect = `c.id,c.service_code,c.mechanism,c.display_name,c.status,c.capability_version,
  (c.secret_ciphertext IS NOT NULL) AS has_secret,c.poll_interval_seconds,c.last_attempt_at,
  c.last_success_at,c.next_poll_at,c.last_error_code,c.version,c.created_at`;
// For a scoped manager every mapped property must be accessible; no partial multi-property connection leaks.
const visibleConnection = `($2::uuid[] IS NULL OR (
  EXISTS(SELECT 1 FROM connection_mappings cm JOIN units u ON u.organization_id=cm.organization_id AND u.id=cm.unit_id WHERE cm.organization_id=c.organization_id AND cm.connection_id=c.id AND u.property_id=ANY($2))
  AND NOT EXISTS(SELECT 1 FROM connection_mappings cm JOIN units u ON u.organization_id=cm.organization_id AND u.id=cm.unit_id WHERE cm.organization_id=c.organization_id AND cm.connection_id=c.id AND NOT(u.property_id=ANY($2)))
))`;
function enrich(row: Record<string, unknown>): Record<string, unknown> {
  const registry = getConnector(String(row.service_code));
  return { ...row, provider_name: registry?.name ?? row.service_code, implementation: registry?.implementation ?? 'discovery_pending',
    capabilities: registry?.capabilities ?? null, publication_is_not_delivery: row.mechanism === 'ical',
    status_message: row.status === 'access_required' ? 'Нужны допуск поставщика и спецификация API'
      : row.status === 'verification_pending' ? 'Настройки сохранены. Полное чтение календаря ещё не выполнено'
      : row.status === 'healthy' ? 'Последнее чтение календаря завершено; актуальность определяется временем обновления'
      : row.status === 'conflict' ? 'Обнаружен конфликт. Существующая занятость сохранена' : 'Требуется проверка состояния соединения',
  };
}
async function details(context: TenantContext, connectionId: string): Promise<Record<string, unknown>> {
  const row = await one(context.tx, `SELECT ${safeSelect} FROM connections c WHERE c.organization_id=$1 AND ${visibleConnection} AND c.id=$3`, [context.organizationId, context.propertyIds, connectionId]);
  if (!row) problem(404, 'RESOURCE_NOT_FOUND', 'Соединение недоступно или удалено');
  const mappings = (await context.tx.query(`SELECT cm.id,cm.unit_id,u.property_id,u.name AS unit_name,p.name AS property_name,p.timezone
    FROM connection_mappings cm JOIN units u ON u.organization_id=cm.organization_id AND u.id=cm.unit_id
    JOIN properties p ON p.organization_id=u.organization_id AND p.id=u.property_id
    WHERE cm.organization_id=$1 AND cm.connection_id=$2 ORDER BY cm.id`, [context.organizationId, connectionId])).rows;
  return { ...enrich(row), mappings };
}
async function mappedUnit(context: TenantContext, unitId: string): Promise<void> {
  const unit = await one<{ property_id: string }>(context.tx, `SELECT u.property_id FROM units u JOIN properties p ON p.organization_id=u.organization_id AND p.id=u.property_id
    WHERE u.organization_id=$1 AND u.id=$2 AND u.state='active' AND p.archived_at IS NULL FOR SHARE OF u`, [context.organizationId, unitId]);
  if (!unit) problem(404, 'UNIT_UNAVAILABLE', 'Номер недоступен');
  assertProperty(context, unit.property_id);
}
async function createIcal(req: FastifyRequest, pool: pg.Pool, config: Config) {
  const { orgId } = orgParams.parse(req.params), input = icalBody.parse(req.body);
  return inOrganization(req, pool, config, orgId, 'integration.manage', context => idempotent(context, req, 'connection.ical.create', async () => {
    await mappedUnit(context, input.unit_id);
    const connectionId = randomUUID(); let encrypted: string;
    try { encrypted = encryptConnectionFeed(input.feed_url, config, orgId, connectionId); }
    catch (error) {
      if (error instanceof ConnectorError && error.code === 'CONNECTION_SECRET_CONFIGURATION') problem(503, error.code, 'Хранилище секретов подключения не настроено');
      problem(422, 'INVALID_FEED_URL', 'Нужна допустимая HTTPS-ссылка календаря');
    }
    // No DNS or HTTP at creation. Verification happens only in the separately invoked worker.
    await context.tx.query(`INSERT INTO connections(id,organization_id,service_code,mechanism,display_name,status,capability_version,secret_ciphertext,created_by,poll_interval_seconds,next_poll_at)
      VALUES($1,$2,$3,'ical',$4,'verification_pending','ical-occupancy-v1',$5,$6,$7,now())`,
      [connectionId, orgId, input.service_code, input.display_name, encrypted, context.actor.id, input.poll_interval_seconds]);
    await context.tx.query('INSERT INTO connection_mappings(organization_id,connection_id,unit_id,external_id) VALUES($1,$2,$3,$4)', [orgId, connectionId, input.unit_id, connectionId]);
    await audit(context, 'connection.ical_configured', 'connection', connectionId, undefined, { service_code: input.service_code, unit_id: input.unit_id, has_secret: true, status: 'verification_pending' });
    return details(context, connectionId);
  }), { write: true, scope: true });
}

export async function registerConnections(app: FastifyInstance, pool: pg.Pool, config: Config): Promise<void> {
  const base = '/api/v1/organizations/:orgId';
  app.get(base + '/connections/capabilities', async req => {
    const { orgId } = orgParams.parse(req.params);
    return inOrganization(req, pool, config, orgId, 'integration.read', async () => ({ items: CONNECTOR_REGISTRY, evidence_checked_at: '2026-09-24' }));
  });
  const list = async (req: FastifyRequest, icalOnly = false) => {
    const { orgId } = orgParams.parse(req.params);
    return inOrganization(req, pool, config, orgId, 'integration.read', async context => {
      const rows = (await context.tx.query(`SELECT ${safeSelect} FROM connections c WHERE c.organization_id=$1 AND ${visibleConnection}
        AND ($3::boolean=false OR c.mechanism='ical') ORDER BY c.created_at DESC,c.id LIMIT 200`, [orgId, context.propertyIds, icalOnly])).rows;
      return { items: rows.map(enrich) };
    }, { scope: true });
  };
  app.get(base + '/connections', req => list(req));
  app.get(base + '/connections/ical', req => list(req, true));
  app.get(base + '/connections/:connectionId', async req => {
    const { orgId, connectionId } = connectionParams.parse(req.params);
    return inOrganization(req, pool, config, orgId, 'integration.read', context => details(context, connectionId), { scope: true });
  });
  app.post(base + '/connections/ical', req => createIcal(req, pool, config));
  app.post(base + '/connections', async req => {
    const raw = req.body as Record<string, unknown> | null;
    if (raw?.service_code === 'INT-ICAL' || raw?.service_code === 'INT-KVARTIRKA-ICAL') return createIcal(req, pool, config);
    const { orgId } = orgParams.parse(req.params), input = partnerBody.parse(req.body);
    const registry = getConnector(input.service_code);
    if (!registry) problem(422, 'UNKNOWN_CONNECTOR', 'Неизвестный поставщик');
    return inOrganization(req, pool, config, orgId, 'integration.manage', context => idempotent(context, req, 'connection.partner.request', async () => {
      if (input.unit_id) await mappedUnit(context, input.unit_id);
      else if (context.propertyIds !== null) problem(422, 'UNIT_REQUIRED', 'Выберите доступный номер');
      const connectionId = randomUUID();
      await context.tx.query(`INSERT INTO connections(id,organization_id,service_code,mechanism,display_name,status,created_by)
        VALUES($1,$2,$3,'partner_pending',$4,'access_required',$5)`, [connectionId, orgId, input.service_code, input.display_name, context.actor.id]);
      if (input.unit_id) await context.tx.query('INSERT INTO connection_mappings(organization_id,connection_id,unit_id,external_id) VALUES($1,$2,$3,$4)', [orgId, connectionId, input.unit_id, connectionId]);
      await audit(context, 'connection.access_requested', 'connection', connectionId, undefined, { service_code: input.service_code, status: 'access_required' });
      return details(context, connectionId);
    }), { write: true, scope: true });
  });
  app.get(base + '/sync-conflicts', async req => {
    const { orgId } = orgParams.parse(req.params);
    const query = z.object({ connection_id: id.optional(), state: z.enum(['open', 'resolved', 'all']).default('open') }).parse(req.query);
    return inOrganization(req, pool, config, orgId, 'integration.read', async context => ({ items: (await context.tx.query(`SELECT f.id,f.connection_id,f.reservation_id,f.kind,f.safe_summary,f.state,f.created_at,f.resolved_at
      FROM sync_conflicts f LEFT JOIN connections c ON c.organization_id=f.organization_id AND c.id=f.connection_id
      WHERE f.organization_id=$1 AND ${visibleConnection} AND ($3::uuid IS NULL OR f.connection_id=$3)
      AND ($4='all' OR f.state=$4) ORDER BY f.created_at DESC,f.id LIMIT 200`, [orgId, context.propertyIds, query.connection_id ?? null, query.state])).rows }), { scope: true });
  });
}
