// Passkeys (WebAuthn), per contracts/api.md. Sign-in uses discoverable
// credentials, so no email is asked first; every ceremony carries a
// short-lived purpose-bound passkey_token from its begin call.

import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { http } from "./client";
import type { LoginResponse } from "./types";

export type Passkey = {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  backed_up: boolean;
};

const pub = { auth: false, workspace: false } as const;
const me = { workspace: false } as const;

type Begin<O> = { options: O | { publicKey: O }; passkey_token: string };

// The server may wrap options in { publicKey } (the WebAuthn JS shape).
function unwrap<O>(o: O | { publicKey: O }): O {
  return o && typeof o === "object" && "publicKey" in (o as object) ? (o as { publicKey: O }).publicKey : (o as O);
}

export const passkeyApi = {
  list: () => http.get<{ data: Passkey[]; next_cursor: string | null }>("/v1/me/passkeys", me),
  rename: (id: string, name: string) => http.patch<Passkey>(`/v1/me/passkeys/${id}`, { name }, me),
  remove: (id: string) => http.del(`/v1/me/passkeys/${id}`, undefined, me),
};

export const passkeysSupported = () => browserSupportsWebAuthn();
export const passkeyAutofillSupported = () => browserSupportsWebAuthnAutofill();

/** Sign in with a passkey. `autofill` runs the conditional UI on the email field. */
export async function signInWithPasskey(opts: { autofill?: boolean } = {}): Promise<LoginResponse> {
  const begin = await http.post<Begin<PublicKeyCredentialRequestOptionsJSON>>("/v1/auth/passkey/login/begin", {}, pub);
  const credential = await startAuthentication({ optionsJSON: unwrap(begin.options), useBrowserAutofill: !!opts.autofill });
  return http.post<LoginResponse>("/v1/auth/passkey/login/finish", { passkey_token: begin.passkey_token, credential }, pub);
}

/** Create a passkey for the signed-in user. */
export async function addPasskey(name?: string): Promise<Passkey> {
  const begin = await http.post<Begin<PublicKeyCredentialCreationOptionsJSON>>("/v1/me/passkeys/register/begin", {}, me);
  const credential = await startRegistration({ optionsJSON: unwrap(begin.options) });
  return http.post<Passkey>("/v1/me/passkeys/register/finish", { passkey_token: begin.passkey_token, credential, name: name || undefined }, me);
}

export const cancelPasskeyCeremony = () => WebAuthnAbortService.cancelCeremony();

/** True when the person dismissed or cancelled the browser prompt. */
export function isPasskeyCancel(e: unknown) {
  const n = (e as { name?: string })?.name;
  return n === "NotAllowedError" || n === "AbortError";
}
