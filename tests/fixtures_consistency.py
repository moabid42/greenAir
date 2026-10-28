#!/usr/bin/env python3
"""Safe sanity checks; uses Python standard library only."""
from pathlib import Path
import json
from datetime import datetime
R=Path(__file__).resolve().parents[1]/'public'/'fixtures'
read=lambda name: json.loads((R/name).read_text(encoding='utf8'))
e=read('environment_heilbronn_2026-10-29.json')
a=read('apple_watch_demo_2026-10-29.json')
w=read('whoop_demo_2026-10-29.json')
assert e['mode']=='demo'
assert e['scenarioDate']=='2026-10-29' and e['timeZone']=='Europe/Berlin'
assert e['sensorFeatures'] is None and e['routeFeatures'] is None
assert len(e['timeSlices'])==3
assert [datetime.fromisoformat(s['time']).hour for s in e['timeSlices']]==[14,15,16]
for s in e['timeSlices']:
 for family in ['air','weather','traffic','sportSuitability']:
  for name,metric in s[family].items():
   assert metric['mode']=='demo', (family,name)
   assert metric['value'] is not None and metric['unit'] and metric['source']
 for sport in ['running','walking','cycling']:
  assert 0<=s['sportSuitability'][sport]['value']<=100
for dev in [a,w]:
 assert dev['isDemo'] and not dev['syncConsent']
 assert dev['connectionState']=='disconnected'
 assert len(dev['samples'])==5
 assert dev['samples'][0]['timestamp'].startswith('2026-10-29T14:00')
 assert dev['samples'][-1]['timestamp'].startswith('2026-10-29T16:00')
 assert all(s['mode']=='demo' for s in dev['samples'])
 assert all(datetime.fromisoformat(s['timestamp']).utcoffset().total_seconds()==3600 for s in dev['samples'])
assert a['deviceId']!=w['deviceId']
print('PASS: deterministic date/time, source flags, metrics and two mock device fixtures')
