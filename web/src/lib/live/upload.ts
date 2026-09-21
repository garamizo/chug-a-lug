// Getting a phone photo to the server. Images shrink first — a modern phone's 12 MP JPEG is several
// megabytes of nothing useful on a 400 px strip — and videos go as they are, under the hard ceiling
// the Cloudflare free plan imposes on the tunnel.
import { copy } from '$lib/labels';

export const MAX_BYTES = 94_371_840; // 90 MB: the Cloudflare free-plan ceiling on the tunnel.

export type Prepared = { file: File; kind: 'image' | 'video'; takenAt: string };

export async function prepare(file: File, compress: (f: File) => Promise<File>): Promise<Prepared> {
  if (file.size > MAX_BYTES) throw new Error(copy.uploadTooBig);
  const kind: 'image' | 'video' = file.type.startsWith('video/') ? 'video' : 'image';
  const takenAt = new Date(file.lastModified || Date.now()).toISOString();
  if (kind === 'video') return { file, kind, takenAt };
  try {
    return { file: await compress(file), kind, takenAt };
  } catch {
    // A browser that will not give us a canvas is not a reason to lose the photo.
    return { file, kind, takenAt };
  }
}
