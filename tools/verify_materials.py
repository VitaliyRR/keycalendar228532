"""Static handoff audit. No network, imports of project code, or application execution.

Run: python tools/verify_materials.py
Only --write-report writes plan/validation-report.json. The report contains locations
and rule names, never matched secret values. Standard library only.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
from pathlib import Path
import re
import struct
import sys
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

IGNORED = {'.git', '.artifact-tools', 'node_modules', '__pycache__', '.pytest_cache'}
REQUIRED = [
    'README.md', 'AGENTS.md', 'research/reference-study.md',
    'research/reference-evidence.json', 'research/account-observations.md',
    'requirements/reference.json', 'requirements/saas.json',
    'requirements/traceability.csv', 'requirements/parity.csv',
    'architecture/README.md', 'architecture/openapi.json',
    'integrations/README.md', 'integrations/catalog.json',
    'integrations/catalog.csv', 'integrations/capability-matrix.csv',
    'design/README.md', 'design/screens.json', 'design/screen-specs.json',
    'design/specification.md', 'design/copy.json', 'design/tokens.json',
    'assets/README.md', 'assets/manifest.csv', 'assets/fonts/OFL.txt',
    'data/migration-spec.md', 'plan/backlog.json', 'plan/test-cases.json',
    'plan/release-plan.md', 'research/legal/compliance.md',
]
REPORT = 'plan/validation-report.json'
TEXT_EXT = {'.md', '.json', '.csv', '.svg', '.py', '.mjs', '.js', '.txt', '.yaml', '.yml', '.toml', '.ini', '.env'}
APP_DIRS = {'app', 'src', 'pages', 'worker', 'server', 'backend', 'frontend', 'functions', 'api'}
APP_FILES = {'package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'Dockerfile', 'docker-compose.yml', 'wrangler.toml', 'vite.config.ts', 'next.config.ts'}
SECRET_RULES = [
    ('private_key', re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----')),
    ('jwt_literal', re.compile(r'\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b')),
    ('provider_token_literal', re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})\b')),
    ('credential_assignment', re.compile(r'''(?i)(?:password|passwd|pwd|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|пароль)["']?\s*[:=]\s*["']([^"'\r\n]{8,})["']''')),
    ('email_credential_pair', re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\s+([^\s<>]{8,})')),
    ('url_credentials', re.compile(r'https?://[^/\s:@]+:[^/\s@]{6,}@')),
    ('secret_url_parameter', re.compile(r'(?i)[?&](?:token|access_token|api_key|secret)=([A-Za-z0-9_%-]{20,})')),
]


def without_duplicate_keys(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError('duplicate JSON key')
        out[key] = value
    return out


class Audit:
    def __init__(self, root, report_will_be_written=False):
        self.root = root.resolve()
        self.report_will_be_written = report_will_be_written
        self.issues = []
        self.counts = {}
        self.json = {}
        self.csv = {}
        self.text = {}
        self.svg = {}
        self.png = {}

    def rel(self, path):
        try:
            return path.resolve().relative_to(self.root).as_posix()
        except ValueError:
            return '[outside repository]'

    def issue(self, level, code, path, detail, line=None):
        item = dict(level=level, code=code, path=path if isinstance(path, str) else self.rel(path), detail=detail)
        if line is not None:
            item['line'] = line
        self.issues.append(item)

    def files(self):
        result = []
        for base, dirs, files in os.walk(self.root, followlinks=False):
            dirs[:] = [d for d in dirs if d not in IGNORED and not Path(base, d).is_symlink()]
            for name in files:
                p = Path(base, name)
                if p.is_symlink():
                    self.issue('warning', 'symlink_not_followed', p, 'Symlink excluded from audit.')
                elif self.rel(p) != REPORT:
                    result.append(p)
        return sorted(result)

    def load(self):
        paths = self.files()
        self.counts['files_scanned'] = len(paths)
        for name in REQUIRED:
            if not (self.root / name).is_file():
                self.issue('error', 'required_file_missing', name, 'Required handoff file is absent.')
        for p in paths:
            name, ext = self.rel(p), p.suffix.lower()
            try:
                if ext in TEXT_EXT or p.name == '.gitignore':
                    self.text[name] = p.read_text(encoding='utf-8-sig')
                if ext == '.json':
                    self.json[name] = json.loads(self.text[name], object_pairs_hook=without_duplicate_keys)
                elif ext == '.csv':
                    with p.open(encoding='utf-8-sig', newline='') as handle:
                        reader = csv.DictReader(handle, strict=True)
                        headers = reader.fieldnames or []
                        if not headers or len(headers) != len(set(headers)) or any(not h for h in headers):
                            raise ValueError('invalid CSV header')
                        records = list(reader)
                        if any(None in row or any(v is None for v in row.values()) for row in records):
                            raise ValueError('CSV row width mismatch')
                        self.csv[name] = records
                elif ext == '.svg':
                    elem = ET.fromstring(self.text[name])
                    if elem.tag.rsplit('}', 1)[-1] != 'svg':
                        raise ValueError('SVG root missing')
                    self.svg[name] = elem
                    for node in elem.iter():
                        if node.tag.rsplit('}', 1)[-1] in {'script', 'foreignObject'} or any(k.lower().startswith('on') for k in node.attrib):
                            self.issue('error', 'active_svg_content', p, 'SVG contains executable or embedded active content.')
                elif ext == '.png':
                    data = p.read_bytes()
                    if len(data) < 33 or data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
                        raise ValueError('invalid PNG header')
                    self.png[name] = struct.unpack('>II', data[16:24])
                elif ext == '.ttf':
                    data = p.read_bytes()
                    if len(data) < 12 or data[:4] not in {b'\x00\x01\x00\x00', b'OTTO', b'true'}:
                        raise ValueError('invalid SFNT header')
                    count = struct.unpack_from('>H', data, 4)[0]
                    for i in range(count):
                        _, _, offset, length = struct.unpack_from('>4sIII', data, 12 + i * 16)
                        if offset + length > len(data):
                            raise ValueError('SFNT table outside file')
            except (ValueError, UnicodeError, OSError, csv.Error, ET.ParseError, struct.error):
                self.issue('error', 'parse_failed', p, 'File could not be parsed as its declared format; inspect locally.')
        self.counts.update(json_files=len(self.json), csv_files=len(self.csv), svg_files=len(self.svg), png_files=len(self.png))
        self.counts['design_png_files'] = sum(p.startswith('design/exports/') for p in self.png)
        self.counts['asset_png_files'] = sum(p.startswith('assets/') for p in self.png)

    def index(self, rows, filename, key='id'):
        result = {}
        if not isinstance(rows, list):
            self.issue('error', 'registry_shape', filename, 'Registry must contain an array.')
            return result
        for row in rows:
            if not isinstance(row, dict) or not row.get(key):
                self.issue('error', 'registry_id_missing', filename, 'Registry entry has no stable identifier.')
                continue
            rid = row[key]
            if rid in result:
                self.issue('error', 'duplicate_registry_id', filename, f'Duplicate identifier: {rid}')
            result[rid] = row
        return result

    def local_exists(self, path, origin, code='local_path_missing'):
        target = (origin / unquote(path.split('#', 1)[0])).resolve()
        try:
            target.relative_to(self.root)
        except ValueError:
            self.issue('warning', 'outside_repository_link', origin, 'Local link points outside the handoff; not inspected.')
            return
        if self.rel(target) == REPORT and self.report_will_be_written:
            return  # Explicit output of this run, checked after the audit completes.
        if not target.exists():
            self.issue('error', code, target, 'Referenced local file or directory is absent.')

    def markdown_links(self):
        checked = 0
        for filename, original in self.text.items():
            if not filename.endswith('.md'):
                continue
            text = re.sub(r'(?ms)^```.*?^```\s*$', '', original)
            links = re.findall(r'!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+["\'][^\n]*?["\'])?\)', text)
            links += re.findall(r'(?m)^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)', text)
            for link in links:
                dest = link.strip('<>')
                if not dest or dest.startswith('#') or urlsplit(dest).scheme:
                    continue
                checked += 1
                self.local_exists(dest, (self.root / filename).parent, 'markdown_link_missing')
        self.counts['local_markdown_links_checked'] = checked

    def graph(self):
        ref = self.json.get('requirements/reference.json', {}).get('features', [])
        saas = self.json.get('requirements/saas.json', {}).get('requirements', [])
        req = self.index(ref + saas, 'requirements/*.json')
        d = self.json.get('design/screens.json', {})
        screens = self.index(d.get('screens', []), 'design/screens.json')
        states = self.index(d.get('shared_states', []), 'design/screens.json/shared_states')
        variants = self.index(d.get('variants', []), 'design/screens.json/variants')
        backlog = self.json.get('plan/backlog.json', {})
        task = self.index(backlog.get('tasks', []) + backlog.get('adapter_tasks', []), 'plan/backlog.json')
        tests = self.index(self.json.get('plan/test-cases.json', {}).get('cases', []), 'plan/test-cases.json')
        integrations = self.index(self.json.get('integrations/catalog.json', []), 'integrations/catalog.json')
        self.counts.update(requirements=len(req), screens=len(screens), shared_states=len(states), variants=len(variants), tasks=len(task), test_cases=len(tests), integrations=len(integrations))

        def require(identifier, registry, context, kind):
            if identifier not in registry:
                self.issue('error', 'unknown_' + kind, context, f'Unknown {kind} identifier: {identifier}')
                return False
            return True

        for rid, row in req.items():
            for sid in row.get('screen_ids', []):
                if require(sid, screens, rid, 'screen') and rid not in screens[sid].get('requirement_ids', []):
                    self.issue('error', 'screen_reverse_mapping', rid, f'{sid} omits requirement from reverse mapping.')
            if not row.get('screen_ids'):
                self.issue('error', 'requirement_no_screen', rid, 'Requirement has no screen mapping.')
            tid, xid = row.get('task_id'), row.get('test_id')
            if require(tid, task, rid, 'task') and rid not in task[tid].get('requirement_ids', []):
                self.issue('error', 'task_reverse_mapping', rid, f'{tid} omits requirement.')
            if require(xid, tests, rid, 'test') and rid not in [tests[xid].get('requirement_id')] + tests[xid].get('requirement_ids', []):
                self.issue('error', 'test_reverse_mapping', rid, f'{xid} omits requirement.')
        for sid, row in {**screens, **states, **variants}.items():
            for key in ('source', 'preview'):
                if row.get(key):
                    self.local_exists(row[key], self.root / 'design', 'screen_artifact_missing')
                else:
                    self.issue('error', 'screen_artifact_unmapped', sid, f'Screen entry has no {key}.')
            for rid in row.get('requirement_ids', []):
                if require(rid, req, sid, 'requirement') and sid in screens and sid not in req[rid].get('screen_ids', []):
                    self.issue('error', 'requirement_reverse_mapping', sid, f'{rid} omits screen from mapping.')
            for state in row.get('state_refs', []):
                require(state, states, sid, 'state')
            if row.get('parent_screen'):
                require(row['parent_screen'], screens, sid, 'screen')
            for responsive in row.get('responsive_refs', []):
                if responsive not in screens and not (self.root / 'design/source' / (responsive + '.svg')).exists():
                    self.issue('error', 'responsive_artifact_missing', sid, f'Missing responsive view: {responsive}')
        for tid, row in task.items():
            for dep in row.get('depends_on', []):
                require(dep, task, tid, 'dependency')
            for sid in row.get('screens', []):
                require(sid, screens, tid, 'screen')
            for rid in row.get('requirement_ids', []):
                require(rid, req, tid, 'requirement')
            for xid in row.get('test_ids', []):
                if require(xid, tests, tid, 'test') and tests[xid].get('task_id') != tid:
                    self.issue('error', 'test_task_mismatch', tid, f'{xid} points to a different task.')
            def links(value):
                if isinstance(value, str):
                    self.local_exists(value, self.root, 'task_link_missing')
                elif isinstance(value, list):
                    for item in value: links(item)
                elif isinstance(value, dict):
                    for item in value.values(): links(item)
            links(row.get('links', []))
            if row.get('integration_id'):
                require(row['integration_id'], integrations, tid, 'integration')
        for xid, row in tests.items():
            tid = row.get('task_id')
            if require(tid, task, xid, 'task'):
                if xid not in task[tid].get('test_ids', []):
                    self.issue('error', 'task_test_reverse_mapping', xid, 'Task omits this test from its mapping.')
                if row.get('integration_id') != task[tid].get('integration_id'):
                    self.issue('error', 'test_integration_mismatch', xid, 'Test and task have different integration mappings.')
            rids = ([row['requirement_id']] if row.get('requirement_id') else []) + row.get('requirement_ids', [])
            for rid in rids:
                require(rid, req, xid, 'requirement')
            if row.get('integration_id'):
                require(row['integration_id'], integrations, xid, 'integration')
            if row.get('status') not in {'not_run', 'specified', 'not_started'}:
                self.issue('warning', 'runtime_test_status_claim', xid, 'Check claim: no application runtime tests belong to this artifact-only audit.')
        adapter_rows = backlog.get('adapter_tasks', [])
        adapter_ids = {r.get('integration_id') for r in adapter_rows}
        if len(adapter_ids) != len(adapter_rows):
            self.issue('error', 'duplicate_adapter_scope', 'plan/backlog.json', 'Each integration must have one primary adapter or configuration task.')
        for iid in integrations:
            self.local_exists('integrations/passports/' + iid + '.md', self.root, 'passport_missing')
            if iid not in adapter_ids:
                self.issue('error', 'integration_task_missing', iid, 'Integration lacks a scoped backlog task.')
        for file in ('integrations/catalog.csv', 'integrations/capability-matrix.csv'):
            ids = [row.get('id') for row in self.csv.get(file, [])]
            if set(ids) != set(integrations) or len(ids) != len(set(ids)):
                self.issue('error', 'integration_catalog_mismatch', file, 'CSV and JSON integration IDs differ or contain duplicates.')
        trace = self.csv.get('requirements/traceability.csv', [])
        if {r.get('requirement_id') for r in trace} != set(req):
            self.issue('error', 'traceability_coverage', 'requirements/traceability.csv', 'Traceability does not cover exactly all requirements.')
        for row in trace:
            rid, sid, tid, xid = (row.get(k) for k in ('requirement_id', 'screen_id', 'task_id', 'test_id'))
            for val, registry, kind in ((rid, req, 'requirement'), (sid, screens, 'screen'), (tid, task, 'task'), (xid, tests, 'test')):
                require(val, registry, 'requirements/traceability.csv', kind)
            if rid in req and (sid not in req[rid].get('screen_ids', []) or tid != req[rid].get('task_id') or xid != req[rid].get('test_id')):
                self.issue('error', 'traceability_mismatch', rid, 'Traceability row disagrees with requirement mapping.')
            def separated(key):
                return [value.strip() for value in row.get(key, '').split(';') if value.strip()]
            trace_integrations = separated('integration_ids')
            trace_adapters = separated('adapter_task_ids')
            for iid in trace_integrations:
                require(iid, integrations, rid, 'integration')
            for aid in trace_adapters:
                if require(aid, task, rid, 'task'):
                    if task[aid].get('integration_id') not in trace_integrations or rid not in task[aid].get('requirement_ids', []):
                        self.issue('error', 'traceability_adapter_mismatch', rid, 'Adapter scope differs from traceability row.')
            mapped = {task[aid].get('integration_id') for aid in trace_adapters if aid in task}
            if mapped != set(trace_integrations):
                self.issue('error', 'traceability_integration_coverage', rid, 'Integration and adapter task lists do not map one to one.')
            for path in separated('integration_links') + separated('source_svg') + separated('preview_png'):
                self.local_exists(path, self.root, 'traceability_artifact_missing')
        parity_rows = self.csv.get('requirements/parity.csv', [])
        parity = self.index(parity_rows, 'requirements/parity.csv', key='requirement_id')
        for rid, row in parity.items():
            if require(rid, req, 'requirements/parity.csv', 'requirement'):
                screen_ids = {s.strip() for s in re.split(r'[;|]', row.get('screen_ids', '')) if s.strip()}
                if screen_ids != set(req[rid].get('screen_ids', [])) or row.get('task_id') != req[rid].get('task_id') or row.get('test_id') != req[rid].get('test_id'):
                    self.issue('error', 'parity_mapping_mismatch', rid, 'Parity screen/task/test mapping differs from requirement.')
        expected_parity = {rid for rid, row in req.items() if row.get('parity_required') is True}
        if set(parity) != expected_parity:
            self.issue('error', 'parity_coverage', 'requirements/parity.csv', 'Parity table must contain all requirements marked parity_required across reference and SaaS registries.')
        self.counts['parity_requirements'] = len(parity)
        visiting, visited = set(), set()
        def visit(tid):
            if tid in visiting:
                self.issue('error', 'task_dependency_cycle', tid, 'Dependency cycle detected.')
                return
            if tid in visited or tid not in task: return
            visiting.add(tid)
            for dep in task[tid].get('depends_on', []): visit(dep)
            visiting.remove(tid); visited.add(tid)
        for tid in task: visit(tid)
        specs = self.json.get('design/screen-specs.json')
        if specs is not None:
            candidates = specs if isinstance(specs, list) else specs.get('screens', specs.get('screen_specs', []))
            spec_rows = self.index(candidates, 'design/screen-specs.json', key='screen_id')
            if set(screens) != set(spec_rows):
                self.issue('error', 'screen_spec_coverage', 'design/screen-specs.json', 'Detailed specification must cover exactly the registered screens.')
            for sid, row in spec_rows.items():
                if sid not in screens:
                    continue
                if set(row.get('requirement_ids', [])) != set(screens[sid].get('requirement_ids', [])):
                    self.issue('error', 'screen_spec_requirement_mismatch', sid, 'Detailed specification and screen registry map different requirements.')
                for field, registry, kind in (('task_ids', task, 'task'), ('test_ids', tests, 'test'), ('state_artboards', states, 'state'), ('variants', variants, 'variant')):
                    for identifier in row.get(field, []):
                        require(identifier, registry, sid, kind)
                expected_tasks = {req[rid].get('task_id') for rid in row.get('requirement_ids', []) if rid in req}
                expected_tests = {req[rid].get('test_id') for rid in row.get('requirement_ids', []) if rid in req}
                if set(row.get('task_ids', [])) != expected_tasks or set(row.get('test_ids', [])) != expected_tests:
                    self.issue('error', 'screen_spec_delivery_mismatch', sid, 'Detailed screen task/test mapping differs from requirement mapping.')
                for field, map_field in (('editable_svg', 'source'), ('preview_png', 'preview')):
                    if row.get(field) != screens[sid].get(map_field):
                        self.issue('error', 'screen_spec_artifact_mismatch', sid, 'Detailed specification references a different design artifact.')
                if row.get('shared_behavior'):
                    self.local_exists(row['shared_behavior'], self.root / 'design', 'screen_behavior_missing')
                absent = [field for field in ('roles', 'actions', 'business_rules', 'acceptance') if not row.get(field)]
                if absent:
                    self.issue('error', 'screen_spec_missing_behavior', sid, 'Detailed screen contract is empty for: ' + ', '.join(absent))
            self.counts['detailed_screen_specs'] = len(spec_rows)
        copy = self.json.get('design/copy.json')
        if copy is not None:
            messages = self.index(copy.get('messages', []), 'design/copy.json')
            for mid, row in messages.items():
                if not row.get('text') or not row.get('context'):
                    self.issue('error', 'copy_incomplete', mid, 'Copy must have non-empty text and context.')
                used = set(re.findall(r'\{([A-Za-z_][A-Za-z0-9_]*)\}', row.get('text', '')))
                declared = row.get('placeholders', [])
                if used != set(declared) or len(declared) != len(set(declared)):
                    self.issue('error', 'copy_placeholder_mismatch', mid, 'Declared placeholders and text do not match.')
            self.counts['copy_entries'] = len(messages)

    def assets(self):
        rows = self.csv.get('assets/manifest.csv', [])
        self.index(rows, 'assets/manifest.csv')
        known = set()
        for row in rows:
            name = 'assets/' + row.get('path', '')
            known.add(name)
            self.local_exists(name, self.root, 'asset_missing')
            for key in ('purpose', 'format', 'dimensions', 'variant', 'source', 'license'):
                if not row.get(key):
                    self.issue('error', 'asset_metadata_missing', row.get('id', 'assets/manifest.csv'), f'Missing {key}.')
            size = re.fullmatch(r'(\d+)\s*[×x]\s*(\d+)', row.get('dimensions', ''))
            if size:
                expected = tuple(map(int, size.groups()))
                actual = self.png.get(name)
                if name in self.svg:
                    elem = self.svg[name]
                    try: actual = tuple(int(float(elem.get(k))) for k in ('width', 'height'))
                    except (TypeError, ValueError): actual = None
                if actual is not None and actual != expected:
                    self.issue('error', 'asset_dimensions_mismatch', name, 'Actual dimensions disagree with manifest.')
        actual_assets = {p for p in self.text if p.startswith('assets/') and p.endswith('.svg')} | {p for p in self.png if p.startswith('assets/')}
        for name in actual_assets - known:
            self.issue('error', 'asset_not_manifested', name, 'Asset has no manifest row.')
        self.counts['assets_manifested'] = len(rows)

    def openapi(self):
        doc = self.json.get('architecture/openapi.json')
        if not doc: return
        operation_ids = set()
        def walk(value):
            if isinstance(value, list):
                for item in value: walk(item)
            elif isinstance(value, dict):
                ref = value.get('$ref')
                if isinstance(ref, str) and ref.startswith('#/'):
                    current = doc
                    try:
                        for token in ref[2:].split('/'):
                            current = current[token.replace('~1', '/').replace('~0', '~')]
                    except (KeyError, TypeError):
                        self.issue('error', 'openapi_ref_missing', 'architecture/openapi.json', 'Local JSON reference cannot be resolved.')
                if 'operationId' in value:
                    oid = value['operationId']
                    if oid in operation_ids:
                        self.issue('error', 'openapi_operation_duplicate', 'architecture/openapi.json', f'Duplicate operation ID: {oid}')
                    operation_ids.add(oid)
                for item in value.values(): walk(item)
        walk(doc)
        self.counts['openapi_operations'] = len(operation_ids)

    def scope_and_secrets(self):
        application_candidates = set()
        for p in self.files():
            name = self.rel(p)
            parts = p.relative_to(self.root).parts
            if (parts and parts[0] in APP_DIRS) or p.name in APP_FILES or (p.suffix.lower() in {'.tsx', '.jsx', '.ts', '.go', '.rs', '.php'}):
                application_candidates.add(name)
                self.issue('error', 'application_implementation_present', p, 'Possible application/runtime file; artifact-only handoff requires review.')
            if p.suffix.lower() in {'.py', '.mjs', '.js'} and parts[0] != 'tools':
                application_candidates.add(name)
                self.issue('error', 'executable_outside_tools', p, 'Executable source outside the documented artifact tools requires review.')
            if p.name == '.env' or p.name.startswith('.env.') or p.suffix.lower() in {'.pem', '.key', '.p12', '.pfx', '.db', '.sqlite', '.xlsx', '.xls'}:
                self.issue('warning', 'sensitive_container_present', p, 'File type may contain secrets or customer data; inspect separately.')
        self.counts['application_file_candidates'] = len(application_candidates)
        seen = set()
        for name, text in self.text.items():
            for rule, pattern in SECRET_RULES:
                for match in pattern.finditer(text):
                    value = match.group(1) if match.lastindex else match.group(0)
                    if rule == 'credential_assignment' and re.search(r'(?i)(?:example|dummy|placeholder|redacted|your[_ -]|synthetic|not.?set|change.?me|<|\$\{|schema|format)', value):
                        continue
                    if rule == 'email_credential_pair' and not (re.search(r'[A-Za-z]', value) and re.search(r'\d', value) and re.search(r'[^A-Za-z0-9]', value)):
                        continue
                    line = text.count('\n', 0, match.start()) + 1
                    key = (name, rule, line)
                    if key not in seen:
                        seen.add(key)
                        self.issue('warning', 'possible_secret_' + rule, name, 'Potential secret pattern found; matched value intentionally omitted.', line)
        self.counts['secret_pattern_findings'] = len(seen)

    def report(self):
        self.load()
        self.markdown_links()
        self.graph()
        self.assets()
        self.openapi()
        self.scope_and_secrets()
        # Repeated referenced files are a single finding in the final report.
        unique = {json.dumps(i, sort_keys=True, ensure_ascii=False): i for i in self.issues}
        findings = sorted(unique.values(), key=lambda i: (i['level'], i['path'], i['code'], i.get('line', 0)))
        errors = sum(i['level'] == 'error' for i in findings)
        warnings = sum(i['level'] == 'warning' for i in findings)
        return dict(
            schema_version='1.0', checked_at=dt.datetime.now(dt.timezone.utc).isoformat(),
            scope='Static documentation and artifact consistency only; no network or application execution.',
            status='failed' if errors else ('needs_review' if warnings else 'passed'),
            counts={**self.counts, 'errors': errors, 'warnings': warnings}, findings=findings,
            limitations=[
                'No live connector, booking, payment, migration, tenant isolation, performance, or production test was executed.',
                'Secret scan is heuristic; it neither proves absence of secrets nor inspects Git history, external files, ignored dependency folders, or text inside raster images.',
                'Application absence check uses file and directory heuristics; artifact generators in tools/ and ignored dependencies need separate human scope review.',
                'Markdown checks validate local destinations, not remote URL availability or heading-anchor semantics.',
                'PNG/SFNT checks validate structural headers and dimensions/table bounds, not full visual layout or font license authenticity.',
                'Specification semantics, source accuracy, legal applicability and visual quality still require human review.',
            ],
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--write-report', action='store_true', help='Write only plan/validation-report.json under --root.')
    args = parser.parse_args()
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    result = Audit(args.root, report_will_be_written=args.write_report).report()
    if args.write_report:
        target = args.root.resolve() / REPORT
        if not target.parent.is_dir():
            parser.error('plan/ must exist; this checker does not create directories.')
        if target.is_symlink() or target.parent.is_symlink() or not target.resolve().is_relative_to(args.root.resolve()):
            parser.error('The report must be a regular file inside this repository.')
        target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result['counts']['errors'] else (2 if result['counts']['warnings'] else 0)


if __name__ == '__main__':
    raise SystemExit(main())
