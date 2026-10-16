/** Present the App declaration's event name without changing its signed identity. */
export function eventLabel(name: string) {
  const words = name.replace(/[._-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
