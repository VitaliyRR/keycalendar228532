import { registryEvidence } from './registry-data.js';
import { ConnectorError } from './errors.js';

export type IntegrationId = typeof registryEvidence[number]['id'];
export interface ConnectorCapabilities {
  occupancyImport: boolean; occupancyExport: boolean; reservationImport: boolean;
  reservationCancel: boolean; rateWrite: boolean; restrictionWrite: boolean;
  paymentWrite: boolean; webhook: boolean; recurrenceExpansion: boolean;
}
export interface ConnectorRegistryEntry {
  id: IntegrationId; name: string; category: string; passport: string;
  implementation: 'ical_available' | 'partner_access_pending' | 'discovery_pending' | 'fiscal_profile_pending';
  connectionStatus: 'not_configured'; capabilities: Readonly<ConnectorCapabilities>;
  referenceEvidence: { checkedAt: string; sourceUrl: string; protocol: string; evidence: string; capabilities: readonly (readonly string[])[] };
  productionReady: false;
}
const unavailable: ConnectorCapabilities = Object.freeze({ occupancyImport: false, occupancyExport: false, reservationImport: false, reservationCancel: false, rateWrite: false, restrictionWrite: false, paymentWrite: false, webhook: false, recurrenceExpansion: false });
const ical: ConnectorCapabilities = Object.freeze({ ...unavailable, occupancyImport: true, occupancyExport: true });

/** Reference capabilities belong to RealtyCalendar. Only generic iCal code is implemented here. */
export const CONNECTOR_REGISTRY: readonly ConnectorRegistryEntry[] = Object.freeze(registryEvidence.map(entry => Object.freeze({
  id: entry.id, name: entry.name, category: entry.category,
  passport: `integrations/passports/${entry.id}.md`,
  implementation: entry.id === 'INT-ICAL' || entry.id === 'INT-KVARTIRKA-ICAL' ? 'ical_available'
    : entry.category === 'fiscal_via_moneta' ? 'fiscal_profile_pending'
    : entry.keycalendar_status === 'discovery_pending' ? 'discovery_pending' : 'partner_access_pending',
  connectionStatus: 'not_configured', capabilities: entry.id === 'INT-ICAL' || entry.id === 'INT-KVARTIRKA-ICAL' ? ical : unavailable,
  referenceEvidence: { checkedAt: entry.checked_at, sourceUrl: entry.source, protocol: entry.protocol, evidence: entry.evidence, capabilities: entry.capabilities_rc ?? [] },
  productionReady: false,
} satisfies ConnectorRegistryEntry)));

export function getConnector(id: string): ConnectorRegistryEntry | undefined { return CONNECTOR_REGISTRY.find(entry => entry.id === id); }
export function requireConnectorCapability(id: string, capability: keyof ConnectorCapabilities): ConnectorRegistryEntry {
  const connector = getConnector(id);
  if (!connector) throw new ConnectorError('UNKNOWN_CONNECTOR');
  if (!connector.capabilities[capability]) throw new ConnectorError(connector.implementation === 'ical_available' ? 'CAPABILITY_UNSUPPORTED' : 'PARTNER_ACCESS_PENDING');
  return connector;
}
