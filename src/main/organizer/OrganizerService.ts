import { t as translate } from "../../shared/i18n";
import { type OrganizerMutation, type OrganizerQuery, type OrganizerQueryResult, type OrganizerReceipt, type OrganizerImage } from '../../shared/organizer';
import { OrganizerError, OrganizerStore } from './OrganizerStore';

/** Validate encoded dimensions before any image decoder allocates a pixel buffer. */
export function validateOrganizerImage(image: OrganizerImage): void {
  const bytes = Buffer.from(image.base64, 'base64');
  if (bytes.toString('base64') !== image.base64) throw new OrganizerError('invalid', translate("Invalid image coding."));
  let width = 0; let height = 0;
  if (image.mime === 'image/png' && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString('ascii', 12, 16) === 'IHDR') { width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); }
  if (image.mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194].includes(marker) && length >= 8) { height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break; }
      offset += length;
    }
  }
  if (!width || !height || width > 4096 || height > 4096 || width !== image.width || height !== image.height) throw new OrganizerError('invalid', translate("The image format or image size is invalid."));
}
export class OrganizerService {
  private store_: OrganizerStore | undefined;
  constructor(private readonly path: string, private readonly changed: (revision: number) => void = () => {},
    private readonly decode?: (image: OrganizerImage) => void) {}
  get store(): OrganizerStore { return this.store_ ??= new OrganizerStore(this.path); }
  query(input: OrganizerQuery, owner: string): OrganizerQueryResult {
    if (input.operation === 'list') return { index: this.store.index() };
    if (input.operation === 'writer') return { sequence: this.store.writerSequence(input.writerId, owner) };
    return { entry: this.store.detail(input.id), redacted: false };
  }
  command(input: OrganizerMutation, owner: string): OrganizerReceipt {
    if (input.operation === 'put') for (const image of input.document.images) { validateOrganizerImage(image); this.decode?.(image); }
    const receipt = this.store.mutate(input, owner); if (!receipt.replayed) this.changed(receipt.revision); return receipt;
  }
}
