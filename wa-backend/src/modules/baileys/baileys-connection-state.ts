export interface ConnectionSnapshot {
  connected: boolean;
  phone: string | null;
  lastSeenAt: Date | null;
}

export class BaileysConnectionState {
  private static readonly STEPS = [1000, 2000, 5000, 15_000, 30_000, 60_000] as const;

  private connected = false;
  private phone: string | null = null;
  private lastSeenAt: Date | null = null;
  private attempt = 0;

  constructor(private readonly opts: { maxBackoffMs: number }) {}

  snapshot(): ConnectionSnapshot {
    return {
      connected: this.connected,
      phone: this.phone,
      lastSeenAt: this.lastSeenAt,
    };
  }

  markConnected(phone: string): void {
    this.connected = true;
    this.phone = phone;
    this.lastSeenAt = new Date();
    this.resetBackoff();
  }

  markDisconnected(): void {
    this.connected = false;
  }

  nextBackoffMs(): number {
    const idx = Math.min(this.attempt, BaileysConnectionState.STEPS.length - 1);
    const step = BaileysConnectionState.STEPS[idx];
    this.attempt += 1;
    return Math.min(step, this.opts.maxBackoffMs);
  }

  resetBackoff(): void {
    this.attempt = 0;
  }
}
