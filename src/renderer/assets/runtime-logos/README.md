# Runtime profile logos

Bundled SVG assets identify the selected runtime when no personal photo exists.
Vector paths retain their resolution at any zoom or display density. No remote
image requests are made by the application. Existing profile photos take priority.

Official sources, retrieved 2026-09-16:

- `codex.svg`: OpenAI symbol in the [Codex documentation](https://developers.openai.com/codex).
  Removed page-specific classes; uses the white version on a dark background.
- `claude.svg`: [Claude symbol](https://claude.ai/favicon.svg), original vector.
- `grok.svg`: [Grok icon](https://grok.com/images/favicon.svg), original vector paths;
  removed the unused HTML `foreignObject` backdrop effect.
- `ollama.svg`: [Ollama logo](https://github.com/ollama/ollama/blob/main/docs/ollama-logo.svg),
  original vector path with white fill for the shared dark logo background;
  centred in a square viewBox so the full mark fits round profile avatars.
  The upstream MIT license and copyright notice are retained in the SVG comment.

The marks belong to their respective owners. Their use identifies integrations
in ADE and does not imply endorsement.
