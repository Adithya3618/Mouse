// Small, shared DOM visibility helpers used by the other ui/* modules and
// the experiment controller, so screen show/hide stays consistent.
//
// These use the native `hidden` property/attribute rather than inline
// styles. That is what css/intake.css's global `[hidden]{display:none
// !important}` rule is written against - toggling `hidden` here keeps
// every show()/hide() call, and every direct `.hidden = true/false` used
// elsewhere (e.g. ui/experimentScreen.js), backed by the exact same
// mechanism instead of two different ones that can fight each other.

export function show(el) {
    el.hidden = false;
}

export function hide(el) {
    el.hidden = true;
}
