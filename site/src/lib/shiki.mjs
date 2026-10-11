// Monochrome code themes for Shiki: weight and grey carry the syntax, never hue.
// Plain JS so astro.config.mjs can import it for Markdown code blocks too.

const make = (/** @type {string} */ name, /** @type {'light' | 'dark'} */ type, /** @type {string} */ fg, /** @type {string} */ strong, /** @type {string} */ mid, /** @type {string} */ faint) => ({
  name,
  type,
  colors: { 'editor.background': '#00000000', 'editor.foreground': fg },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: faint, fontStyle: 'italic' } },
    { scope: ['string', 'string.quoted', 'string.template'], settings: { foreground: mid } },
    { scope: ['constant.numeric', 'constant.language', 'support.constant'], settings: { foreground: strong } },
    { scope: ['keyword', 'storage', 'storage.type', 'keyword.control', 'keyword.operator.new'], settings: { foreground: strong, fontStyle: 'bold' } },
    { scope: ['entity.name.function', 'support.function', 'meta.function-call'], settings: { foreground: strong } },
    { scope: ['support.type.property-name', 'meta.object-literal.key', 'entity.name.tag', 'entity.other.attribute-name'], settings: { foreground: strong } },
    { scope: ['punctuation', 'meta.brace', 'keyword.operator'], settings: { foreground: faint } },
    { scope: ['variable.parameter', 'variable.other.readwrite'], settings: { foreground: fg } },
  ],
});

export const monoLight = make('od-mono-light', 'light', '#262626', '#0a0a0a', '#525252', '#8a8a8a');
export const monoDark = make('od-mono-dark', 'dark', '#e4e4e4', '#ffffff', '#a3a3a3', '#737373');
