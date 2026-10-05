import { pb } from '$lib/pb';
import { GOOGLE_KEY, buildAuthUrl, type GoogleState } from '$lib/google';

/** Full-page OAuth also works in installed apps. No crew name is required before Google. */
export async function startGoogle(mode: GoogleState['mode'], name = ''): Promise<void> {
  pb.authStore.clear();
  const methods = await pb.collection('users').listAuthMethods();
  const provider = methods.oauth2.providers.find((p) => p.name === 'google');
  if (!provider) throw new Error('Google unavailable');
  const redirectUrl = `${location.origin}/auth/google`;
  const state: GoogleState = { mode, name, state: provider.state, codeVerifier: provider.codeVerifier, redirectUrl };
  sessionStorage.setItem(GOOGLE_KEY, JSON.stringify(state));
  location.assign(buildAuthUrl(provider.authURL, redirectUrl));
}
