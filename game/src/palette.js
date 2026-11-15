// The look plan, in one place. Dusk over a foundry yard: a cold blue-grey sky
// against warm amber work lights, teal for the STRIKERS, rust orange for the
// JACKALS. The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#2e3442',
  surface: '#2c313c',
  hairline: '#3d4452',
  wall: '#4b5260',
  ink: '#ece7db',
  muted: '#9aa3b0',
  accent: '#f2a33c',
  team: '#35c4b5',
  enemy: '#e4572e',
  danger: '#e5484d',
  money: '#7fce62',
};

export function shade(name) {
  return PALETTE[name];
}
