import { describe, expect, it } from 'vitest';
import { deviceFromStatusTopic, deviceFromTopic, deviceTopic, otaSigningPayload, otaTopic, parseTapMessage, parseTapStatus, plantStateFilter, stateTopic } from './index.js';

describe('plant MQTT contract (decision 063)', () => {
  it('builds and reads state topics', () => {
    expect(stateTopic('azeonics', 'NM1', 'MT1-01')).toBe('factoryos/azeonics/NM1/MT1-01/state');
    expect(plantStateFilter('azeonics', 'NM1')).toBe('factoryos/azeonics/NM1/+/state');
    expect(deviceFromTopic('factoryos/azeonics/NM1/MT1-01/state', 'azeonics', 'NM1')).toBe('MT1-01');
    expect(deviceFromTopic('factoryos/other/NM1/MT1-01/state', 'azeonics', 'NM1')).toBeNull();
    expect(deviceFromTopic('factoryos/azeonics/NM1/MT1-01/power', 'azeonics', 'NM1')).toBeNull();
    expect(() => stateTopic('azeonics', 'NM1', 'bad/device')).toThrow();
  });

  it('validates tap messages', () => {
    expect(parseTapMessage('{"seq":7,"state":"running","at":"2026-10-12T04:00:00Z"}')).toEqual({ seq: 7, state: 'running', at: '2026-10-12T04:00:00Z' });
    expect(parseTapMessage('nope')).toEqual({ error: 'Not JSON' });
    expect(parseTapMessage('{"seq":-1,"state":"idle","at":"2026-10-12T04:00:00Z"}')).toEqual({ error: 'Bad seq' });
    expect(parseTapMessage('{"seq":1,"state":"dancing","at":"2026-10-12T04:00:00Z"}')).toEqual({ error: 'Unknown state dancing' });
    expect(parseTapMessage('{"seq":1,"state":"idle","at":"soon"}')).toEqual({ error: 'Bad timestamp' });
  });
});

describe('tap config, status and OTA topics (decision 064)', () => {
  it('names the topics', () => {
    expect(deviceTopic('azeonics', 'NM1', 'MT1-01', 'config')).toBe('factoryos/azeonics/NM1/MT1-01/config');
    expect(otaTopic('azeonics', 'NM1')).toBe('factoryos/azeonics/NM1/ota');
    expect(deviceFromStatusTopic('factoryos/azeonics/NM1/MT1-01/status', 'azeonics', 'NM1')).toBe('MT1-01');
    expect(deviceFromStatusTopic('factoryos/azeonics/NM1/MT1-01/state', 'azeonics', 'NM1')).toBeNull();
    expect(otaSigningPayload({ version: '1.2.0', size: 10, sha256: 'ab' })).toBe('factoryos-mt1|1.2.0|10|ab');
  });

  it('reads tap status defensively', () => {
    expect(parseTapStatus('{"fwVersion":"1.0.0","configVersion":3,"uptime":12.7,"rssi":-61,"outbox":0,"lastError":null,"at":"2026-10-12T04:00:00Z"}')).toEqual({ fwVersion: '1.0.0', configVersion: 3, uptime: 12, rssi: -61, outbox: 0, lastError: null, at: '2026-10-12T04:00:00Z' });
    expect(parseTapStatus('{"at":"2026-10-12T04:00:00Z"}')).toEqual({ error: 'Bad status' });
  });
});
