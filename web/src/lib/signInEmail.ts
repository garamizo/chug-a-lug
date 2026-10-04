import { writable } from 'svelte/store';
/** The address typed on /login, carried to /login/forgot in memory so it never lands in a URL. */
export const typedEmail = writable('');
