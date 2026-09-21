import { placeMenu } from './place-menu';

const VIEW_W = 1000;
const VIEW_H = 800;
const W = 220;
const H = 300;

describe('placeMenu', () => {
  it('opens down and to the right when there is room', () => {
    expect(placeMenu(100, 100, W, H, VIEW_W, VIEW_H)).toEqual({ x: 100, y: 100 });
  });

  it('flips to the left near the right edge', () => {
    const { x } = placeMenu(900, 100, W, H, VIEW_W, VIEW_H);
    expect(x).toBe(900 - W);
  });

  it('flips upwards near the bottom edge', () => {
    const { y } = placeMenu(100, 700, W, H, VIEW_W, VIEW_H);
    expect(y).toBe(700 - H);
  });

  it('flips both ways in the bottom-right corner', () => {
    expect(placeMenu(980, 780, W, H, VIEW_W, VIEW_H)).toEqual({ x: 980 - W, y: 780 - H });
  });

  it('keeps the margin at the top-left corner', () => {
    expect(placeMenu(0, 0, W, H, VIEW_W, VIEW_H, 8)).toEqual({ x: 8, y: 8 });
  });

  it('never returns a negative coordinate, even for a menu larger than the viewport', () => {
    const { x, y } = placeMenu(50, 50, 2000, 2000, VIEW_W, VIEW_H, 8);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
  });

  it('stays inside the viewport for every point of a coarse sweep', () => {
    for (let x = 0; x <= VIEW_W; x += 50) {
      for (let y = 0; y <= VIEW_H; y += 50) {
        const p = placeMenu(x, y, W, H, VIEW_W, VIEW_H, 8);
        expect(p.x).toBeGreaterThanOrEqual(8);
        expect(p.y).toBeGreaterThanOrEqual(8);
        expect(p.x + W).toBeLessThanOrEqual(VIEW_W - 8);
        expect(p.y + H).toBeLessThanOrEqual(VIEW_H - 8);
      }
    }
  });
});
