import { describe, expect, it } from 'vitest';
import { deviceFromTopic, parseTapMessage, plantStateFilter, stateTopic } from './index.js';

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
