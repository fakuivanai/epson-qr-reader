/** Hands out request tokens where only the most recently issued one is current. */
export function createLatest() {
  let current = 0;
  return {
    begin: (): number => ++current,
    isCurrent: (token: number): boolean => token === current,
  };
}
