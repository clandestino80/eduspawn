/**
 * Minimal structured product/ops logging (JSON lines). No secrets or raw payloads.
 */
export function logProductEvent(event: string, fields: Record<string, unknown>): void {
  const payload = {
    event,
    ts: new Date().toISOString(),
    ...fields,
  };
  console.info(JSON.stringify(payload));
}
