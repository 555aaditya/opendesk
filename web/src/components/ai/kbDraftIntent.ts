// Lets the KB list open a new article with the "Draft from tickets" dialog
// already up, without a route search param.

let pending = false;

export function requestKbDraft() {
  pending = true;
}

/** Read once by the editor on mount. */
export function takeKbDraftRequest(): boolean {
  const p = pending;
  pending = false;
  return p;
}
