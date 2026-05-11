import { describe, it, expect, beforeEach } from '@jest/globals';
import { BaileysConnectionState } from './baileys-connection-state.js';

describe('BaileysConnectionState', () => {
  let s: BaileysConnectionState;

  beforeEach(() => {
    s = new BaileysConnectionState({ maxBackoffMs: 60_000 });
  });

  it('starts disconnected with null phone and lastSeenAt', () => {
    expect(s.snapshot()).toEqual({ connected: false, phone: null, lastSeenAt: null });
  });

  it('markConnected sets connected, phone, and a timestamp', () => {
    s.markConnected('5491166...');
    const snap = s.snapshot();
    expect(snap.connected).toBe(true);
    expect(snap.phone).toBe('5491166...');
    expect(snap.lastSeenAt).toBeInstanceOf(Date);
  });

  it('markDisconnected drops connected to false but keeps phone (last known)', () => {
    s.markConnected('5491166...');
    s.markDisconnected();
    const snap = s.snapshot();
    expect(snap.connected).toBe(false);
    expect(snap.phone).toBe('5491166...');
  });

  it('nextBackoffMs follows 1s,2s,5s,15s,30s,60s and caps', () => {
    expect(s.nextBackoffMs()).toBe(1000);
    expect(s.nextBackoffMs()).toBe(2000);
    expect(s.nextBackoffMs()).toBe(5000);
    expect(s.nextBackoffMs()).toBe(15_000);
    expect(s.nextBackoffMs()).toBe(30_000);
    expect(s.nextBackoffMs()).toBe(60_000);
    expect(s.nextBackoffMs()).toBe(60_000);
  });

  it('resetBackoff restarts the sequence', () => {
    s.nextBackoffMs();
    s.nextBackoffMs();
    s.resetBackoff();
    expect(s.nextBackoffMs()).toBe(1000);
  });
});
