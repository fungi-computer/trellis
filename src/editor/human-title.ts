/** A step or method id read as a name: "writeFile" and "write-file" become "Write file". */
export function humanTitle(id: string) {
  const words = id
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[._-]+/gu, " ");
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}
