import { SpeechService } from '../../src/main/settings/SpeechService';
import type { DialogueConnect } from '../../src/main/settings/ElevenDialogue';
const peer = require('../fixtures/dialogue-speech.cjs') as { connect(fetcher: typeof fetch): DialogueConnect };
/** Existing service/ownership fixtures use a deterministic framed provider peer. */
export class FixtureSpeechService extends SpeechService {
  constructor(store: ConstructorParameters<typeof SpeechService>[0], key: () => string | undefined, fetcher: typeof fetch) {
    super(store, key, fetcher, peer.connect(fetcher));
  }
}
