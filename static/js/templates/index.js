// Template registry. A template = { id, name, desc, css, render(resume, h) -> html string }.
// `h` (see editor.js) supplies field()/item()/addButton() so templates stay presentation-only
// and work both in the editor (contenteditable + annotation marks) and in print.
import navy from './navy.js';

export const templates = [navy];
export const getTemplate = id => templates.find(t => t.id === id) || templates[0];
