// id の要素を取る（HTML の要素のほか、SVG の要素にも使える）
export function $<T extends Element = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  // getElementById の型は HTMLElement だが、実際には SVG の要素も返る
  return el as Element as T;
}
