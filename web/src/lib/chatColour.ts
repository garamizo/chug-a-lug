// A stable colour per person, so names can be told apart at a glance.
const NAME_COLOURS = ['#ff8a65', '#ffd54f', '#81c784', '#4fc3f7', '#ba68c8', '#f06292', '#4db6ac', '#aed581', '#9fa8da', '#ffb74d'];
export function nameColour(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return NAME_COLOURS[Math.abs(h) % NAME_COLOURS.length];
}
