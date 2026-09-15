/** A short, window-bound authorization opened by an explicit recorder action.
 * This never permits cameras, screen capture, dashboard windows or subframes. */
export class MicrophoneAccess {
  private readonly permits = new Map<number, number>();
  constructor(private readonly trusted: (webContentsId: number, url: string) => boolean, private readonly now = Date.now) {}
  grant(webContentsId: number): void {
    for (const [id, expires] of this.permits) if (expires <= this.now()) this.permits.delete(id);
    if (!Number.isInteger(webContentsId) || webContentsId < 1 || (!this.permits.has(webContentsId) && this.permits.size >= 32)) throw new Error('Mikrofonfreigabe ist nicht verfügbar.');
    this.permits.set(webContentsId, this.now() + 30_000);
  }
  revoke(webContentsId: number): void { this.permits.delete(webContentsId); }
  allows(webContentsId: number | undefined, permission: string, details: { isMainFrame: boolean; requestingUrl?: string; mediaType?: string; mediaTypes?: string[] }): boolean {
    if (!webContentsId || permission !== 'media' || !details.isMainFrame || !details.requestingUrl
      || (this.permits.get(webContentsId) ?? 0) <= this.now() || !this.trusted(webContentsId, details.requestingUrl)) return false;
    if (details.mediaTypes !== undefined) return Array.isArray(details.mediaTypes) && details.mediaTypes.length === 1
      && details.mediaTypes[0] === 'audio' && (details.mediaType === undefined || details.mediaType === 'audio');
    return details.mediaType === 'audio';
  }
}
