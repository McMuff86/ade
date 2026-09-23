/**
 * Where focus lands when a note or task opens. On a device whose primary
 * pointer is coarse (tablet, phone) focusing a text field raises the on-screen
 * keyboard at once, which hides half the note before anything was typed; there
 * the editor container takes focus and the keyboard waits for a tap into a
 * field. With a fine pointer (mouse, trackpad) the title field is focused so
 * typing can start right away. Pure so the rule is unit-testable.
 */
export const keyboardOnFocus = (media: (query: string) => { matches: boolean } = (query) => window.matchMedia(query)): boolean => media('(pointer: coarse)').matches;
